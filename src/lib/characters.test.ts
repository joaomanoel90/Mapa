import { describe, expect, it } from "vitest";
import { CHARACTERS, findCharacter, gaitOf } from "./characters";

/**
 * A lista de personagens.
 *
 * O painel é uma grade com busca, então o número de personagens não é o
 * problema — o problema seria um id repetido (o escolhido no link abriria no
 * outro) ou um personagem sem nome. É isso que se prova aqui, além dos dois
 * **compostos** (peregrino e padre), que não existem em emoji e são montados
 * com um acessório.
 */

const GRUPOS = [
  "Veículos",
  "Pessoas",
  "Ofícios",
  "Bichos",
  "Voadores",
  "Esportes",
  "Animados",
];

describe("a lista de personagens", () => {
  it("não tem id repetido", () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo personagem tem nome, emoji e um grupo conhecido", () => {
    for (const c of CHARACTERS) {
      expect(c.name.trim(), c.id).not.toBe("");
      expect(c.emoji.trim(), c.id).not.toBe("");
      expect(GRUPOS, c.id).toContain(c.group);
      expect(c.size ?? 1, c.id).toBeGreaterThan(0);
    }
  });

  it("todo grupo tem pelo menos um personagem (senão a seção nasce vazia)", () => {
    for (const grupo of GRUPOS) {
      expect(CHARACTERS.some((c) => c.group === grupo), grupo).toBe(true);
    }
  });

  it("id desconhecido cai no primeiro personagem, e não em `undefined`", () => {
    expect(findCharacter("nao-existe").id).toBe(CHARACTERS[0].id);
    expect(findCharacter("")).toBe(CHARACTERS[0]);
  });
});

describe("o peregrino e o padre", () => {
  const peregrino = CHARACTERS.find((c) => c.id === "peregrino")!;
  const padre = CHARACTERS.find((c) => c.id === "padre")!;

  it("existem, andam a pé e são mais lentos que a corrida", () => {
    for (const c of [peregrino, padre]) {
      expect(c).toBeDefined();
      const comoAnda = gaitOf(c);
      expect(comoAnda.gait).toBe("passo");
      // uma caminhada longa, não uma prova de 100 m
      expect(comoAnda.hz).toBeLessThan(gaitOf(findCharacter("run")).hz);
    }
  });

  it("são compostos: figura base + acessório", () => {
    expect(peregrino.acessorio).toBe("🎒");
    expect(padre.acessorio).toBe("✝️");
    // e a figura base é gente, não um veículo
    expect(peregrino.group).toBe("Pessoas");
    expect(padre.group).toBe("Pessoas");
  });

  it("o acessório é um emoji só (não uma frase)", () => {
    for (const c of CHARACTERS.filter((x) => x.acessorio)) {
      // no máximo dois code points: o emoji + o seletor de variação (✝️)
      expect([...c.acessorio!].length, c.id).toBeLessThanOrEqual(2);
    }
  });

  it("nenhum outro personagem repete a mesma combinação figura + acessório", () => {
    /*
     * Os **animados** ficam de fora: eles repetem o emoji de propósito (o
     * "Caminhante animado" é o 🚶 que se mexe). O que os distingue é o vetor, e
     * é o `id` que viaja no link.
     */
    const chaves = CHARACTERS.filter((c) => !c.icone).map(
      (c) => `${c.emoji}|${c.acessorio ?? ""}`,
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("como cada grupo anda", () => {
  it("veículo rola (roda não pula: carro quicando parece defeito)", () => {
    expect(gaitOf(findCharacter("car")).gait).toBe("roda");
    expect(gaitOf(findCharacter("moped")).gait).toBe("roda");
  });

  it("quem voa paira", () => {
    expect(gaitOf(findCharacter("plane")).gait).toBe("flutua");
    expect(gaitOf(findCharacter("angel")).gait).toBe("flutua");
    expect(gaitOf(findCharacter("astronaut")).gait).toBe("flutua");
  });

  it("gente e bicho andam a pé", () => {
    expect(gaitOf(findCharacter("farmer")).gait).toBe("passo");
    expect(gaitOf(findCharacter("wolf")).gait).toBe("passo");
    // a preguiça anda devagar de verdade
    expect(gaitOf(findCharacter("sloth")).hz).toBeLessThan(1);
  });

  it("os esportes de roda não têm passo", () => {
    for (const id of ["mtb", "snowboard", "xcski"]) {
      expect(gaitOf(findCharacter(id)).gait, id).toBe("roda");
    }
  });
});
