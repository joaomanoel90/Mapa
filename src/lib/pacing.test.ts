import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";
import { stopFocus, stopSpan } from "./camera";
import {
  DESACELERA_FORCA,
  DESACELERA_JANELA_S,
  DESACELERA_TETO,
  curvaDePacing,
} from "./pacing";

/** Integra `f` em [0,1] por trapézios: é assim que se mede tempo e distância. */
const integral = (f: (x: number) => number, n = 4000) => {
  let soma = 0;
  for (let i = 0; i < n; i++) soma += f((i + 0.5) / n);
  return soma / n;
};

describe("a desaceleração nos pontos", () => {
  const PONTOS = [0.18, 0.47, 0.82];
  const PERCURSO = 10;
  const pacing = curvaDePacing(PONTOS, PERCURSO);

  it("sem ponto nenhum, o relógio passa direto (nada muda)", () => {
    const sem = curvaDePacing([], PERCURSO);
    expect(sem.pontos).toBe(0);
    expect(sem.janela).toBe(0);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sem.posicao(t)).toBeCloseTo(t, 12);
      expect(sem.densidade(t)).toBe(1);
      expect(sem.tempoDe(t)).toBeCloseTo(t, 12);
    }
    // e o mesmo vale para uma lista que só tem lixo
    expect(curvaDePacing([NaN, Infinity], PERCURSO).pontos).toBe(0);
  });

  it("começa na largada e termina na chegada", () => {
    // a rota inteira continua sendo percorrida: o vídeo não encurta o trajeto
    expect(pacing.posicao(0)).toBe(0);
    expect(pacing.posicao(1)).toBe(1);
    expect(pacing.tempoDe(0)).toBe(0);
    expect(pacing.tempoDe(1)).toBeCloseTo(1, 12);
  });

  it("nunca anda para trás e nunca fica parado", () => {
    let anterior = -1;
    for (let i = 0; i <= 2000; i++) {
      const x = pacing.posicao(i / 2000);
      expect(x).toBeGreaterThan(anterior);
      anterior = x;
    }
  });

  it("a personagem fica mais tempo dentro do ponto do que atravessando igual", () => {
    /*
     * O que o usuário pediu, medido: perto do ponto, o mesmo pedaço de rota
     * consome mais tempo de vídeo. Comparo com o caminho sem desaceleração.
     */
    const sem = curvaDePacing([], PERCURSO);
    const trecho = (p: typeof pacing, ts: number) => p.tempoDe(ts + 0.02) - p.tempoDe(ts - 0.02);
    for (const ts of PONTOS) {
      const comFreada = trecho(pacing, ts);
      const semFreada = trecho(sem, ts);
      expect(comFreada).toBeGreaterThan(semFreada * 1.8);
    }
    // e no meio entre dois pontos o tempo é o mesmo de sempre (ou menos: o
    // percurso é o mesmo, então o que se gasta a mais nos pontos sai daqui)
    const meio = (PONTOS[0] + PONTOS[1]) / 2;
    expect(trecho(pacing, meio)).toBeLessThan(trecho(sem, meio));
  });

  it("a velocidade cai no ponto e sobe entre os pontos", () => {
    for (const ts of PONTOS) {
      expect(pacing.velocidade(ts)).toBeLessThan(0.6);
    }
    const meio = (PONTOS[0] + PONTOS[1]) / 2;
    expect(pacing.velocidade(meio)).toBeGreaterThan(1.2);
    // o contraste é o que dá o efeito: ~4x entre o ponto e o meio
    expect(pacing.velocidade(meio) / pacing.velocidade(PONTOS[0])).toBeGreaterThan(2.5);
    // e o centro do ponto é o mais devagar de todos
    for (let i = 0; i <= 200; i++) {
      expect(pacing.velocidade(PONTOS[0])).toBeLessThanOrEqual(
        pacing.velocidade(PONTOS[0] + (i / 200) * 0.1) + 1e-9,
      );
    }
  });

  it("a duração do vídeo não muda: o percurso inteiro gasta o mesmo tempo", () => {
    /*
     * A conta que garante isso: o tempo total é ∫ 1/velocidade dx, e a
     * velocidade foi normalizada para a média ser 1 (na distância). Se este
     * teste quebrar, o vídeo passa a ter quadros a mais ou a menos do que a
     * duração escolhida.
     */
    // tempo total = ∫ (1/velocidade) dx — é a definição de `velocidade`
    expect(integral((x) => 1 / pacing.velocidade(x))).toBeCloseTo(1, 3);
    // e a densidade integra o ritmo médio (o que se anda mais depressa fora)
    expect(integral((x) => pacing.densidade(x))).toBeCloseTo(pacing.fator, 3);
    expect(pacing.fator).toBeGreaterThan(1);
  });

  it("a rota inteira é coberta no percurso inteiro", () => {
    /*
     * A outra ponta da conta de tempo: integrando a velocidade **no tempo**, a
     * personagem sai de 0 e chega em 1 — nada de sobra nem de falta de trajeto.
     */
    let soma = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      soma += pacing.velocidade(pacing.posicao(t));
    }
    expect(soma / n).toBeCloseTo(1, 3);
  });

  it("o foco da câmera chega ao máximo quando a personagem chega no ponto", () => {
    /*
     * A ligação entre a freada e o foco: a câmera olha a **posição**, então o
     * instante do foco máximo tem de ser exatamente aquele em que a posição
     * visual passa pelo ponto — `tempoDe(ts)`.
     */
    const tl = buildTimeline(PERCURSO, { voo: false, cartela: false });
    for (const ts of PONTOS) {
      const instante = pacing.tempoDe(ts);
      const naHora = stopFocus(pacing.posicao(instante), PONTOS, tl.percurso).forca;
      expect(naHora).toBeCloseTo(1, 3);
      // um pouco antes e um pouco depois, o foco é menor
      expect(stopFocus(pacing.posicao(instante - 0.05), PONTOS, tl.percurso).forca).toBeLessThan(naHora);
      expect(stopFocus(pacing.posicao(instante + 0.05), PONTOS, tl.percurso).forca).toBeLessThan(naHora);
    }
  });

  it("o foco dura mais tempo de vídeo do que duraria sem a freada", () => {
    // "desacelerar **e** focar": com a freada, a janela do foco passa a ocupar
    // mais segundos de vídeo — é o que dá tempo de ver o ponto
    const tl = buildTimeline(PERCURSO, { voo: false, cartela: false });
    const segundosDeFoco = (p: typeof pacing) => {
      let n = 0;
      for (let i = 0; i <= 4000; i++) {
        const t = i / 4000;
        if (stopFocus(p.posicao(t), PONTOS, tl.percurso).forca > 0.5) n++;
      }
      // denso no tempo do percurso: 4001 amostras = o percurso inteiro
      return (n / 4001) * tl.percurso;
    };
    const sem = curvaDePacing([], PERCURSO);
    expect(segundosDeFoco(pacing)).toBeGreaterThan(segundosDeFoco(sem) * 1.5);
  });

  it("com muitos pontos, as janelas encolhem em vez de o vídeo virar corrida", () => {
    /*
     * O teto: a desaceleração pode gastar no máximo metade do percurso. Com 40
     * pontos, o que muda é a largura da janela — a força no centro continua a
     * mesma, e o trecho entre pontos não vira uma perseguição.
     */
    const muitos = Array.from({ length: 40 }, (_, i) => (i + 1) / 41);
    const p = curvaDePacing(muitos, PERCURSO);
    expect(p.pontos).toBe(40);
    expect(p.fatiaNosPontos).toBeLessThanOrEqual(DESACELERA_TETO + 1e-9);
    expect(p.janela).toBeLessThan(DESACELERA_JANELA_S / PERCURSO);
    // a velocidade entre dois pontos vizinhos ainda é civilizada
    const entre = (muitos[0] + muitos[1]) / 2;
    expect(p.velocidade(entre)).toBeLessThan(2.5);
    // e o vídeo continua fechando: nada de posição fora de [0,1]
    for (const t of [0, 0.3, 0.61, 1]) {
      const x = p.posicao(t);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it("um ponto repetido não desacelera duas vezes", () => {
    // três anotações no mesmo lugar são **uma** parada: a densidade no centro
    // continua sendo 1 + força (e não 1 + 3·força)
    const um = curvaDePacing([0.5], PERCURSO);
    const repetido = curvaDePacing([0.5, 0.5, 0.5 + 1e-9], PERCURSO);
    expect(repetido.pontos).toBe(1);
    expect(repetido.densidade(0.5)).toBeCloseTo(1 + DESACELERA_FORCA, 9);
    expect(repetido.densidade(0.5)).toBeCloseTo(um.densidade(0.5), 12);
    expect(repetido.janela).toBeCloseTo(um.janela, 12);
  });

  it("ponto na largada (ou na chegada) não vira vídeo parado", () => {
    const naLargada = curvaDePacing([0], PERCURSO);
    expect(naLargada.posicao(0)).toBe(0);
    expect(naLargada.posicao(1)).toBe(1);
    expect(naLargada.posicao(0.02)).toBeLessThan(0.02);

    const naChegada = curvaDePacing([1], PERCURSO);
    expect(naChegada.posicao(1)).toBe(1);
    expect(naChegada.tempoDe(1)).toBeCloseTo(1, 12);
    // o extremo: pontos nos dois cantos continuam fechando em 0 e 1
    const dois = curvaDePacing([0, 1], PERCURSO);
    expect(dois.posicao(0)).toBe(0);
    expect(dois.posicao(1)).toBe(1);
    expect(integral((x) => 1 / dois.velocidade(x))).toBeCloseTo(1, 3);
  });

  it("a janela sai da duração do percurso: vídeo curto tem janela estreita", () => {
    // 1,6 s de percurso é fração grande de um vídeo de 5 s e pequena de um de 60
    const curto = curvaDePacing(PONTOS, 5);
    const longo = curvaDePacing(PONTOS, 60);
    expect(longo.janela).toBeLessThan(curto.janela);
    // e o teto é o mesmo para os dois
    expect(curto.fatiaNosPontos).toBeLessThanOrEqual(DESACELERA_TETO + 1e-9);
    expect(longo.fatiaNosPontos).toBeLessThanOrEqual(DESACELERA_TETO + 1e-9);
  });

  it("a força é a pedida: no centro do ponto anda 1/(1+força) do ritmo de fora", () => {
    // com um ponto só, o teto não aperta e a janela é a pedida
    const um = curvaDePacing([0.5], 60);
    expect(um.janela).toBeCloseTo(DESACELERA_JANELA_S / 60, 12);
    const fora = um.velocidade(0.2);
    expect(um.velocidade(0.5)).toBeCloseTo(fora / (1 + DESACELERA_FORCA), 6);
  });
});

/* ------------------------------------------------------------------ */
/* A janela que o foco usa é a mesma da freada                        */
/* ------------------------------------------------------------------ */

describe("a janela da freada e a do foco", () => {
  it("a freada começa antes do foco entrar e termina depois de ele sair", () => {
    /*
     * Se a freada fosse mais estreita que a do foco, a câmera chegaria no ponto
     * depois de a personagem já ter passado. Aqui as duas janelas são medidas no
     * mesmo lugar: a freada cobre o foco.
     */
    const percurso = 12;
    const ts = 0.4;
    const pacing = curvaDePacing([ts], percurso);
    const span = stopSpan(percurso); // meia-janela do foco, em fração da rota
    // a freada está em curso onde o foco já começou
    for (const x of [ts - span, ts + span]) {
      expect(pacing.densidade(x)).toBeGreaterThan(1.05);
    }
    // e o foco é o mesmo de sempre: a desaceleração não mexe no quanto ele puxa
    expect(stopFocus(ts, [ts], percurso).forca).toBeCloseTo(1, 6);
  });
});
