import { describe, expect, it } from "vitest";
import { buildTrack, type LatLng } from "./geo";
import {
  MAX_SPEED_KMH,
  PACE_MIN_M,
  averagePace,
  elapsedAt,
  formatClock,
  formatPace,
  speedAt,
  timesOf,
} from "./hud";

/**
 * Percurso reto para leste, medido em graus, com as horas dadas.
 * 0,001 grau de longitude no equador dá ~111,3 m.
 */
function percurso(
  n: number,
  passoMs: number,
  metrosPorPasso = 100,
  t0 = Date.parse("2026-10-13T09:00:00Z"),
): LatLng[] {
  const grauPorMetro = 1 / 111_320;
  return Array.from({ length: n }, (_, i) => ({
    lat: 0,
    lng: (i * metrosPorPasso) * grauPorMetro,
    t: t0 + i * passoMs,
  }));
}

describe("timesOf", () => {
  it("devolve os tempos quando todos os pontos têm hora", () => {
    const pts = percurso(5, 1000);
    expect(timesOf(pts)?.map((t) => t)).toEqual(pts.map((p) => p.t));
  });

  it("devolve null sem hora nenhuma", () => {
    expect(timesOf([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }])).toBeNull();
  });

  it("devolve null com um ponto só datado: não dá para medir nada", () => {
    expect(timesOf([{ lat: 0, lng: 0, t: 1000 }, { lat: 0, lng: 1 }])).toBeNull();
  });

  it("marca com NaN o ponto que não tem hora, sem perder os outros", () => {
    const t = timesOf([
      { lat: 0, lng: 0, t: 1000 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2, t: 3000 },
    ]);
    expect(t![0]).toBe(1000);
    expect(Number.isNaN(t![1])).toBe(true);
    expect(t![2]).toBe(3000);
  });
});

describe("elapsedAt", () => {
  it("conta o tempo do percurso até o instante pedido", () => {
    // 10 pontos, 10 s entre eles, 100 m por passo
    const pts = percurso(10, 10_000);
    const track = buildTrack(pts);
    const tempos = timesOf(pts)!;

    expect(elapsedAt(pts, track.cum, 0, tempos)).toBe(0);
    expect(elapsedAt(pts, track.cum, 1, tempos)).toBe(90); // 9 intervalos de 10 s
    // metade do caminho: 4,5 intervalos em distância = 45 s
    expect(elapsedAt(pts, track.cum, 0.5, tempos)).toBeCloseTo(45, 1);
  });

  it("acompanha a distância, não o índice", () => {
    // passos de tamanhos diferentes: o relógio segue a distância de cada ponto
    const pts: LatLng[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0, lng: 0.001, t: 10_000 }, // 1 unidade
      { lat: 0, lng: 0.005, t: 20_000 }, // 4 unidades
    ];
    const track = buildTrack(pts);
    const tempos = timesOf(pts)!;
    // 1/5 do caminho está exatamente no segundo ponto: 10 s
    expect(elapsedAt(pts, track.cum, 0.2, tempos)).toBeCloseTo(10, 1);
  });

  it("devolve null sem hora", () => {
    const pts = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }];
    const tempos = timesOf(pts);
    expect(tempos).toBeNull();
    expect(elapsedAt(pts, buildTrack(pts).cum, 0.5, [NaN, NaN])).toBeNull();
  });

  it("aguenta buraco de hora no meio do traçado", () => {
    const pts = percurso(6, 10_000);
    const comBuraco = pts.map((p, i) => (i === 3 ? { lat: p.lat, lng: p.lng } : p));
    const tempos = timesOf(comBuraco)!;
    const track = buildTrack(comBuraco);
    const meio = elapsedAt(comBuraco, track.cum, 0.5, tempos);
    expect(meio).not.toBeNull();
    expect(meio!).toBeGreaterThan(0);
    expect(meio!).toBeLessThan(80);
  });
});

describe("speedAt", () => {
  it("mede a velocidade de um percurso constante", () => {
    // 100 m a cada 10 s = 10 m/s = 36 km/h
    const pts = percurso(20, 10_000);
    const track = buildTrack(pts);
    const tempos = timesOf(pts)!;
    const v = speedAt(pts, track.cum, 0.5, tempos)!;
    expect(v).toBeGreaterThan(34);
    expect(v).toBeLessThan(38);
  });

  it("a janela amortece o ponto fora de lugar", () => {
    // caminhada de ~5 km/h (14 m a cada 10 s) com um ponto adiantado 500 m
    const pts = percurso(30, 10_000, 14);
    pts[15] = { ...pts[15], lng: pts[15].lng + 500 / 111_320 };
    const track = buildTrack(pts);
    const tempos = timesOf(pts)!;
    const v = speedAt(pts, track.cum, 0.5, tempos);
    expect(v).not.toBeNull();
    // o trecho entre os pontos salta para ~180 km/h; a janela derruba isso
    expect(v!).toBeLessThan(MAX_SPEED_KMH);
    // e o valor fica perto da caminhada (~5 km/h), não do pulo
    expect(v!).toBeLessThan(10);
    expect(v!).toBeGreaterThan(2);
  });

  it("devolve null sem hora em vez de inventar velocidade", () => {
    const pts = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }];
    expect(timesOf(pts)).toBeNull();
    expect(speedAt(pts, buildTrack(pts).cum, 0.5, [NaN, NaN])).toBeNull();
  });

  it("devolve null quando o percurso está parado (divisão por zero)", () => {
    const pts: LatLng[] = [
      { lat: -23.5, lng: -48.4, t: 0 },
      { lat: -23.5, lng: -48.4, t: 60_000 },
    ];
    expect(speedAt(pts, buildTrack(pts).cum, 0.5, timesOf(pts)!)).toBeNull();
  });

  it("corta salto absurdo de GPS", () => {
    // 20 km em 10 s: nenhum veículo no app chega a isso
    const pts: LatLng[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0, lng: 0.18, t: 10_000 },
    ];
    expect(speedAt(pts, buildTrack(pts).cum, 0.5, timesOf(pts)!)).toBeNull();
    expect(MAX_SPEED_KMH).toBeLessThan(200);
  });

  it("funciona nas duas pontas do vídeo", () => {
    const pts = percurso(20, 10_000);
    const track = buildTrack(pts);
    const tempos = timesOf(pts)!;
    expect(speedAt(pts, track.cum, 0, tempos)).toBeGreaterThan(0);
    expect(speedAt(pts, track.cum, 1, tempos)).toBeGreaterThan(0);
  });
});

describe("formatClock", () => {
  it("usa mm:ss abaixo de uma hora", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(45)).toBe("00:45");
    expect(formatClock(3599)).toBe("59:59");
  });

  it("acima de uma hora vira h:mm:ss", () => {
    // a pedalada da cartela (3 h 19 min) não pode virar "199:00"
    expect(formatClock(3 * 3600 + 19 * 60)).toBe("3:19:00");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(5970)).toBe("1:39:30");
  });

  it("não deixa passar tempo negativo", () => {
    expect(formatClock(-10)).toBe("00:00");
  });
});

describe("ritmo (min/km)", () => {
  it("formata no padrão de corredor: 5:24 por km", () => {
    expect(formatPace(324)).toBe("5:24");
    expect(formatPace(300)).toBe("5:00");
    expect(formatPace(59)).toBe("0:59");
    expect(formatPace(0)).toBe("0:00");
    // ritmo absurdo (dado esquisito) não vira número ambíguo
    expect(formatPace(3725)).toBe("1:02:05");
  });

  it("arredonda para o segundo, como o relógio de corrida", () => {
    expect(formatPace(324.4)).toBe("5:24");
    expect(formatPace(324.6)).toBe("5:25");
  });

  it("calcula a média do percurso: tempo total dividido pela distância", () => {
    // 5 km em 25 min = 5:00/km
    expect(averagePace(1500, 5000)).toBeCloseTo(300, 6);
    // 10 km em 1 h
    expect(averagePace(3600, 10_000)).toBeCloseTo(360, 6);
  });

  it("não inventa ritmo sem tempo nem em percurso curto demais", () => {
    expect(averagePace(null, 5000)).toBeNull();
    expect(averagePace(undefined, 5000)).toBeNull();
    expect(averagePace(0, 5000)).toBeNull();
    expect(averagePace(-10, 5000)).toBeNull();
    expect(averagePace(Number.NaN, 5000)).toBeNull();
    // ritmo sobre 30 m é ruído de GPS, não ritmo
    expect(averagePace(1200, PACE_MIN_M - 1)).toBeNull();
    expect(averagePace(1200, 0)).toBeNull();
    expect(averagePace(1200, PACE_MIN_M)).toBeCloseTo(24_000, 6);
  });

  it("o ritmo é o inverso da velocidade média", () => {
    // 12 km/h = 5:00/km
    const seg = averagePace(600, 2000)!; // 2 km em 10 min
    const kmh = (2000 / 600) * 3.6;
    expect(kmh).toBeCloseTo(12, 6);
    expect(formatPace(seg)).toBe("5:00");
  });
});
