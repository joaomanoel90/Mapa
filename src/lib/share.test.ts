import { describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINTS } from "./endpoints";
import type { LatLng } from "./geo";
import type { Place } from "./geocode";
import { makePoi } from "./pois";
import { DEFAULT_SETTINGS, MAX_WAYPOINTS } from "./settings";
import {
  buildShareUrl,
  decodePolyline,
  decodeShare,
  encodePolyline,
  sharedSettingsOverrides,
  type ShareData,
} from "./share";

const PONTOS: LatLng[] = [
  { lat: -23.4903, lng: -48.4128 },
  { lat: -23.4938, lng: -48.4186 },
  { lat: -23.4975, lng: -48.4119 },
];

const base = (over: Partial<ShareData> = {}): ShareData => ({
  waypoints: PONTOS,
  settings: { ...DEFAULT_SETTINGS },
  pois: [],
  endpoints: { ...DEFAULT_ENDPOINTS },
  city: null,
  ...over,
});

/** Extrai o payload do hash, sem o "#r=". */
const payloadOf = (url: string) => url.split("#r=")[1];

describe("polyline", () => {
  it("vai e volta sem perder precisão", () => {
    expect(decodePolyline(encodePolyline(PONTOS))).toEqual(PONTOS);
  });

  it("aguenta coordenadas negativas e decimais", () => {
    const pts = [
      { lat: -23.56789, lng: -46.12345 },
      { lat: 38.7223, lng: -9.1393 },
      { lat: -8.0476, lng: -34.877 },
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  it("codifica vazio e um ponto", () => {
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
    expect(decodePolyline(encodePolyline([PONTOS[0]]))).toEqual([PONTOS[0]]);
  });

  it("arredonda em ~1 m, que é a precisão do formato", () => {
    // 5 casas decimais ≈ 1,1 m. Os pontos são encaixados na rua pelo OSRM ao
    // abrir o link, então esse arredondamento não muda o traçado final.
    const cheio = [{ lat: -23.48838237, lng: -48.41175619 }];
    const voltou = decodePolyline(encodePolyline(cheio))[0];
    expect(Math.abs(voltou.lat - cheio[0].lat)).toBeLessThan(1e-5);
    expect(Math.abs(voltou.lng - cheio[0].lng)).toBeLessThan(1e-5);
  });
});

describe("encodeShare", () => {
  it("produz um fragmento seguro para URL", () => {
    const url = buildShareUrl(base({ city: { id: "x", name: "Angatuba", label: "Angatuba", country: "Brasil", center: PONTOS[0], zoom: 13 } as Place }));
    const payload = payloadOf(url);
    // só o alfabeto base64url e o separador de versão
    expect(payload).toMatch(/^[0-9]+\.[A-Za-z0-9_-]+$/);
  });

  it("não guarda preferências iguais ao padrão", () => {
    const curto = buildShareUrl(base());
    const longo = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, duration: 33 } }));
    expect(longo.length).toBeGreaterThan(curto.length);
  });

  it("não inclui fps, bitrate nem formato (dependem do aparelho)", () => {
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, fps: 24, bitrateMbps: 3, formatId: "webm-vp8" } }),
    );
    const json = JSON.parse(atob(payloadOf(url).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(json.s).toBeUndefined();
  });

  it("leva o perfil de elevação no link", () => {
    /*
     * A faixa do relevo é parte da cena que o cliente vê: quem manda o link
     * espera que o outro abra com o **mesmo** vídeo. Desligar precisa ir junto.
     */
    const com = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, elevationProfile: true } }));
    const sem = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, elevationProfile: false } }));
    const ler = (url: string) =>
      JSON.parse(atob(payloadOf(url).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(ler(com).s?.elevationProfile).toBeUndefined(); // é o padrão: não gasta bytes
    expect(ler(sem).s?.elevationProfile).toBe(false);
  });

  it("leva os destaques do percurso no link", () => {
    // quem abre o link tem de ver o mesmo vídeo: o aviso da melhor parcial e da
    // maior subida também viaja
    const sem = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, highlights: false } }));
    const json = JSON.parse(atob(payloadOf(sem).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(json.s?.highlights).toBe(false);
  });

  it("monta a URL sobre a base informada", () => {
    const url = buildShareUrl(base(), "https://exemplo.org/Mapa/");
    expect(url.startsWith("https://exemplo.org/Mapa/#r=")).toBe(true);
  });

  it("não deixa a URL crescer sem limite", () => {
    const muitos: LatLng[] = Array.from({ length: 500 }, (_, i) => ({
      lat: -23 + i * 0.001,
      lng: -48 - i * 0.001,
    }));
    const url = buildShareUrl(base({ waypoints: muitos }));
    expect(url.length).toBeLessThan(4000);
  });
});

describe("decodeShare", () => {
  it("recupera o traçado", () => {
    const r = decodeShare(buildShareUrl(base()));
    expect(r?.waypoints).toEqual(PONTOS);
  });

  it("aceita o hash e a URL inteira", () => {
    const url = buildShareUrl(base(), "https://joaomanoel90.github.io/Mapa/");
    // é fácil passar a URL completa por engano; as duas formas têm de funcionar
    expect(decodeShare(url)?.waypoints).toEqual(PONTOS);
    expect(decodeShare(`#${url.split("#")[1]}`)?.waypoints).toEqual(PONTOS);
  });

  it("recupera as preferências que foram alteradas", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      title: "Caminho da cachoeira",
      subtitle: "Domingo",
      duration: 25,
      basemap: "satellite" as const,
      profile: "bike" as const,
      accent: "#ff8800",
      cameraMode: "fit" as const,
      showTitle: false,
    };
    const r = decodeShare(buildShareUrl(base({ settings })));
    expect(r?.settings.title).toBe("Caminho da cachoeira");
    expect(r?.settings.duration).toBe(25);
    expect(r?.settings.basemap).toBe("satellite");
    expect(r?.settings.profile).toBe("bike");
    expect(r?.settings.accent).toBe("#ff8800");
    expect(r?.settings.cameraMode).toBe("fit");
    expect(r?.settings.showTitle).toBe(false);
  });

  it("preenche com o padrão o que não veio no link", () => {
    const r = decodeShare(buildShareUrl(base()));
    expect(r?.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("leva os textos da cartela final no link", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cardDistance: "49 km",
      cardElevation: "+1.676 m",
      cardTime: "3 h 19 min",
      cardNote: "com os amigos do pedal",
    };
    const r = decodeShare(buildShareUrl(base({ settings })));
    expect(r?.settings.cardDistance).toBe("49 km");
    expect(r?.settings.cardElevation).toBe("+1.676 m");
    expect(r?.settings.cardTime).toBe("3 h 19 min");
    expect(r?.settings.cardNote).toBe("com os amigos do pedal");
  });

  it("cartela vazia não ocupa byte nenhum no link", () => {
    const comCartela = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, cardDistance: "49 km" } }),
    );
    const semCartela = buildShareUrl(base());
    expect(comCartela.length).toBeGreaterThan(semCartela.length);
    // os outros três campos continuam fora do link quando estão vazios
    const json = JSON.parse(
      atob(payloadOf(comCartela).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(json.s.cardDistance).toBe("49 km");
    expect(json.s.cardElevation).toBeUndefined();
    expect(json.s.cardTime).toBeUndefined();
    expect(json.s.cardNote).toBeUndefined();
  });

  it("recupera paradas, inclusive fora da rota", () => {
    const pois = [
      makePoi("igreja", 0.3, "Igreja Matriz", undefined, "a"),
      makePoi("cachoeira", 0.8, "Cachoeira", { lat: -23.6, lng: -48.5 }, "b"),
    ];
    const r = decodeShare(buildShareUrl(base({ pois })));
    expect(r?.pois).toHaveLength(2);
    expect(r?.pois[0].label).toBe("Igreja Matriz");
    expect(r?.pois[0].pos).toBeUndefined();
    expect(r?.pois[1].pos).toEqual({ lat: -23.6, lng: -48.5 });
    expect(r?.pois[1].emoji).toBe(makePoi("cachoeira", 0.5).emoji);
  });

  it("distingue tipos que usam o mesmo emoji", () => {
    // 🎡 é usado por "Feira" e por "Roda-gigante": olhar só o emoji faria a
    // parada voltar como o tipo errado
    const feira = makePoi("feira", 0.2, undefined, undefined, "f");
    const roda = makePoi("roda-gigante", 0.7, undefined, undefined, "r");
    expect(feira.emoji).toBe(roda.emoji);

    const r = decodeShare(buildShareUrl(base({ pois: [feira, roda] })));
    expect(r?.pois[0].label).toBe(feira.label);
    expect(r?.pois[1].label).toBe(roda.label);
    expect(r?.pois[0].label).not.toBe(r?.pois[1].label);
  });

  it("preserva parada renomeada, com e sem posição", () => {
    const pois = [
      makePoi("igreja", 0.25, "Igreja Matriz", undefined, "a"),
      makePoi("praia", 0.75, "Praia do Sino", { lat: -23.9, lng: -48.1 }, "b"),
    ];
    const r = decodeShare(buildShareUrl(base({ pois })));
    expect(r?.pois[0].label).toBe("Igreja Matriz");
    expect(r?.pois[1].label).toBe("Praia do Sino");
    expect(r?.pois[1].pos).toEqual({ lat: -23.9, lng: -48.1 });
  });

  it("recupera partida, chegada e cidade", () => {
    const r = decodeShare(
      buildShareUrl(
        base({
          endpoints: { a: { emoji: "🏠", label: "Casa" }, b: { emoji: "💦", label: "Cachoeira" } },
          city: {
            id: "s",
            name: "Angatuba",
            label: "Angatuba",
            country: "",
            center: { lat: -23.49, lng: -48.41 },
            zoom: 13,
          } as Place,
        }),
      ),
    );
    expect(r?.endpoints.a).toEqual({ emoji: "🏠", label: "Casa" });
    expect(r?.endpoints.b).toEqual({ emoji: "💦", label: "Cachoeira" });
    expect(r?.city?.name).toBe("Angatuba");
    expect(r?.city?.center).toEqual({ lat: -23.49, lng: -48.41 });
  });

  it("aceita link com acento no título", () => {
    const settings = { ...DEFAULT_SETTINGS, title: "Trilha da Cachoeira — São Paulo 🏞️" };
    const r = decodeShare(buildShareUrl(base({ settings })));
    expect(r?.settings.title).toBe(settings.title);
  });
});

describe("sharedSettingsOverrides", () => {
  it("leva as preferências do link, menos o formato de vídeo", () => {
    const over = sharedSettingsOverrides({
      ...DEFAULT_SETTINGS,
      title: "Do link",
      formatId: "mp4-h264",
    });
    expect(over.title).toBe("Do link");
    // o codec é decidido pelo navegador de quem abre, não por quem compartilha
    expect("formatId" in over).toBe(false);
  });

  it("leva junto a cor da rota, as marcas de km e a câmera cinematográfica", () => {
    const over = sharedSettingsOverrides({
      ...DEFAULT_SETTINGS,
      colorBy: "slope",
      showKmMarks: true,
      cinematic: true,
    });
    expect(over.colorBy).toBe("slope");
    expect(over.showKmMarks).toBe(true);
    expect(over.cinematic).toBe(true);
  });

  it("leva junto a terceira pessoa, o giro do mapa e a inclinação", () => {
    const over = sharedSettingsOverrides({
      ...DEFAULT_SETTINGS,
      thirdPerson: true,
      spinMap: true,
      tiltHorizonte: false,
    });
    expect(over.thirdPerson).toBe(true);
    expect(over.spinMap).toBe(true);
    expect(over.tiltHorizonte).toBe(false);
  });

  it("a cor da rota sobrevive à ida e à volta pelo link", () => {
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, colorBy: "speed", cinematic: true } }),
    );
    const r = decodeShare(url);
    expect(r?.settings.colorBy).toBe("speed");
    expect(r?.settings.cinematic).toBe(true);
  });

  it("a terceira pessoa sobrevive à ida e à volta pelo link", () => {
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, thirdPerson: true, spinMap: true } }),
    );
    const r = decodeShare(url);
    expect(r?.settings.thirdPerson).toBe(true);
    expect(r?.settings.spinMap).toBe(true);
  });

  it("as fotos NÃO entram no link (nem a da cartela, nem a das paradas)", () => {
    // uma foto de 640 px vira ~70 KB de texto: o link deixaria de passar por
    // mensageiro, então ele descreve a cena e as fotos ficam de fora
    const foto = "data:image/jpeg;base64," + "A".repeat(400);
    const url = buildShareUrl(
      base({
        settings: { ...DEFAULT_SETTINGS, cardPhoto: foto },
        pois: [
          {
            id: "p1",
            emoji: "🌉",
            label: "Ponte",
            color: "#38bdf8",
            t: 0.4,
            photo: foto,
          },
        ],
      }),
    );
    expect(url).not.toContain("data:image");
    const r = decodeShare(url);
    expect(r).not.toBeNull();
    // o que vem do link é o padrão (nada), e o app não deixa isso sobrescrever
    // a foto de quem abre a página
    expect(r?.settings.cardPhoto).toBe("");
    expect(sharedSettingsOverrides(r?.settings as never).cardPhoto).toBeUndefined();
    expect(r?.pois[0].photo).toBeUndefined();
    // e a parada em si continua indo, com o resto das informações
    expect(r?.pois[0].label).toBe("Ponte");
    expect(r?.pois[0].t).toBeCloseTo(0.4, 3);
  });

  it("o relevo viaja no link: quem abre vê o mesmo mapa", () => {
    const url = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, relevo: true } }));
    expect(decodeShare(url)?.settings.relevo).toBe(true);
    // e sem relevo a chave nem entra no link (o padrão fica de fora); quem
    // recebe fica com o padrão, que também é desligado
    const json = JSON.parse(
      atob(payloadOf(buildShareUrl(base())).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(json.s?.relevo).toBeUndefined();
    expect(decodeShare(buildShareUrl(base()))?.settings.relevo).toBe(false);
  });

  it("as marcas de dia viajam no link", () => {
    const url = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, dias: false } }));
    expect(decodeShare(url)?.settings.dias).toBe(false);
    expect(decodeShare(buildShareUrl(base()))?.settings.dias).toBe(true);
  });

  it("os melhores momentos viajam no link", () => {
    const url = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, recap: true } }));
    expect(decodeShare(url)?.settings.recap).toBe(true);
    // o padrão é desligado, e é isso que um link sem ajuste carrega
    expect(decodeShare(buildShareUrl(base()))?.settings.recap).toBe(false);
  });

  it("o boneco com o rosto viaja no link", () => {
    const url = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, boneco: "corre" } }));
    expect(decodeShare(url)?.settings.boneco).toBe("corre");
    // sem escolha, o link carrega o padrão (o selo de sempre)
    expect(decodeShare(buildShareUrl(base()))?.settings.boneco).toBe("off");
  });

  it("o fantasma à frente viaja no link (é parte da cena)", () => {
    const url = buildShareUrl(base({ settings: { ...DEFAULT_SETTINGS, ghost: true } }));
    expect(decodeShare(url)?.settings.ghost).toBe(true);
    const json = JSON.parse(
      atob(payloadOf(buildShareUrl(base())).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(json.s?.ghost).toBeUndefined();
    expect(decodeShare(buildShareUrl(base()))?.settings.ghost).toBe(false);
  });

  it("som e volume da música vão no link (o arquivo de música não)", () => {
    // o som é parte da cena: quem abre o link vê — e ouve — os pops do mesmo
    // jeito. A música é um arquivo de quem compartilha, e fica em casa.
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, som: false, musicaVolume: 0.3 } }),
    );
    const r = decodeShare(url);
    expect(r?.settings.som).toBe(false);
    expect(r?.settings.musicaVolume).toBeCloseTo(0.3, 5);
  });

  it("o logo da marca não vai no link, mas a placa clara vai", () => {
    // o logo é a marca de quem compartilha: no link, ou pesaria dezenas de KB,
    // ou trocaria a marca de quem abre. A placa clara é só uma escolha de leitura
    const logo = "data:image/png;base64," + "A".repeat(400);
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, logo, logoChip: true } }),
    );
    expect(url).not.toContain("data:image");
    const r = decodeShare(url);
    expect(r).not.toBeNull();
    expect(r?.settings.logo).toBe("");
    expect(sharedSettingsOverrides(r?.settings as never).logo).toBeUndefined();
    expect(r?.settings.logoChip).toBe(true);
  });

  it("a foto da partida e da chegada não entra no link", () => {
    // o link leva emoji e nome, mas não a foto: ~70 KB de texto não passam por
    // mensageiro, e a foto de quem abre continua sendo a dele
    const foto = "data:image/jpeg;base64," + "A".repeat(400);
    const url = buildShareUrl(
      base({
        endpoints: {
          a: { emoji: "🏠", label: "Casa", photo: foto },
          b: { emoji: "💦", label: "Cachoeira" },
        },
      }),
    );
    expect(url).not.toContain("data:image");
    const r = decodeShare(url);
    expect(r?.endpoints.a).toEqual({ emoji: "🏠", label: "Casa" });
    expect(r?.endpoints.b).toEqual({ emoji: "💦", label: "Cachoeira" });
  });

  it("um lugar que só tem foto não manda nada no link", () => {
    // o link carrega emoji e nome; sem nenhum dos dois não há o que dizer
    const url = buildShareUrl(
      base({
        endpoints: {
          a: { emoji: "", label: "", photo: "data:image/jpeg;base64," + "A".repeat(80) },
          b: null,
        },
      }),
    );
    const r = decodeShare(url);
    expect(r?.endpoints).toEqual({ a: null, b: null });
  });

  it("não altera o objeto original", () => {
    const original = { ...DEFAULT_SETTINGS, formatId: "webm" };
    sharedSettingsOverrides(original);
    expect(original.formatId).toBe("webm");
  });
});

describe("decodeShare com entrada inválida", () => {
  const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("devolve null para hash vazio ou ausente", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("#")).toBeNull();
    expect(decodeShare("#outra=coisa")).toBeNull();
  });

  it("devolve null para versão desconhecida", () => {
    expect(decodeShare(`#r=99.${b64({ v: 99, w: encodePolyline(PONTOS) })}`)).toBeNull();
  });

  it("devolve null para base64 corrompido", () => {
    expect(decodeShare("#r=1.isso-nao-e-base64!!!")).toBeNull();
  });

  it("devolve null para JSON que não é objeto", () => {
    expect(decodeShare(`#r=1.${b64(42)}`)).toBeNull();
  });

  it("não quebra com tipos errados em todos os campos", () => {
    const lixo = { v: 1, w: 123, s: "texto", p: "nao-e-lista", a: 7, b: {}, c: [] };
    expect(() => decodeShare(`#r=1.${b64(lixo)}`)).not.toThrow();
  });

  it("descarta pontos fora da faixa válida de coordenadas", () => {
    const w = encodePolyline([
      { lat: 999, lng: 0 },
      { lat: 0, lng: 500 },
      { lat: -23.5, lng: -48.4 },
    ]);
    const r = decodeShare(`#r=1.${b64({ v: 1, w })}`);
    expect(r?.waypoints).toEqual([{ lat: -23.5, lng: -48.4 }]);
  });

  it("não aceita cor fora do formato hexadecimal", () => {
    // o accent vai para dentro de CSS e do canvas: nada de url() ou expressão
    for (const accent of ["red", "url(javascript:alert(1))", "#ggg", "expression(1)"]) {
      const r = decodeShare(`#r=1.${b64({ v: 1, w: encodePolyline(PONTOS), s: { accent } })}`);
      expect(r?.settings.accent, accent).toBe(DEFAULT_SETTINGS.accent);
    }
  });

  it("não aceita tipo desconhecido de parada", () => {
    const r = decodeShare(`#r=1.${b64({ v: 1, w: encodePolyline(PONTOS), p: [[9999, 0.5]] })}`);
    expect(r?.pois).toEqual([]);
  });

  it("prende o gatilho das paradas entre 0,01 e 0,99", () => {
    const r = decodeShare(
      `#r=1.${b64({ v: 1, w: encodePolyline(PONTOS), p: [[0, 50], [1, -8]] })}`,
    );
    expect(r?.pois[0].t).toBe(0.99);
    expect(r?.pois[1].t).toBe(0.01);
  });

  it("limita a quantidade de pontos e de paradas", () => {
    const w = encodePolyline(
      Array.from({ length: 400 }, (_, i) => ({ lat: -20 - i * 0.001, lng: -48 })),
    );
    const p = Array.from({ length: 400 }, () => [0, 0.5]);
    const r = decodeShare(`#r=1.${b64({ v: 1, w, p })}`);
    expect(r?.waypoints.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    expect(r?.pois.length).toBeLessThanOrEqual(120);
  });

  it("corta textos absurdamente longos", () => {
    const s = { title: "a".repeat(5000), subtitle: "b".repeat(5000) };
    const r = decodeShare(`#r=1.${b64({ v: 1, w: encodePolyline(PONTOS), s })}`);
    expect(r?.settings.title.length).toBeLessThanOrEqual(120);
    expect(r?.settings.subtitle.length).toBeLessThanOrEqual(120);
  });

  it("descarta duração e zoom fora da faixa", () => {
    const s = { duration: 9999, followZoom: -5 };
    const r = decodeShare(`#r=1.${b64({ v: 1, w: encodePolyline(PONTOS), s })}`);
    expect(r?.settings.duration).toBe(DEFAULT_SETTINGS.duration);
    expect(r?.settings.followZoom).toBe(DEFAULT_SETTINGS.followZoom);
  });
});

describe("atividade no link", () => {
  it("vai e volta na url compartilhada", () => {
    const url = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, activity: "corrida" } }),
    );
    const lido = decodeShare(url);
    expect(lido?.settings.activity).toBe("corrida");
  });

  it("pedal (o padrão) não muda o link de quem não mexeu", () => {
    const comPadrao = buildShareUrl(base());
    const explicito = buildShareUrl(
      base({ settings: { ...DEFAULT_SETTINGS, activity: "pedal" } }),
    );
    expect(explicito).toBe(comPadrao);
  });

  it("um link antigo (sem atividade) abre em pedal, sem quebrar", () => {
    const lido = decodeShare(buildShareUrl(base()));
    expect(lido?.settings.activity).toBe("pedal");
  });
});
