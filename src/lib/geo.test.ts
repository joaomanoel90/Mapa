import { describe, expect, it } from "vitest";
import {
  bearing,
  buildTrack,
  fitZoom,
  formatDistance,
  formatTime,
  haversine,
  nearestTOnTrack,
  nudge,
  sampleTrack,
} from "./geo";

describe("haversine", () => {
  it("mede um grau de latitude (~111 km)", () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("é zero para o mesmo ponto", () => {
    expect(haversine({ lat: -23.5, lng: -48.4 }, { lat: -23.5, lng: -48.4 })).toBe(0);
  });

  it("é simétrica", () => {
    const a = { lat: -23.5613, lng: -46.6565 };
    const b = { lat: -22.9711, lng: -43.1822 };
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
  });
});

describe("bearing", () => {
  it("aponta para o norte", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 4);
  });

  it("aponta para o leste", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 4);
  });

  it("aponta para o sul", () => {
    expect(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }))).toBeCloseTo(180, 4);
  });
});

describe("buildTrack", () => {
  it("acumula distância a partir de zero", () => {
    const t = buildTrack([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 2, lng: 0 },
    ]);
    expect(t.cum[0]).toBe(0);
    expect(t.cum).toHaveLength(3);
    expect(t.total).toBeCloseTo(t.cum[2], 6);
    // a distância acumulada nunca diminui
    for (let i = 1; i < t.cum.length; i++) {
      expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1]);
    }
  });

  it("aguenta lista vazia e lista de um ponto", () => {
    // cum sempre começa em 0, mesmo sem pontos — sampleTrack nem chega a usá-lo
    expect(buildTrack([])).toEqual({ pts: [], cum: [0], total: 0 });
    const one = buildTrack([{ lat: 1, lng: 2 }]);
    expect(one.total).toBe(0);
    expect(one.pts).toHaveLength(1);
  });

  it("reduz trilhas muito longas preservando as pontas", () => {
    const input = Array.from({ length: 3000 }, (_, i) => ({ lat: -23 + i * 0.0001, lng: -48 }));
    const t = buildTrack(input);
    expect(t.pts.length).toBeLessThan(input.length);
    expect(t.pts[0]).toEqual(input[0]);
    expect(t.pts[t.pts.length - 1]).toEqual(input[input.length - 1]);
  });
});

describe("sampleTrack", () => {
  const track = buildTrack([
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ]);

  it("devolve as pontas em t=0 e t=1", () => {
    expect(sampleTrack(track, 0).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(track, 1).pos).toEqual({ lat: 1, lng: 0 });
  });

  it("interpola no meio", () => {
    const mid = sampleTrack(track, 0.5).pos;
    expect(mid.lat).toBeCloseTo(0.5, 6);
    expect(mid.lng).toBeCloseTo(0, 6);
  });

  it("prende t fora de 0..1", () => {
    expect(sampleTrack(track, -5).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(track, 9).pos).toEqual({ lat: 1, lng: 0 });
  });

  it("trata t inválido sem quebrar", () => {
    expect(sampleTrack(track, NaN).pos).toEqual({ lat: 0, lng: 0 });
  });

  it("não quebra com trilha vazia ou de um ponto", () => {
    expect(sampleTrack(buildTrack([]), 0.5).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(buildTrack([{ lat: 5, lng: 6 }]), 0.5).pos).toEqual({ lat: 5, lng: 6 });
  });
});

describe("fitZoom", () => {
  it("aproxima mais quando a área é menor", () => {
    const small = fitZoom({ north: 1, south: 0, east: 1, west: 0 }, 1280, 720);
    const large = fitZoom({ north: 40, south: -40, east: 40, west: -40 }, 1280, 720);
    expect(small).toBeGreaterThan(large);
  });

  it("encaixa uma área larga melhor num quadro largo", () => {
    const wide = { north: 0.1, south: -0.1, east: 10, west: -10 };
    expect(fitZoom(wide, 1280, 720)).toBeGreaterThan(fitZoom(wide, 720, 1280));
  });

  it("encaixa uma área alta melhor num quadro em pé", () => {
    const tall = { north: 10, south: -10, east: 0.1, west: -0.1 };
    expect(fitZoom(tall, 720, 1280)).toBeGreaterThan(fitZoom(tall, 1280, 720));
  });

  it("nunca devolve zoom negativo", () => {
    const mundo = { north: 85, south: -85, east: 180, west: -180 };
    expect(fitZoom(mundo, 320, 200)).toBeGreaterThanOrEqual(0);
  });
});

describe("nearestTOnTrack", () => {
  const track = buildTrack([
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ]);

  it("encontra o ponto sobre a linha", () => {
    const r = nearestTOnTrack(track, { lat: 0.5, lng: 0 });
    expect(r.t).toBeCloseTo(0.5, 3);
    expect(r.offset).toBeLessThan(1);
  });

  it("mede o afastamento de um ponto fora da linha", () => {
    const r = nearestTOnTrack(track, { lat: 0.5, lng: 0.01 });
    expect(r.offset).toBeGreaterThan(500);
    expect(r.t).toBeCloseTo(0.5, 2);
  });
});

describe("nudge", () => {
  it("desloca ~1000 m para o norte", () => {
    const p = nudge({ lat: 0, lng: 0 }, 0, 1000);
    expect(p.lat).toBeCloseTo(1000 / 111320, 6);
    expect(p.lng).toBeCloseTo(0, 9);
  });

  it("é reversível", () => {
    const p = nudge(nudge({ lat: -23.5, lng: -48.4 }, 250, 0), -250, 0);
    expect(p.lat).toBeCloseTo(-23.5, 9);
    expect(p.lng).toBeCloseTo(-48.4, 9);
  });
});

describe("formatadores", () => {
  it("formata distância em metros e quilômetros", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toMatch(/^1 km$/);
    expect(formatDistance(1500)).toMatch(/^1[.,]5 km$/);
  });

  it("devolve travessão para distância inválida", () => {
    expect(formatDistance(NaN)).toBe("—");
    expect(formatDistance(Infinity)).toBe("—");
  });

  it("formata tempo como mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(-5)).toBe("00:00");
  });
});
