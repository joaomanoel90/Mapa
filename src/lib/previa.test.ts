import { describe, expect, it } from "vitest";
import { PREVIA_ESPERA_MS, PREVIA_MINIMO, blocosEssenciais } from "./previa";

/*
 * A prévia andava enquanto os blocos chegavam — o mapa aparecendo aos pedaços na
 * frente de quem olhava ("na prévia não funcionou"). Agora ela espera o começo.
 */
describe("quantos blocos a prévia espera antes de tocar", () => {
  it("espera o começo do percurso, não a rota inteira", () => {
    // os 600 blocos de uma rota de 21 km em 9:16: espera ~90, toca, e o resto
    // chega durante o percurso
    expect(blocosEssenciais(600)).toBe(90);
    expect(blocosEssenciais(2000)).toBe(300);
  });

  it("numa rota curta espera todos — não há por que dividir", () => {
    expect(blocosEssenciais(30)).toBe(30);
    expect(blocosEssenciais(12)).toBe(12);
    // e o piso vale quando 15% é pouco
    expect(blocosEssenciais(100)).toBe(PREVIA_MINIMO);
  });

  it("nunca pede mais do que existe, nem número negativo", () => {
    for (const total of [0, -5, 1, 39, 40, 41, 600, 1223]) {
      const n = blocosEssenciais(total);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(Math.max(0, total));
    }
  });

  it("a espera tem teto de tempo", () => {
    // rede ruim: o mapa começa mesmo sem os blocos essenciais
    expect(PREVIA_ESPERA_MS).toBeGreaterThan(3000);
    expect(PREVIA_ESPERA_MS).toBeLessThan(30000);
  });
});
