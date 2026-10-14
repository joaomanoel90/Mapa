import { describe, expect, it } from "vitest";
import { buildTrack, cumulative, type LatLng } from "./geo";
import {
  COLOR_BANDS,
  colorizeRoute,
  dataCoverage,
  slopeBand,
  speedBands,
} from "./coloring";

const T0 = Date.parse("2026-10-13T09:00:00Z");

/**
 * Traçado reto para o norte, um ponto a cada 10 m, com altitude e/ou hora
 * vindo de uma função. Assim cada teste escolhe só o que quer medir.
 */
function reta(
  n: number,
  opts: { ele?: (i: number) => number; t?: (i: number) => number | null } = {},
): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const p: LatLng = { lat: -23.5 + i * 0.00009, lng: -48.4 }; // ~10 m por ponto
    if (opts.ele) p.ele = opts.ele(i);
    if (opts.t) {
      const v = opts.t(i);
      if (v !== null) p.t = v;
    }
    pts.push(p);
  }
  return pts;
}

/** Ruído determinístico (sem `Math.random`, para o teste não tremer). */
const ruido = (i: number) => 2 * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);

describe("cobertura do arquivo", () => {
  it("conta quantos pontos têm elevação e hora", () => {
    const pts = reta(10, { ele: (i) => (i < 5 ? 700 : NaN), t: (i) => (i < 2 ? T0 + i : null) });
    const c = dataCoverage(pts);
    expect(c.ele).toBeCloseTo(0.5, 6);
    expect(c.time).toBeCloseTo(0.2, 6);
  });

  it("não divide por zero num traçado vazio", () => {
    expect(dataCoverage([])).toEqual({ ele: 0, time: 0 });
  });
});

describe("coloração por inclinação", () => {
  it("pinta a subida de quente e a descida de frio", () => {
    const subindo = reta(400, { ele: (i) => 700 + i * 0.5 }); // 0,5 m a cada 10 m = 5%
    const descendo = reta(400, { ele: (i) => 900 - i * 0.5 });
    const plano = reta(400, { ele: () => 700 });

    const up = colorizeRoute({ pts: subindo, cum: cumulative(subindo), times: null, mode: "slope" })!;
    const down = colorizeRoute({ pts: descendo, cum: cumulative(descendo), times: null, mode: "slope" })!;
    const flat = colorizeRoute({ pts: plano, cum: cumulative(plano), times: null, mode: "slope" })!;

    const meio = (c: typeof up) => c.values[Math.floor(c.values.length / 2)];
    expect(meio(up)).toBeCloseTo(5, 1);
    expect(meio(down)).toBeCloseTo(-5, 1);
    expect(Math.abs(meio(flat))).toBeLessThan(0.5);

    // 5% é parede: faixa quente. −5% é descida: faixa fria. Plano: o miolo.
    expect(slopeBand(meio(up))).toBeGreaterThanOrEqual(6);
    expect(slopeBand(meio(down))).toBeLessThanOrEqual(2);
    expect(slopeBand(meio(flat))).toBe(4);
    expect(up.colors[up.bands[200]]).toMatch(/^#/);
  });

  it("o barulho do GPS não vira rampa", () => {
    // plano com ±2 m de barulho ponto a ponto: entre dois pontos vizinhos
    // (10 m) isso seria 40% de rampa, mas a janela de 200 m desmancha o ruído
    const pts = reta(600, { ele: (i) => 700 + ruido(i) });
    const c = colorizeRoute({ pts, cum: cumulative(pts), times: null, mode: "slope" })!;
    const altos = c.values.filter((v) => Math.abs(v) > 2).length;
    expect(altos / c.values.length).toBeLessThan(0.05);
  });

  it("um ponto fora do lugar não pinta o percurso inteiro", () => {
    const pts = reta(600, { ele: (i) => (i === 300 ? 760 : 700) });
    const c = colorizeRoute({ pts, cum: cumulative(pts), times: null, mode: "slope" })!;
    const quentes = c.bands.filter((b) => b >= 7).length;
    expect(quentes / c.bands.length).toBeLessThan(0.05);
  });

  it("sem elevação no arquivo não há o que pintar", () => {
    const pts = reta(50);
    expect(colorizeRoute({ pts, cum: cumulative(pts), times: null, mode: "slope" })).toBeNull();
  });
});

describe("coloração por velocidade", () => {
  it("usa a escala do próprio percurso", () => {
    // 200 pontos a 12 km/h e 200 a 36 km/h: as duas velocidades existem, e é
    // isso que a legenda mostrada precisa refletir
    const pts = reta(400, { t: (i) => T0 + i * (i < 200 ? 3000 : 1000) });
    const times = pts.map((p) => p.t as number);
    const c = colorizeRoute({ pts, cum: cumulative(pts), times, mode: "speed" })!;
    expect(c.unit).toBe("km/h");
    const baixos = Number(c.lowLabel);
    const altos = Number(c.highLabel);
    expect(baixos).toBeGreaterThan(8);
    expect(altos).toBeGreaterThan(baixos + 5);
    // as duas metades caem em faixas diferentes — é o que a cor precisa mostrar
    const primeira = c.bands[100];
    const segunda = c.bands[300];
    expect(Number.isFinite(primeira)).toBe(true);
    expect(Number.isFinite(segunda)).toBe(true);
    expect(segunda).toBeGreaterThan(primeira);
  });

  it("percurso parado abre uma faixa mínima em vez de virar borrão", () => {
    const { bands, low, high } = speedBands([10, 10.2, 9.8, 10.1]);
    expect(high - low).toBeCloseTo(3, 6);
    expect(bands.every((b) => b >= 0 && b <= COLOR_BANDS - 1)).toBe(true);
  });

  it("ponto sem hora fica sem faixa (cinza na tela)", () => {
    const pts = reta(60, { t: (i) => (i < 30 ? T0 + i * 2000 : null) });
    const times = pts.map((p) => (Number.isFinite(p.t as number) ? (p.t as number) : NaN));
    const c = colorizeRoute({ pts, cum: cumulative(pts), times, mode: "speed" })!;
    expect(Number.isFinite(c.bands[10])).toBe(true);
    expect(Number.isNaN(c.bands[50])).toBe(true);
    expect(c.measured).toBeGreaterThan(10);
  });

  it("sem hora no arquivo não há velocidade para pintar", () => {
    const pts = reta(50);
    expect(colorizeRoute({ pts, cum: cumulative(pts), times: null, mode: "speed" })).toBeNull();
  });
});

describe("modo sólido", () => {
  it("não calcula nada quando a linha é sólida", () => {
    const pts = reta(50, { ele: (i) => 700 + i });
    const c = colorizeRoute({
      pts,
      cum: cumulative(pts),
      times: null,
      mode: "solid",
    });
    expect(c).toBeNull();
  });

  it("traçado vazio não quebra", () => {
    const t = buildTrack([]);
    expect(colorizeRoute({ pts: t.pts, cum: t.cum, times: null, mode: "slope" })).toBeNull();
  });
});
