import { describe, expect, it } from "vitest";
import { indiceDoQuadro } from "./recorder";

/*
 * O `MediaRecorder` captura a tela no ritmo dela. Desenhando o instante do
 * relógio, cada captura leva um meio-caminho entre dois quadros do vídeo — o
 * arquivo sai com o movimento picado. Desenhando a **grade** do vídeo, cada
 * captura é um quadro inteiro do vídeo.
 *
 * O usuário viu isso no arquivo dele: *"mostra o video tambem travando"*, num
 * vídeo de 60 s em 720×1280 com 1.441 quadros. Os quadros eram da grade e o
 * passo entre eles era irregular (1/30 s e 1/50 s alternados) — sinal de que a
 * captura da tela estava escolhendo o instante, e não o quadro.
 */
describe("o quadro desenhado na gravação em tempo real", () => {
  it("sai na grade do vídeo, e não no instante do relógio", () => {
    // a tela de 60 Hz pede 60 quadros por segundo; o vídeo tem 24
    expect(indiceDoQuadro(0, 24, 240)).toBe(0);
    expect(indiceDoQuadro(0.016, 24, 240)).toBe(0);
    expect(indiceDoQuadro(0.0417, 24, 240)).toBe(1);
    expect(indiceDoQuadro(0.0834, 24, 240)).toBe(2);
    // no meio entre dois quadros do vídeo, ainda é o quadro de baixo
    expect(indiceDoQuadro(0.062, 24, 240)).toBe(1);
  });

  it("num segundo de tela saem exatamente os quadros do vídeo", () => {
    // 60 pedidos da tela (60 Hz) num vídeo de 24 quadros por segundo
    const pedidos = Array.from({ length: 60 }, (_, k) => k / 60);
    const distintos = new Set(pedidos.map((s) => indiceDoQuadro(s, 24, 24 * 10)));
    expect(distintos.size).toBe(24);
  });

  it("nunca repete um quadro para trás nem passa do último", () => {
    let anterior = -1;
    for (let k = 0; k < 600; k++) {
      const i = indiceDoQuadro(k / 60, 30, 200);
      expect(i).toBeGreaterThanOrEqual(anterior);
      expect(i).toBeLessThan(200);
      anterior = i;
    }
    // depois do fim, o último quadro (a animação não anda para trás)
    expect(indiceDoQuadro(99, 30, 200)).toBe(199);
    expect(indiceDoQuadro(-1, 30, 200)).toBe(0);
  });

  it("o tempo de vídeo de cada quadro é i/fps", () => {
    // é o segundo argumento entregue ao desenho (a abertura e a cartela usam)
    for (const fps of [24, 30, 60]) {
      for (const i of [0, 1, 7, 23, 1441]) {
        expect(indiceDoQuadro(i / fps, fps, 10_000) * (1 / fps)).toBeCloseTo(i / fps, 9);
      }
    }
  });
});
