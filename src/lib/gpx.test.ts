// @vitest-environment jsdom
// O parser usa DOMParser, que o Node não tem — daí o jsdom neste arquivo.
import { describe, expect, it } from "vitest";
import { haversine, type LatLng } from "./geo";
import { POI_KINDS } from "./pois";
import {
  GpxError,
  MAX_GPX_POINTS,
  decimate,
  gpxFileName,
  poiKindForSym,
  parseGpx,
  simplifyTo,
  toGpx,
} from "./gpx";

const NS = 'xmlns="http://www.topografix.com/GPX/1/1"';

const gpx = (conteudo: string, ns = NS) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="teste" ${ns}>${conteudo}</gpx>`;

const trk = (pontos: string, nome = "Trilha") =>
  `<trk><name>${nome}</name><trkseg>${pontos}</trkseg></trk>`;

const p = (lat: number, lng: number) => `<trkpt lat="${lat}" lon="${lng}" />`;

describe("parseGpx — traçado", () => {
  it("lê os pontos na ordem do arquivo", () => {
    const r = parseGpx(gpx(trk(p(-23.49, -48.41) + p(-23.5, -48.42) + p(-23.51, -48.43))));
    expect(r.points).toEqual([
      { lat: -23.49, lng: -48.41 },
      { lat: -23.5, lng: -48.42 },
      { lat: -23.51, lng: -48.43 },
    ]);
  });

  it("junta vários <trkseg> e conta quantos são", () => {
    const xml = gpx(
      `<trk><trkseg>${p(1, 1)}${p(2, 2)}</trkseg><trkseg>${p(3, 3)}</trkseg></trk>`,
    );
    const r = parseGpx(xml);
    expect(r.points).toHaveLength(3);
    expect(r.segments).toBe(2);
  });

  it("funciona sem namespace nenhum", () => {
    const r = parseGpx(gpx(trk(p(-23.49, -48.41) + p(-23.5, -48.42)), ""));
    expect(r.points).toHaveLength(2);
  });

  it("funciona com prefixo de namespace", () => {
    const xml =
      '<?xml version="1.0"?><gpx xmlns:g="http://www.topografix.com/GPX/1/1">' +
      `<g:trk><g:trkseg><g:trkpt lat="-23.49" lon="-48.41" /></g:trkseg></g:trk></gpx>`;
    expect(parseGpx(xml).points).toEqual([{ lat: -23.49, lng: -48.41 }]);
  });

  it("cai para <rtept> quando não há traçado", () => {
    const xml = gpx(`<rte><rtept lat="1" lon="2" /><rtept lat="3" lon="4" /></rte>`);
    expect(parseGpx(xml).points).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });

  it("ignora pontos com coordenada inválida ou ausente", () => {
    const xml = gpx(
      trk(
        p(-23.49, -48.41) +
          '<trkpt lat="abc" lon="1" />' +
          '<trkpt lat="999" lon="5" />' +
          '<trkpt lat="0" lon="500" />' +
          p(-23.5, -48.42),
      ),
    );
    expect(parseGpx(xml).points).toEqual([
      { lat: -23.49, lng: -48.41 },
      { lat: -23.5, lng: -48.42 },
    ]);
  });

  it("descarta ponto sem os dois atributos, em vez de assumir zero", () => {
    // `getAttribute` devolve null quando o atributo falta e `Number(null)` é 0:
    // sem a checagem, um `<trkpt>` sem `lat` viraria um ponto no equador
    const xml = gpx(
      trk(
        p(-23.49, -48.41) +
          '<trkpt lon="5" />' +
          '<trkpt lat="-23.5" />' +
          '<trkpt lat="" lon="" />' +
          p(-23.5, -48.42),
      ),
    );
    expect(parseGpx(xml).points).toEqual([
      { lat: -23.49, lng: -48.41 },
      { lat: -23.5, lng: -48.42 },
    ]);
  });

  it("ignora <ele> e <time> sem reclamar", () => {
    const xml = gpx(
      trk(
        `<trkpt lat="-23.49" lon="-48.41"><ele>750.5</ele><time>2026-10-13T10:00:00Z</time></trkpt>`,
      ),
    );
    expect(parseGpx(xml).points).toEqual([{ lat: -23.49, lng: -48.41 }]);
  });

  it("lê o nome do metadata e, sem ele, do traçado", () => {
    expect(
      parseGpx(gpx(`<metadata><name>Da metadata</name></metadata>` + trk(p(1, 1), "Do trk"))).name,
    ).toBe("Da metadata");
    expect(parseGpx(gpx(trk(p(1, 1), "Do trk"))).name).toBe("Do trk");
  });

  it("pega só o <name>, sem arrastar descrição e hora junto", () => {
    // ler o textContent do <metadata> inteiro colaria nome, descrição e hora
    const xml = gpx(
      `<metadata><name>Ida e volta</name><desc>5,2 km</desc><time>2026-10-13T12:00:00Z</time></metadata>` +
        trk(p(1, 1)),
    );
    expect(parseGpx(xml).name).toBe("Ida e volta");
  });

  it("não pega o nome do metadata de outro lugar", () => {
    const xml = gpx(`<wpt lat="1" lon="2"><name>Um ponto</name></wpt>` + trk(p(1, 1), "Do trk"));
    expect(parseGpx(xml).name).toBe("Do trk");
  });
});

describe("parseGpx — pontos soltos", () => {
  it("lê <wpt> com nome e símbolo", () => {
    const xml = gpx(
      `<wpt lat="-23.49" lon="-48.41"><name>Igreja Matriz</name><sym>Church</sym></wpt>` +
        trk(p(-23.49, -48.41) + p(-23.5, -48.42)),
    );
    const r = parseGpx(xml);
    expect(r.waypoints).toEqual([
      { lat: -23.49, lng: -48.41, name: "Igreja Matriz", sym: "Church" },
    ]);
  });

  it("aceita GPX só com pontos, sem traçado", () => {
    const r = parseGpx(gpx(`<wpt lat="1" lon="2" />`));
    expect(r.points).toEqual([]);
    expect(r.waypoints).toHaveLength(1);
  });

  it("ignora <wpt> com coordenada inválida", () => {
    expect(parseGpx(gpx(`<wpt lat="999" lon="2" />` + trk(p(1, 1)))).waypoints).toEqual([]);
  });
});

describe("parseGpx — XML inválido ou hostil", () => {
  it("recusa arquivo vazio", () => {
    expect(() => parseGpx("")).toThrow(GpxError);
    expect(() => parseGpx("   \n ")).toThrow(/vazio/i);
  });

  it("recusa DTD (vetor de expansão de entidades)", () => {
    // sem essa guarda, um arquivo com entidades aninhadas poderia explodir a memória
    const ataque = `<?xml version="1.0"?>
      <!DOCTYPE gpx [<!ENTITY a "x"><!ENTITY b "&a;&a;&a;">]>
      <gpx>${trk(p(1, 1))}</gpx>`;
    expect(() => parseGpx(ataque)).toThrow(/DTD/i);
  });

  it("recusa XML quebrado", () => {
    expect(() => parseGpx("<gpx><trk><trkseg>")).toThrow(GpxError);
  });

  it("recusa XML válido que não é GPX", () => {
    expect(() => parseGpx("<html><body>oi</body></html>")).toThrow(/GPX/i);
    expect(() => parseGpx('<?xml version="1.0"?><kml><Placemark /></kml>')).toThrow(/GPX/i);
  });

  it("recusa GPX sem nenhum ponto", () => {
    expect(() => parseGpx(gpx("<metadata><name>vazio</name></metadata>"))).toThrow(/ponto/i);
  });

  it("aguenta conteúdo exótico mas válido", () => {
    const nome = "&lt;&amp;&gt;&quot;&apos; ".repeat(50);
    const r = parseGpx(gpx(`<wpt lat="1" lon="2"><name>${nome}</name></wpt>` + trk(p(1, 1))));
    expect(r.waypoints[0].name).toContain("&");
  });

  it("reduz arquivos com pontos demais por amostragem, sem encurtar a rota", () => {
    const total = MAX_GPX_POINTS + 50;
    const pontos = Array.from({ length: total }, (_, i) => p(i * 0.0001, 0)).join("");
    const r = parseGpx(gpx(trk(pontos)));

    expect(r.reduced).toBe(true);
    expect(r.points).toHaveLength(MAX_GPX_POINTS);

    // o ponto final do arquivo tem de sobreviver: cortar por slice devolveria
    // uma rota que termina antes do fim, em silêncio
    const ultimo = r.points[r.points.length - 1];
    expect(ultimo.lat).toBeCloseTo((total - 1) * 0.0001, 6);
    expect(r.points[0]).toEqual({ lat: 0, lng: 0 });
  });

  it("não marca como reduzido o arquivo que cabe no teto", () => {
    expect(parseGpx(gpx(trk(p(1, 1) + p(2, 2)))).reduced).toBe(false);
  });
});

describe("decimate", () => {
  const linha = (n: number): LatLng[] =>
    Array.from({ length: n }, (_, i) => ({ lat: i * 0.001, lng: 0 }));

  it("devolve o mesmo quando já cabe", () => {
    const pontos = linha(10);
    expect(decimate(pontos, 20)).toEqual(pontos);
  });

  it("devolve exatamente o limite pedido", () => {
    expect(decimate(linha(10_000), 60)).toHaveLength(60);
    expect(decimate(linha(10_000), 1000)).toHaveLength(1000);
  });

  it("mantém o primeiro e o último ponto", () => {
    const pontos = linha(10_000);
    const r = decimate(pontos, 60);
    expect(r[0]).toEqual(pontos[0]);
    expect(r[r.length - 1]).toEqual(pontos[pontos.length - 1]);
  });

  it("distribui os pontos por todo o percurso", () => {
    // a cobertura tem de ser uniforme: nenhum trecho pode ficar sem amostra
    const pontos = linha(10_000);
    const r = decimate(pontos, 50);
    const saltos = r.slice(1).map((ponto, i) => ponto.lat - r[i].lat);
    expect(Math.max(...saltos)).toBeLessThan(Math.min(...saltos) * 1.1);
  });

  it("não altera a lista original", () => {
    const pontos = linha(500);
    const copia = [...pontos];
    decimate(pontos, 10);
    expect(pontos).toEqual(copia);
  });

  it("aguenta entradas degeneradas", () => {
    expect(decimate([], 10)).toEqual([]);
    expect(decimate(linha(100), 1)).toHaveLength(1);
    expect(decimate(linha(100), 2)).toHaveLength(2);
  });
});

describe("simplifyTo", () => {
  /** Reta com muitos pontos intermediários. */
  const reta = (n: number): LatLng[] =>
    Array.from({ length: n }, (_, i) => ({ lat: -23.5 + i * 0.0001, lng: -48.4 }));

  it("devolve o mesmo quando já cabe", () => {
    const pontos = reta(10);
    expect(simplifyTo(pontos, 60)).toEqual(pontos);
  });

  it("reduz até caber no limite", () => {
    const r = simplifyTo(reta(5000), 60);
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.length).toBeGreaterThan(1);
  });

  it("preserva o primeiro e o último ponto", () => {
    const pontos = reta(1000);
    const r = simplifyTo(pontos, 20);
    expect(r[0]).toEqual(pontos[0]);
    expect(r[r.length - 1]).toEqual(pontos[pontos.length - 1]);
  });

  it("mantém o vértice de uma curva", () => {
    // um "V": a ponta precisa sobreviver à simplificação
    const v: LatLng[] = [];
    for (let i = 0; i <= 50; i++) v.push({ lat: -23.5 - i * 0.0002, lng: -48.4 });
    for (let i = 1; i <= 50; i++) v.push({ lat: -23.51 + i * 0.0002, lng: -48.4 });
    const r = simplifyTo(v, 4);
    expect(r.length).toBeLessThanOrEqual(4);
    // a ponta do V é o ponto mais ao sul
    expect(r.some((x) => Math.abs(x.lat - -23.51) < 1e-9)).toBe(true);
  });

  it("não altera a lista original", () => {
    const pontos = reta(500);
    const copia = [...pontos];
    simplifyTo(pontos, 10);
    expect(pontos).toEqual(copia);
  });

  it("aguenta entradas degeneradas", () => {
    expect(simplifyTo([], 60)).toEqual([]);
    expect(simplifyTo([{ lat: 1, lng: 2 }], 60)).toEqual([{ lat: 1, lng: 2 }]);
    expect(simplifyTo(reta(100), 1)).toHaveLength(1);
  });

  it("respeita o limite de waypoints do app", () => {
    const r = simplifyTo(reta(20000), 60);
    expect(r.length).toBeLessThanOrEqual(60);
  });
});

describe("toGpx", () => {
  const dados = {
    points: [
      { lat: -23.4903, lng: -48.4128 },
      { lat: -23.4938, lng: -48.4186 },
    ],
    waypoints: [{ lat: -23.4938, lng: -48.4186, name: "Igreja Matriz", sym: "Church" }],
    name: "Volta por Angatuba",
    desc: "5,2 km",
  };

  it("declara o schema e o criador", () => {
    const xml = toGpx(dados, "2026-10-13T12:00:00.000Z");
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="RotaCast"');
    expect(xml).toContain("http://www.topografix.com/GPX/1/1");
    expect(xml).toContain("<time>2026-10-13T12:00:00.000Z</time>");
  });

  it("escreve coordenadas com 6 casas", () => {
    expect(toGpx(dados)).toContain('lat="-23.490300" lon="-48.412800"');
  });

  it("escreve nome, descrição e pontos soltos", () => {
    const xml = toGpx(dados);
    expect(xml).toContain("<name>Volta por Angatuba</name>");
    expect(xml).toContain("<desc>5,2 km</desc>");
    expect(xml).toContain("<sym>Church</sym>");
  });

  it("escapa caracteres que quebrariam o XML", () => {
    const xml = toGpx({
      points: [{ lat: 0, lng: 0 }],
      name: 'Café & "Bar" <do Zé>',
      waypoints: [{ lat: 0, lng: 0, name: "A & B <C>" }],
    });
    expect(xml).toContain("Café &amp; &quot;Bar&quot; &lt;do Zé&gt;");
    expect(xml).not.toContain("<do Zé>");
    // e o resultado continua sendo XML válido
    expect(() => parseGpx(xml)).not.toThrow();
  });

  it("usa um nome padrão quando não vem nenhum", () => {
    expect(toGpx({ points: [{ lat: 0, lng: 0 }] })).toContain("<name>Rota</name>");
  });

  it("fica válido mesmo sem pontos", () => {
    expect(() => toGpx({ points: [] })).not.toThrow();
  });
});

describe("ida e volta", () => {
  it("preserva o traçado, o nome e os pontos soltos", () => {
    const pontos = [
      { lat: -23.4903, lng: -48.4128 },
      { lat: -23.4938, lng: -48.4186 },
      { lat: -23.4975, lng: -48.4119 },
    ];
    const voltou = parseGpx(
      toGpx({
        points: pontos,
        name: "Ida e volta",
        waypoints: [{ lat: -23.4938, lng: -48.4186, name: "Praça" }],
      }),
    );
    expect(voltou.points).toEqual(pontos);
    expect(voltou.name).toBe("Ida e volta");
    expect(voltou.waypoints[0].name).toBe("Praça");
  });

  it("preserva a forma de um traçado simplificado", () => {
    const grande = Array.from({ length: 5000 }, (_, i) => ({
      lat: -23.5 + Math.sin(i / 200) * 0.01,
      lng: -48.4 + Math.cos(i / 200) * 0.01,
    }));
    const reduzido = simplifyTo(grande, 60);
    const voltou = parseGpx(toGpx({ points: reduzido }));

    expect(voltou.points).toHaveLength(reduzido.length);
    // o GPX guarda 6 casas (~11 cm): o arredondamento é do formato, não perda
    voltou.points.forEach((ponto, i) => {
      expect(ponto.lat).toBeCloseTo(reduzido[i].lat, 6);
      expect(ponto.lng).toBeCloseTo(reduzido[i].lng, 6);
    });
    // em metros: 6 casas decimais dão no máximo ~11 cm de erro
    const desvio = Math.max(...voltou.points.map((ponto, i) => haversine(ponto, reduzido[i])));
    expect(desvio).toBeLessThan(0.2);
  });
});

describe("poiKindForSym", () => {
  it("reconhece os símbolos do padrão Garmin", () => {
    expect(poiKindForSym("Church")).toBe("igreja");
    expect(poiKindForSym("Water Source")).toBe("cachoeira");
    expect(poiKindForSym("Summit")).toBe("mirante");
    expect(poiKindForSym("Campground")).toBe("camping");
    expect(poiKindForSym("Picnic Area")).toBe("parque");
  });

  it("ignora maiúsculas e minúsculas", () => {
    expect(poiKindForSym("CHURCH")).toBe("igreja");
    expect(poiKindForSym("church")).toBe("igreja");
  });

  it("usa o nome quando o símbolo não ajuda", () => {
    expect(poiKindForSym(undefined, "Cachoeira do Salto")).toBe("cachoeira");
    expect(poiKindForSym("", "Praia do Sino")).toBe("praia");
    expect(poiKindForSym(undefined, "Trilha do Morro")).toBe("trilha");
  });

  it("aceita o símbolo em português", () => {
    expect(poiKindForSym("Estação")).toBe("estacao");
    expect(poiKindForSym("Farmacia")).toBe("farmacia");
  });

  it("prefere o símbolo quando ele é mais específico que o nome", () => {
    expect(poiKindForSym("Restaurant", "Cachoeira")).toBe("restaurante");
  });

  it("cai no tipo padrão quando não reconhece nada", () => {
    expect(poiKindForSym("XYZ", "Ponto 1")).toBe("destino");
    expect(poiKindForSym()).toBe("destino");
    expect(poiKindForSym("", "   ")).toBe("destino");
  });

  it("sempre devolve um tipo existente", () => {
    // um id inválido faria makePoi cair no primeiro tipo da lista em silêncio
    for (const entrada of ["igreja", "zzz", "church", "", "praia", "???"]) {
      expect(POI_KINDS.some((k) => k.id === poiKindForSym(entrada))).toBe(true);
    }
  });
});

describe("gpxFileName", () => {
  it("tira acento e troca espaço por hífen", () => {
    expect(gpxFileName("Volta por Angatuba")).toMatch(/^volta-por-angatuba-\d{4}-\d{2}-\d{2}\.gpx$/);
    expect(gpxFileName("Trilha da Cachoeira — São Paulo")).not.toMatch(/[^\x20-\x7E]/);
  });

  it("remove caracteres proibidos", () => {
    const nome = gpxFileName('a/b\\c:d*e?f"g<h>i|j');
    expect(nome).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("nunca devolve nome vazio", () => {
    expect(gpxFileName("")).toMatch(/^rota-/);
    expect(gpxFileName("///")).toMatch(/^rota-/);
  });
});
