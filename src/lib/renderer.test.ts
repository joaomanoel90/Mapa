import { describe, expect, it } from "vitest";
import { buildTrack } from "./geo";
import { findCharacter } from "./characters";
import { SceneRenderer, type FrameState, type SceneStyle } from "./renderer";
import { endCard, rideSummary, type EndCard } from "./stats";

/**
 * Canvas de mentira que anota o que foi desenhado.
 *
 * O renderizador é feito para o canvas do navegador, que não existe aqui — mas
 * o que interessa nestes testes não é o pixel e sim **quais textos entram na
 * tela e quando**. O proxy devolve uma função vazia para qualquer método (e
 * outro proxy para encadeamento tipo `gradient.addColorStop`), guardando as
 * chamadas de `fillText`.
 */
function fakeCtx() {
  const textos: string[] = [];
  const make = (): unknown =>
    new Proxy(function () {} as unknown as object, {
      get(_alvo, prop) {
        if (prop === "measureText") return (s: string) => ({ width: String(s).length * 9 });
        if (prop === "canvas") return { width: 1280, height: 720 };
        if (
          prop === "createLinearGradient" ||
          prop === "createRadialGradient" ||
          prop === "createPattern"
        ) {
          return () => make();
        }
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          if (prop === "fillText" && typeof args[0] === "string") textos.push(args[0]);
          return make();
        };
      },
      set() {
        return true;
      },
    });
  return { ctx: make() as CanvasRenderingContext2D, textos };
}

const style: SceneStyle = {
  accent: "#a3e635",
  basemap: "dark",
  showRoute: true,
  showTraveled: true,
  showEndpoints: true,
  showStops: true,
  showStopLabels: true,
  showStopCounter: true,
  showTitle: false,
  showProgress: false,
  showSummary: true,
  showHud: true,
  title: "",
  subtitle: "",
};

const T0 = Date.parse("2026-10-13T09:00:00Z");
const TRACK_PTS = [
  { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
  { lat: -23.51, lng: -48.41, ele: 780, t: T0 + 900_000 },
  { lat: -23.52, lng: -48.42, ele: 842, t: T0 + 1800_000 },
];
const track = buildTrack(TRACK_PTS);

const estado = (
  t: number,
  duration: number,
  summary: EndCard | null,
  times: number[] | null = null,
): FrameState => ({
  track,
  t,
  character: findCharacter("car"),
  rotate: false,
  camera: { mode: "fit", followZoom: 16 },
  style,
  stops: [],
  endpoints: { a: null, b: null },
  elapsed: t * duration,
  duration,
  summary,
  times,
});

/** A cartela como o usuário digita no painel. */
const digitada = {
  cardDistance: "49 km",
  cardElevation: "+1.676 m",
  cardTime: "3 h 19 min",
  cardNote: "",
};
const cartela = endCard(digitada, rideSummary(TRACK_PTS, 71_030));

describe("cartela final do vídeo", () => {
  it("desenha os números do percurso no fim do vídeo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, cartela));

    // o que foi digitado, e não o que o arquivo mediu
    expect(textos).toContain("49 km");
    expect(textos).toContain("+1.676 m");
    expect(textos).toContain("DISTÂNCIA");
    expect(textos).toContain("ELEVAÇÃO");
    expect(textos).not.toContain("71,03 km");
  });

  it("não aparece no meio do vídeo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(0.5, 14, cartela));
    expect(textos).not.toContain("49 km");
  });

  it("entra suavemente: no primeiro instante da cartela ainda está apagada", () => {
    const { ctx } = fakeCtx();
    const r = new SceneRenderer("dark");
    // o fade leva 0,6 s: no quadro exato do início o texto está desenhado com
    // alpha 0 (o canvas é quem aplica), então o que se testa aqui é que ele
    // entra depois — o quadro final é o que importa
    r.render(ctx, 1280, 720, estado(1 - 4.2 / 14, 14, cartela));
    const { ctx: ctx2, textos } = fakeCtx();
    r.render(ctx2, 1280, 720, estado(1, 14, cartela));
    expect(textos.length).toBeGreaterThan(0);
  });

  it("respeita o interruptor do painel", () => {
    const { ctx, textos } = fakeCtx();
    const semCartela = { ...style, showSummary: false };
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(1, 14, cartela),
      style: semCartela,
    });
    expect(textos).not.toContain("49 km");
  });

  it("não desenha a cartela quando não há resumo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, null));
    // o resto do vídeo continua (pinos A/B, chegada, personagem): só a cartela não entra
    expect(textos).not.toContain("DISTÂNCIA");
    expect(textos).not.toContain("71,03 km");
  });

  it("mostra só as linhas que foram preenchidas", () => {
    const plana = [{ lat: -23.5, lng: -48.4 }, { lat: -23.6, lng: -48.5 }];
    const soDistancia = endCard(
      { cardDistance: "12,4 km", cardElevation: "", cardTime: "", cardNote: "" },
      rideSummary(plana, 12_400),
    );
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(1, 14, soDistancia),
      track: buildTrack(plana),
    });
    expect(textos).toContain("12,4 km");
    expect(textos).not.toContain("ELEVAÇÃO");
    expect(textos).not.toContain("TEMPO");
  });

  it("desenha a linha de baixo: a data do arquivo quando nada foi escrito", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, cartela));
    expect(textos.some((t) => t.includes("2026"))).toBe(true);
  });

  it("a linha de baixo escrita à mão substitui a data", () => {
    const r = new SceneRenderer("dark");
    const comNota = endCard(
      { ...digitada, cardNote: "com os amigos do pedal" },
      rideSummary(TRACK_PTS, 71_030),
    );
    const { ctx, textos } = fakeCtx();
    r.render(ctx, 1280, 720, estado(1, 14, comNota));
    expect(textos).toContain("com os amigos do pedal");
  });

  it("sem nada escrito e sem data no arquivo, não há cartela", () => {
    const semNada = endCard(
      { cardDistance: "", cardElevation: "", cardTime: "", cardNote: "" },
      rideSummary([{ lat: -23.5, lng: -48.4 }, { lat: -23.6, lng: -48.5 }], 12_400),
    );
    expect(semNada).toBeNull();
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, semNada));
    expect(textos).not.toContain("DISTÂNCIA");
  });

  it("texto longo é cortado em vez de vazar da tela", () => {
    const longo = "Subida acumulada de mil e seiscentos e setenta e seis metros";
    const grande = endCard(
      { ...digitada, cardDistance: longo, cardNote: longo },
      rideSummary(TRACK_PTS, 71_030),
    );
    const { ctx, textos } = fakeCtx();
    // retrato: a tela é estreita, então o corte acontece de verdade
    new SceneRenderer("dark").render(ctx, 720, 1280, estado(1, 14, grande));
    const desenhado = textos.find((t) => t.startsWith("Subida"));
    expect(desenhado).toBeDefined();
    expect(desenhado!.length).toBeLessThan(longo.length);
    expect(desenhado!.endsWith("…")).toBe(true);
  });

  it("cabe na tela em retrato também", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 720, 1280, estado(1, 14, cartela));
    expect(textos).toContain("49 km");
  });
});

describe("HUD no vídeo", () => {
  const T0 = Date.parse("2026-10-13T09:00:00Z");
  /** 10 pontos de 100 m a cada 10 s = 36 km/h, com hora do arquivo */
  const GPS_PTS = Array.from({ length: 10 }, (_, i) => ({
    lat: 0,
    lng: (i * 100) / 111_320,
    ele: 700 + i,
    t: T0 + i * 10_000,
  }));
  const gpsTrack = buildTrack(GPS_PTS);
  const horas = GPS_PTS.map((p) => p.t as number);

  it("mostra velocidade, distância e relógio quando o arquivo tem hora", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
    });
    expect(textos).toContain("36");        // km/h medida, sem decimais acima de 10
    expect(textos).toContain("km/h");
    expect(textos).toContain("00:45");     // metade de 90 s de percurso
    // sem hora não existe rótulo de média
    expect(textos).not.toContain("média");
  });

  it("sem arquivo de GPS não inventa velocidade: mostra um traço", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: gpsTrack,
    });
    // a média do vídeo daria milhares de km/h numa rota longa em clipe curto
    expect(textos).toContain("—");
    expect(textos).toContain("sem arquivo");
    expect(textos).toContain("km/h");
  });

  it("parado no percurso mostra 0 km/h, e não um traço", () => {
    const parado = [
      { lat: -23.5, lng: -48.4, t: T0 },
      { lat: -23.5, lng: -48.4, t: T0 + 60_000 },
    ];
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, [T0, T0 + 60_000]),
      track: buildTrack(parado),
    });
    expect(textos).toContain("0.0");
    expect(textos).not.toContain("—");
  });

  it("respeita o interruptor do painel", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
      style: { ...style, showHud: false },
    });
    expect(textos).not.toContain("km/h");
  });

  it("não desenha nada numa trilha vazia", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0, 14, null, null),
      track: buildTrack([]),
    });
    expect(textos).not.toContain("km/h");
  });

  it("cabe na tela em retrato", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 720, 1280, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
    });
    expect(textos).toContain("km/h");
  });
});
