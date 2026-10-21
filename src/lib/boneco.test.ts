import { describe, expect, it } from "vitest";
import {
  BONECO_ALTURA,
  BONECO_CABECA,
  caixaDoBoneco,
  BONECO_POSES,
  bonecoLigado,
  faseDoBoneco,
  geometriaDoBoneco,
  viradoPara,
  type BonecoPose,
} from "./boneco";

/**
 * O boneco do rosto.
 *
 * O que se prova aqui é a **geometria** (a mesma que o desenho usa): os pés no
 * chão, as pernas alternando, a cabeça acima do ombro e o corpo inteiro dentro
 * da altura que a parada usa para sair da frente dele. O desenho em si é
 * conferido pela sonda de imagem, como os outros do renderer.
 */

const POSES: BonecoPose[] = ["pedala", "corre", "anda"];

describe("o boneco com o rosto", () => {
  it("só vale uma pose de verdade", () => {
    expect(bonecoLigado("pedala")).toBe(true);
    expect(bonecoLigado("corre")).toBe(true);
    expect(bonecoLigado("anda")).toBe(true);
    // desligado, vazio e lixo caem no desenho de sempre
    expect(bonecoLigado("off")).toBe(false);
    expect(bonecoLigado(undefined)).toBe(false);
    expect(bonecoLigado(null)).toBe(false);
    expect(bonecoLigado("voa" as never)).toBe(false);
  });

  it("a cabeça é o ponto mais alto, e fica acima do ombro", () => {
    for (const pose of POSES) {
      for (const fase of [0, 0.25, 0.5, 0.75]) {
        const g = geometriaDoBoneco(pose, fase);
        expect(g.cabeca.y).toBeLessThan(g.ombro.y);
        expect(g.ombro.y).toBeLessThan(g.quadril.y);
      }
    }
  });

  it("o corpo inteiro cabe na altura que os blocos usam para desviar", () => {
    for (const pose of POSES) {
      for (const fase of [0, 0.3, 0.6, 0.9]) {
        const g = geometriaDoBoneco(pose, fase);
        // do alto da cabeça (mais o raio dela) ao pé mais baixo
        const alto = g.cabeca.y - BONECO_CABECA;
        // no chão: os pés ou a parte de baixo das rodas (centro − raio)
        const baixo = Math.max(
          g.pernaPerto.ponta.y,
          g.pernaLonge.ponta.y,
          ...(g.rodas
            ? [g.rodas.tras.y + g.rodas.raio, g.rodas.frente.y + g.rodas.raio]
            : [0]),
        );
        expect(-alto).toBeLessThanOrEqual(BONECO_ALTURA);
        expect(baixo).toBeGreaterThanOrEqual(-0.02);
        // e os pés não afundam no mapa
        expect(baixo).toBeLessThanOrEqual(0.04);
      }
    }
  });

  it("as pernas alternam: uma sobe enquanto a outra desce", () => {
    // no meio do ciclo (fase 0,25) uma perna está à frente e a outra atrás
    const g = geometriaDoBoneco("anda", 0.25);
    const frentePerto = g.pernaPerto.ponta.x;
    const frenteLonge = g.pernaLonge.ponta.x;
    expect(Math.sign(frentePerto)).toBe(-Math.sign(frenteLonge));

    // e meia passada depois os papéis se invertem
    const depois = geometriaDoBoneco("anda", 0.75);
    expect(Math.sign(depois.pernaPerto.ponta.x)).toBe(-Math.sign(frentePerto));
  });

  it("quem pedala fica com os pés nos pedais, que dão a volta", () => {
    const a = geometriaDoBoneco("pedala", 0);
    const b = geometriaDoBoneco("pedala", 0.5);
    expect(a.rodas).not.toBeNull();
    // meia volta da manivela: o pé de um vai para onde o do outro estava
    expect(a.pernaPerto.ponta.x).toBeCloseTo(b.pernaLonge.ponta.x, 6);
    expect(a.pernaPerto.ponta.y).toBeCloseTo(b.pernaLonge.ponta.y, 6);
    // e o pé não sai de cima do eixo da bike
    expect(Math.abs(a.pernaPerto.ponta.y)).toBeLessThan(0.5);
  });

  it("o embalo é pequeno: nada de pulo", () => {
    for (const pose of POSES) {
      for (let i = 0; i <= 20; i++) {
        expect(Math.abs(geometriaDoBoneco(pose, i / 20).embalo)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("a cadência de cada pose é a de quem faz aquilo", () => {
    // pedalada ~1,15 volta/s (~70 rpm), corrida ~3 passos/s, caminhada ~1,8
    expect(faseDoBoneco("pedala", 1)).toBeCloseTo(1.15, 6);
    expect(faseDoBoneco("corre", 1)).toBeCloseTo(2.9, 6);
    expect(faseDoBoneco("anda", 1)).toBeCloseTo(1.8, 6);
    // e o tempo negativo (antes da largada) não anda para trás
    expect(faseDoBoneco("corre", -2)).toBe(0);
  });

  it("vira para a esquerda só quando o rumo vai claramente para lá", () => {
    expect(viradoPara(90)).toBe(1); // leste
    expect(viradoPara(0)).toBe(1); // norte
    expect(viradoPara(270)).toBe(-1); // oeste
    // quase reto: fica de perfil para a direita, sem piscar de lado
    expect(viradoPara(190)).toBe(1);
    expect(viradoPara(350)).toBe(1);
  });

  it("a caixa que os blocos desviam cobre a figura inteira, e não o selo", () => {
    const badge = 62;
    const caixa = caixaDoBoneco({ x: 100, y: 200 }, badge);
    // sobe até o alto da cabeça…
    expect(caixa.y).toBeLessThanOrEqual(200 - BONECO_ALTURA * badge);
    // …desce até os pés…
    expect(caixa.y + caixa.h).toBeGreaterThan(200);
    // …e é bem mais alta que o selo redondo (o aro é desenhado com 0,62 do
    // badge de raio, ou seja ~77 px de diâmetro para um badge de 62)
    expect(caixa.h).toBeGreaterThan(2 * badge * 0.62 * 1.3);
    expect(caixa.w).toBeLessThan(2 * badge);
  });

  it("as poses oferecidas no painel são as três que existem", () => {
    expect(BONECO_POSES.map((p) => p.id)).toEqual(["pedala", "corre", "anda"]);
  });
});
