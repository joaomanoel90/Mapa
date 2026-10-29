import { describe, expect, it } from "vitest";
import { ICONES, coresDoIcone, desenharIcone, findIcone, pintarIcone, svgDoIcone } from "./icones";

/**
 * Os ícones animados.
 *
 * O que interessa provar não é o pixel (não há tela aqui), e sim o que faz o
 * desenho **funcionar como personagem**: a geometria cabe no quadrado de 0 a
 * 100, o ciclo fecha (a roda dá uma volta inteira e volta ao começo), o ganho
 * zero congela tudo, e o SVG sai com a animação — ou sem ela, quando é miniatura.
 */

/** Um canvas de mentira que só anota o que foi desenhado. */
function fakeCtx() {
  const chamadas: string[] = [];
  const traços: { cor: string; largura: number }[] = [];
  /** onde cada traço começou (é o que muda de um quadro para o outro) */
  const movimentos: number[][] = [];
  let pendente = 0;
  const ctx: Record<string, unknown> = {
    chamadas,
    traços,
    movimentos,
    get pendente() {
      return pendente;
    },
    save: () => chamadas.push("save"),
    restore: () => chamadas.push("restore"),
    translate: () => chamadas.push("translate"),
    scale: () => chamadas.push("scale"),
    rotate: () => chamadas.push("rotate"),
    beginPath: () => {
      chamadas.push("beginPath");
      pendente = 0;
    },
    moveTo: (x: number, y: number) => {
      chamadas.push("moveTo");
      pendente++;
      movimentos.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    },
    lineTo: () => {
      chamadas.push("lineTo");
      pendente++;
    },
    closePath: () => chamadas.push("closePath"),
    stroke: () => {
      chamadas.push("stroke");
      traços.push({
        cor: String(ctx.strokeStyle),
        largura: Number(ctx.lineWidth),
      });
    },
    fill: () => chamadas.push("fill"),
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    chamadas: string[];
    traços: { cor: string; largura: number }[];
    movimentos: number[][];
  };
}

describe("a geometria dos ícones", () => {
  it("todo ponto cabe no quadrado de 0 a 100", () => {
    for (const icone of ICONES) {
      for (const parte of icone.partes) {
        for (const [x, y] of parte.pts) {
          expect(Number.isFinite(x), icone.id).toBe(true);
          expect(Number.isFinite(y), icone.id).toBe(true);
          // a casca avança ~3 unidades para fora do ponto: 0..100 é o miolo
          expect(x, `${icone.id} x`).toBeGreaterThanOrEqual(0);
          expect(x, `${icone.id} x`).toBeLessThanOrEqual(100);
          expect(y, `${icone.id} y`).toBeGreaterThanOrEqual(0);
          expect(y, `${icone.id} y`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("nenhum ícone repete id, e todos têm nome, emoji e um andar", () => {
    expect(new Set(ICONES.map((i) => i.id)).size).toBe(ICONES.length);
    for (const icone of ICONES) {
      expect(icone.name.trim(), icone.id).not.toBe("");
      expect(icone.emoji.trim(), icone.id).not.toBe("");
      expect(["passo", "roda", "flutua"], icone.id).toContain(icone.gait);
      expect(icone.gaitHz, icone.id).toBeGreaterThan(0);
    }
  });

  it("quem anda a pé tem parte que passa; quem rola tem parte que gira", () => {
    for (const icone of ICONES) {
      const gestos = icone.partes.map((p) => p.gesto);
      if (icone.gait === "passo") expect(gestos, icone.id).toContain("passo");
      if (icone.gait === "roda") expect(gestos, icone.id).toContain("gira");
    }
  });

  it("toda parte animada declara amplitude ou dá a volta inteira", () => {
    for (const icone of ICONES) {
      for (const parte of icone.partes) {
        if (!parte.gesto) continue;
        if (parte.gesto === "gira") continue;
        expect(parte.amplitude ?? 0, `${icone.id} ${parte.gesto}`).toBeGreaterThan(0);
      }
    }
  });

  it("findIcone acha pelo id e devolve null para o resto", () => {
    expect(findIcone("cavalo")?.id).toBe("cavalo");
    expect(findIcone("nao-existe")).toBeNull();
    expect(findIcone(undefined)).toBeNull();
  });
});

describe("o ciclo do desenho", () => {
  it("a roda dá uma volta inteira por ciclo e volta ao começo", () => {
    const ciclista = findIcone("ciclista")!;
    // o primeiro raio da primeira roda
    const iRaio = ciclista.partes.findIndex((p) => p.gesto === "gira")!;
    const noInicio = pintarIcone(ciclista, 0)[iRaio].pts;
    const noQuarto = pintarIcone(ciclista, 0.25)[iRaio].pts;
    const naMetade = pintarIcone(ciclista, 0.5)[iRaio].pts;
    const noFim = pintarIcone(ciclista, 1)[iRaio].pts;
    // um quarto de volta: o raio, que era deitado, fica em pé
    expect(Math.abs(noQuarto[0][1] - noInicio[0][1])).toBeGreaterThan(4);
    // meia volta: as pontas trocam de lado
    expect(naMetade[0][0]).toBeCloseTo(noInicio[1][0], 2);
    // volta inteira: o desenho é o mesmo
    expect(noFim).toEqual(noInicio);
  });

  it("sem ganho a roda também para (ninguém pedala na cartela)", () => {
    const ciclista = findIcone("ciclista")!;
    const iRaio = ciclista.partes.findIndex((p) => p.gesto === "gira")!;
    expect(pintarIcone(ciclista, 0.37, 0)[iRaio].pts).toEqual(
      pintarIcone(ciclista, 0, 0)[iRaio].pts,
    );
  });

  it("o passo vai para um lado e para o outro (não fica parado torto)", () => {
    const caminhante = findIcone("caminhante")!;
    const iPerna = caminhante.partes.findIndex((p) => p.gesto === "passo")!;
    const em = (f: number) => pintarIcone(caminhante, f)[iPerna].pts;
    const frente = em(0.25);
    const tras = em(0.75);
    // a ponta do pé (último ponto) anda em direções opostas
    const peFrente = frente[frente.length - 1];
    const peTras = tras[tras.length - 1];
    expect(Math.abs(peFrente[0] - peTras[0])).toBeGreaterThan(5);
  });

  it("ganho zero é o boneco parado: nada se move", () => {
    for (const icone of ICONES) {
      const a = pintarIcone(icone, 0.1, 0);
      const b = pintarIcone(icone, 0.7, 0);
      expect(b.map((p) => p.pts), icone.id).toEqual(a.map((p) => p.pts));
    }
  });

  it("o ganho é proporcional: metade da força, metade do passo", () => {
    const caminhante = findIcone("caminhante")!;
    const i = caminhante.partes.findIndex((p) => p.gesto === "passo")!;
    const cheio = pintarIcone(caminhante, 0.25, 1)[i].pts.at(-1)!;
    const meio = pintarIcone(caminhante, 0.25, 0.5)[i].pts.at(-1)!;
    const parado = pintarIcone(caminhante, 0.25, 0)[i].pts.at(-1)!;
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(meio, parado)).toBeCloseTo(d(cheio, parado) / 2, 1);
  });
});

describe("o desenho no canvas", () => {
  it("desenha forma e contorno, com o acento onde ele é pedido", () => {
    const ctx = fakeCtx();
    desenharIcone(ctx, {
      icone: findIcone("carro")!,
      x: 10,
      y: 10,
      lado: 100,
      accent: "#a3e635",
      fase: 0.4,
    });
    expect(ctx.chamadas).toContain("stroke");
    expect(ctx.chamadas).toContain("fill");
    // a casca e o desenho: o acento aparece (vidros e farol do carro)
    const cores = ctx.traços.map((t) => t.cor.toLowerCase());
    expect(cores).toContain("#a3e635");
  });

  it("dois instantes distintos desenham posições distintas (o vídeo se mexe)", () => {
    const desenhar = (fase: number) => {
      const ctx = fakeCtx();
      desenharIcone(ctx, {
        icone: findIcone("caminhante")!,
        x: 0,
        y: 0,
        lado: 100,
        accent: "#a3e635",
        fase,
      });
      return ctx.movimentos;
    };
    // um quarto de passo de diferença já muda onde as pernas estão
    expect(desenhar(0.25)).not.toEqual(desenhar(0.5));
  });

  it("espelhar não muda a geometria, só o eixo", () => {
    const ctx = fakeCtx();
    desenharIcone(ctx, {
      icone: findIcone("caminhante")!,
      x: 0,
      y: 0,
      lado: 100,
      accent: "#a3e635",
      virado: -1,
    });
    // o `scale` do espelho é o segundo scale chamado (o primeiro é o da escala)
    expect(ctx.chamadas.filter((c) => c === "scale")).toHaveLength(2);
    // e as translações são as mesmas de quando não se espelha
    expect(ctx.chamadas.filter((c) => c === "translate")).toHaveLength(2);
  });
});

describe("o SVG", () => {
  it("animado, traz a animação de cada parte em movimento", () => {
    const svg = svgDoIcone(findIcone("ciclista")!, { accent: "#a3e635", hz: 1.15 });
    expect(svg).toContain("<animateTransform");
    // a roda gira: 0 → 360 no eixo próprio
    expect(svg).toMatch(/values="0 [\d.]+ [\d.]+;360 [\d.]+ [\d.]+"/);
    // e o ritmo é o da cadência pedida
    expect(svg).toContain('dur="0.870s"');
  });

  it("parado, não traz animação nenhuma", () => {
    const svg = svgDoIcone(findIcone("ciclista")!, { accent: "#a3e635" });
    expect(svg).not.toContain("<animateTransform");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("é um SVG de verdade: vedado, com viewBox e sem NaN", () => {
    for (const icone of ICONES) {
      const svg = svgDoIcone(icone, { accent: "#22d3ee", hz: icone.gaitHz, lado: 40 });
      expect(svg, icone.id).toContain('viewBox="0 0 100 100"');
      expect(svg, icone.id).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg.trim().endsWith("</svg>"), icone.id).toBe(true);
      // uma tag aberta e fechada para cada forma
      const abertas = (svg.match(/<(polygon|polyline)/g) ?? []).length;
      expect(abertas, icone.id).toBeGreaterThan(0);
      expect(svg).toContain('role="img"');
    }
  });

  it("o espelho é um `scaleX(-1)` no próprio SVG", () => {
    const svg = svgDoIcone(findIcone("caminhante")!, { accent: "#a3e635", virado: -1 });
    expect(svg).toContain("scaleX(-1)");
  });

  it("o acento entra nas cores e a tinta é sempre clara (o selo é escuro)", () => {
    const cores = coresDoIcone("#f472b6");
    expect(cores.acento).toBe("#f472b6");
    expect(cores.tinta.toLowerCase()).toBe("#f4f4f5");
  });

  it("o SVG animado não fica gigante (o seletor desenha nove de uma vez)", () => {
    for (const icone of ICONES) {
      const svg = svgDoIcone(icone, { accent: "#a3e635", hz: icone.gaitHz });
      // menos de 20 kB por ícone: são dezenas de `<g>` com 17 quadros cada
      expect(svg.length, icone.id).toBeLessThan(20_000);
    }
  });
});
