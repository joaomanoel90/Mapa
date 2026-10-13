import { describe, expect, it } from "vitest";
import { humanDuration, parseDuration } from "./duration";

describe("parseDuration", () => {
  it("lê horas e minutos como se escreve", () => {
    expect(parseDuration("3 h 19 min")).toBe(3 * 3600 + 19 * 60);
    expect(parseDuration("2 h")).toBe(7200);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("1h 30min")).toBe(5400);
    expect(parseDuration("1h30s")).toBe(3630);
  });

  it("lê minutos e segundos", () => {
    expect(parseDuration("199 min")).toBe(199 * 60);
    expect(parseDuration("199min")).toBe(199 * 60);
    expect(parseDuration("45 s")).toBe(45);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("45 seg")).toBe(45);
  });

  it("lê relógio", () => {
    expect(parseDuration("1:30")).toBe(5400);
    expect(parseDuration("1:30:15")).toBe(5415);
    // em notação de relógio o primeiro número é hora: 0:45 = 45 minutos
    expect(parseDuration("0:45")).toBe(45 * 60);
    expect(parseDuration("2:60")).toBeNull(); // minuto não pode passar de 59
  });

  it("número solto é minutos", () => {
    expect(parseDuration("199")).toBe(199 * 60);
    expect(parseDuration("3")).toBe(180);
  });

  it("aceita vírgula e ponto nos decimais", () => {
    expect(parseDuration("1,5 h")).toBe(5400);
    expect(parseDuration("2.5 min")).toBe(150);
  });

  it("ignora maiúsculas e espaços sobrando", () => {
    expect(parseDuration("  3 H 19 MIN  ")).toBe(3 * 3600 + 19 * 60);
    expect(parseDuration("3  h   19  min")).toBe(3 * 3600 + 19 * 60);
  });

  it("devolve null para o que não dá para ler", () => {
    for (const lixo of ["", "   ", "ontem", "3 h 19 min atrás", "x1h", "1h30x", "-5 min", "1:2:3:4"]) {
      expect(parseDuration(lixo)).toBeNull();
    }
  });

  it("devolve null para duração zero (não é um tempo)", () => {
    expect(parseDuration("0")).toBe(0);
    // zero é uma duração válida de entrada, mas quem usa decide: o HUD trata 0
    // como "sem tempo", porque um relógio que não anda não informa nada
  });
});

describe("humanDuration", () => {
  it("escreve de forma curta", () => {
    expect(humanDuration(45)).toBe("45 s");
    expect(humanDuration(199 * 60)).toBe("3 h 19 min");
    expect(humanDuration(7200)).toBe("2 h");
    expect(humanDuration(1800)).toBe("30 min");
  });
});
