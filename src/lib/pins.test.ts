import { describe, expect, it } from "vitest";
import { MAX_WAYPOINTS } from "./settings";
import { PIN_DOT_LIMIT, keepsMarker, pinsAsDots } from "./pins";

describe("pinsAsDots", () => {
  it("desenha marcadores arrastáveis enquanto cabem", () => {
    expect(pinsAsDots(0)).toBe(false);
    expect(pinsAsDots(2)).toBe(false);
    expect(pinsAsDots(PIN_DOT_LIMIT)).toBe(false);
  });

  it("passa a desenhar pontos quando passa do limite", () => {
    expect(pinsAsDots(PIN_DOT_LIMIT + 1)).toBe(true);
    expect(pinsAsDots(3_000)).toBe(true);
  });

  it("o limite é baixo o bastante para o arrasto não travar", () => {
    // centenas de marcadores arrastáveis já pesam; milhares travam
    expect(PIN_DOT_LIMIT).toBeLessThanOrEqual(500);
    expect(PIN_DOT_LIMIT).toBeGreaterThan(0);
  });
});

describe("keepsMarker", () => {
  const total = 3_000;

  it("mantém a partida e a chegada como marcadores", () => {
    expect(keepsMarker(0, total, null)).toBe(true);
    expect(keepsMarker(total - 1, total, null)).toBe(true);
  });

  it("mantém o pino escolhido, que é como se arrasta um ponto específico", () => {
    expect(keepsMarker(1_234, total, 1_234)).toBe(true);
    expect(keepsMarker(1_234, total, null)).toBe(false);
    expect(keepsMarker(1_234, total, 999)).toBe(false);
  });

  it("com dois pinos não repete o mesmo índice", () => {
    expect(keepsMarker(0, 2, null)).toBe(true);
    expect(keepsMarker(1, 2, null)).toBe(true);
  });
});

describe("teto de paradas", () => {
  it("comporta milhares de pinos", () => {
    expect(MAX_WAYPOINTS).toBeGreaterThanOrEqual(3_000);
  });

  it("é maior que o limite de pontos no mapa, senão a regra nunca valeria", () => {
    expect(MAX_WAYPOINTS).toBeGreaterThan(PIN_DOT_LIMIT);
  });
});
