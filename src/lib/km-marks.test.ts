import { describe, expect, it } from "vitest";
import { buildTrack } from "./geo";
import { KM_STEPS, kmMarks, kmStep } from "./km-marks";

/** Distância acumulada linear: `totalMeters` dividido em `n` partes iguais. */
function cumLinear(totalMeters: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => (totalMeters * i) / n);
}

describe("passo das marcas", () => {
  it("encurta numa rota curta e aumenta numa longa", () => {
    expect(kmStep(3_400)).toBe(1);
    expect(kmStep(12_000)).toBe(1);
    expect(kmStep(49_000)).toBe(5);
    expect(kmStep(200_000)).toBe(20);
    expect(kmStep(400_000)).toBe(50);
  });

  it("nunca passa do teto de marcas", () => {
    for (const total of [1_000, 3_000, 12_500, 49_000, 137_000, 400_000, 2_000_000]) {
      const marcas = kmMarks(cumLinear(total, 2_000));
      expect(marcas.length).toBeLessThanOrEqual(12);
      expect(marcas.length).toBeGreaterThan(0);
    }
  });

  it("o passo é sempre um dos previstos", () => {
    expect(KM_STEPS).toContain(kmStep(49_000));
  });
});

describe("marcas ao longo do traçado", () => {
  it("marca o km redondo e aponta para o ponto correspondente", () => {
    const cum = cumLinear(49_000, 4_900); // um ponto a cada 10 m
    const marcas = kmMarks(cum);
    expect(marcas.map((m) => m.km)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45]);
    for (const m of marcas) {
      // o ponto escolhido é o primeiro que passa da marca
      expect(cum[m.index]).toBeGreaterThanOrEqual(m.km * 1000);
      expect(cum[m.index - 1]).toBeLessThan(m.km * 1000);
      expect(m.index).toBeGreaterThan(0);
      expect(m.index).toBeLessThan(cum.length);
    }
  });

  it("numa rota de 3 km marca os três quilômetros, com o número escrito", () => {
    const marcas = kmMarks(cumLinear(3_400, 340));
    expect(marcas.map((m) => m.km)).toEqual([1, 2, 3]);
    // passo de 1 km: tudo o que aparece leva número, senão a marca seria um
    // ponto mudo no meio do mapa
    expect(marcas.every((m) => m.label)).toBe(true);
  });

  it("na rota longa as marcas são redondas de 5 em 5 passos", () => {
    const marcas = kmMarks(cumLinear(200_000, 20_000));
    expect(marcas.length).toBe(10);
    // num passo de 20 km, a redonda é de 100 em 100 km
    expect(marcas.find((m) => m.km === 100)!.major).toBe(true);
    expect(marcas.find((m) => m.km === 20)!.major).toBe(false);
  });

  it("nenhuma marca fica muda, seja qual for o tamanho da rota", () => {
    // uma marca sem número é um ponto sem significado no meio do mapa: numa
    // rota de 435 km haviam sete pontos mudos e um único número
    for (const total of [3_400, 12_000, 49_000, 60_000, 200_000, 435_000, 700_000]) {
      const marcas = kmMarks(cumLinear(total, 2_000));
      expect(marcas.length).toBeGreaterThan(0);
      expect(marcas.every((m) => m.label)).toBe(true);
    }
  });

  it("não marca nada numa rota curta demais ou vazia", () => {
    expect(kmMarks(cumLinear(700, 70))).toEqual([]);
    expect(kmMarks([])).toEqual([]);
    expect(kmMarks([0])).toEqual([]);
  });

  it("aguenta traçado com pontos repetidos (parada no semáforo)", () => {
    const cum = [0, 0, 0, 1000, 1000, 2000, 3000];
    const marcas = kmMarks(cum);
    expect(marcas.map((m) => m.km)).toEqual([1, 2, 3]);
    expect(marcas[0].index).toBe(3);
  });

  it("funciona com o traçado de verdade", () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({
      lat: -23.5 + i * 0.00009,
      lng: -48.4,
    }));
    const track = buildTrack(pts);
    const marcas = kmMarks(track.cum);
    expect(marcas.length).toBeGreaterThan(2);
    expect(marcas[0].km).toBe(1);
  });
});
