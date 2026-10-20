// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  fpsDoTempoReal,
  fpsQueCasa,
  indiceDoQuadro,
  medirCadencia,
  recordVideo,
  tempoDoQuadro,
  type VideoFormat,
} from "./recorder";

/*
 * O `MediaRecorder` não inventa os instantes: ele carimba cada quadro com o
 * relógio do momento em que a tela o entregou. Numa tela de 60 Hz com 24 quadros
 * por segundo pedidos, ele entrega 2 ou 3 quadros de tela por quadro — o arquivo
 * sai com durações de 33 ms e 50 ms **alternadas** e o conteúdo anda a mesma
 * velocidade, então o que se vê é o movimento oscilando a cada quadro.
 *
 * Foi o que o usuário mandou medir: o arquivo de exemplo dele tem 1.441 quadros,
 * com modas de 999 e ~1500 (1/30000 s) — 33,3 ms e 50 ms — e o mapa andando aos
 * pulos (*"o problema é o mapa ficar pulando"*).
 */
describe("o fps da gravação em tempo real", () => {
  it("numa tela de 60 Hz, 24 vira 20 — e 30 e 60 ficam como estão", () => {
    // 24 não divide 60: os quadros sairiam de 2 e 3 quadros de tela (33 e 50 ms)
    expect(fpsQueCasa(60, 24)).toBe(20);
    expect(fpsQueCasa(60, 30)).toBe(30);
    expect(fpsQueCasa(60, 60)).toBe(60);
    expect(fpsQueCasa(60, 20)).toBe(20);
  });

  it("o fps escolhido é a divisora da tela mais próxima do pedido", () => {
    // 120 e 144 Hz têm 24 exato
    expect(fpsQueCasa(120, 24)).toBe(24);
    expect(fpsQueCasa(144, 24)).toBe(24);
    // 90 Hz não tem 24: 22,5 está mais perto que 30
    expect(fpsQueCasa(90, 24)).toBe(22.5);
    expect(fpsQueCasa(90, 30)).toBe(30);
    // 50 Hz: 25 é a divisora mais próxima de 24 e de 30
    expect(fpsQueCasa(50, 24)).toBe(25);
    expect(fpsQueCasa(50, 30)).toBe(25);
    // 144 Hz com 30 pedidos: 28,8 é a divisora de cima (36 é mais longe em proporção)
    expect(fpsQueCasa(144, 30)).toBe(28.8);
  });

  it("o resultado sempre cabe na tela sem sobra de meia tela", () => {
    for (const tela of [50, 59.94, 60, 75, 90, 120, 144, 165, 240]) {
      for (const pedido of [24, 30, 60]) {
        const fps = fpsQueCasa(tela, pedido);
        expect(fps).toBeGreaterThanOrEqual(6);
        expect(fps).toBeLessThanOrEqual(tela * 1.01); // tela medida a 59,94 e pedido 60
        // nunca muito longe do pedido (10% para cima, 40% para baixo)
        expect(fps).toBeLessThanOrEqual(pedido * 1.1);
        expect(fps).toBeGreaterThanOrEqual(pedido * 0.6);
        const quadros = Math.round(tela / fps);
        expect(quadros).toBeGreaterThanOrEqual(1);
        expect(Math.abs(tela / quadros - fps)).toBeLessThanOrEqual(0.005 * fps);
      }
    }
  });

  it("a taxa medida com casas decimais (59,94) vira o número redondo", () => {
    expect(fpsQueCasa(59.94, 30)).toBe(30);
    expect(fpsQueCasa(59.94, 60)).toBe(60);
    // 19,98 é a divisora exata (3 quadros de tela); a diferença de 0,1% é a medida
    expect(fpsQueCasa(59.94, 24)).toBeCloseTo(20, 1);
  });

  it("sem medida da tela, o fps pedido é mantido", () => {
    for (const tela of [0, Number.NaN, -1, 5]) {
      expect(fpsQueCasa(tela, 24)).toBe(24);
      expect(fpsQueCasa(tela, 30)).toBe(30);
    }
  });
});

/*
 * A **cadência** do desenho é a grade do vídeo (`i/fps`); o **conteúdo** de cada
 * quadro é o relógio, porque é o relógio que o `MediaRecorder` carimba no
 * arquivo. As duas coisas são independentes de propósito — ver
 * `tempoDoQuadro`.
 */
describe("a cadência do desenho na gravação em tempo real", () => {
  it("sai na grade do vídeo, e não no instante do relógio", () => {
    expect(indiceDoQuadro(0, 24, 240)).toBe(0);
    expect(indiceDoQuadro(0.016, 24, 240)).toBe(0);
    expect(indiceDoQuadro(0.0417, 24, 240)).toBe(1);
    expect(indiceDoQuadro(0.0834, 24, 240)).toBe(2);
    expect(indiceDoQuadro(0.062, 24, 240)).toBe(1);
  });

  it("num segundo de tela saem exatamente os quadros do vídeo", () => {
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
    expect(indiceDoQuadro(99, 30, 200)).toBe(199);
    expect(indiceDoQuadro(-1, 30, 200)).toBe(0);
  });

  it("o degrau de cada quadro é i/fps", () => {
    for (const fps of [24, 30, 60]) {
      for (const i of [0, 1, 7, 23, 1441]) {
        expect(indiceDoQuadro(i / fps, fps, 10_000) * (1 / fps)).toBeCloseTo(i / fps, 9);
      }
    }
  });
});

/*
 * O conteúdo de cada quadro sai do **relógio** — o mesmo em que o arquivo é
 * carimbado.
 *
 * Este é o conserto do "travadinha em todo o vídeo": o desenho era feito por
 * índice (`i/fps`), então um quadro que ficava 46 ms na tela carregava o mesmo
 * passo de mapa que um de 20 ms. A velocidade aparente oscilava até 1,7× de um
 * quadro para o outro, 30 vezes por segundo. Está medido nos dois mp4 do
 * usuário: no que funcionava, os quadros longos andavam 1,49× mais que os
 * curtos; no que travava, 1,01×.
 */
describe("o instante do vídeo que cada quadro representa", () => {
  it("sai do relógio, e não da contagem de quadros", () => {
    expect(tempoDoQuadro(0.025, 60)).toBeCloseTo(0.025 / 60, 9);
    expect(tempoDoQuadro(0.042, 60)).toBeCloseTo(0.042 / 60, 9);
    // os dois intervalos medidos no arquivo de 18-27, um seguido do outro
    const razao = tempoDoQuadro(0.042, 60) / tempoDoQuadro(0.025, 60);
    expect(razao).toBeCloseTo(1.68, 2);
  });

  it("um quadro que ficou 1,5× mais tempo na tela carrega 1,5× mais caminho", () => {
    const curto = tempoDoQuadro(0.033, 60);
    const longo = tempoDoQuadro(0.05, 60);
    expect(longo / curto).toBeCloseTo(1.515, 2);
    /*
     * Pela contagem de quadros (o método antigo), 50 ms e 33 ms caíam no mesmo
     * degrau na maior parte das vezes: a razão ficava em ~1, que é a oscilação
     * de velocidade que o usuário viu.
     */
    const porIndice = (e: number) => Math.floor(e * 30) / 30;
    expect(porIndice(3.05) / porIndice(3.033)).toBeCloseTo(1.01, 2);
  });

  it("não acumula atraso: o quadro depois de um engasgo está no instante certo", () => {
    expect(tempoDoQuadro(3.1, 60)).toBeCloseTo(3.1 / 60, 9);
    expect(tempoDoQuadro(3.15, 60)).toBeCloseTo(3.15 / 60, 9);
    // e um engasgo de 50 ms carrega os 50 ms, em vez de "dois passos iguais"
    expect(tempoDoQuadro(3.15, 60) - tempoDoQuadro(3.1, 60)).toBeCloseTo(0.05 / 60, 9);
  });

  it("fica preso entre o começo e o fim", () => {
    expect(tempoDoQuadro(-1, 60)).toBe(0);
    expect(tempoDoQuadro(90, 60)).toBe(1);
    expect(tempoDoQuadro(0, 0)).toBe(0);
    expect(tempoDoQuadro(1, Number.NaN)).toBe(1);
    expect(tempoDoQuadro(Number.NaN, 60)).toBe(0);
  });

  it("nunca anda para trás", () => {
    let anterior = -1;
    for (let ms = 0; ms <= 60_000; ms += 7) {
      const t = tempoDoQuadro(ms / 1000, 60);
      expect(t).toBeGreaterThanOrEqual(anterior);
      anterior = t;
    }
  });
});

/*
 * E a captura acontece **no quadro desenhado**, não em um instante qualquer do
 * relógio.
 *
 * O caminho de sempre (`captureStream(fps)`) deixa o navegador escolher: numa
 * tela de 60 Hz com 24 quadros por segundo pedidos, ele entrega 2 ou 3 quadros
 * de tela por quadro — e o quadro entregue é o que estiver na tela naquele
 * instante. Com `captureStream(0)` + `requestFrame()` cada captura sai colada no
 * quadro que acabou de ser desenhado, e o desenho é feito na grade do vídeo: o
 * mapa anda o mesmo por passo, sem repetir nem pular.
 */
describe("a captura da gravação em tempo real", () => {
  const FORMATO: VideoFormat = {
    id: "webm",
    label: "WebM",
    ext: "webm",
    mime: "video/webm",
    container: "webm",
    codec: "vp8",
  };

  it("pede um quadro capturado por quadro desenhado, com o conteúdo no relógio", async () => {
    const taxas: number[] = [];
    const pedidos: number[] = [];
    const desenhados: { t: number; elapsed: number }[] = [];
    const trilha = {
      requestFrame: () => pedidos.push(pedidos.length),
      stop: () => undefined,
    };
    const stream = {
      getTracks: () => [trilha],
      getVideoTracks: () => [trilha],
    };

    class RecorderFalso {
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(
        public fonte: unknown,
        public opcoes: unknown,
      ) {}
      start() {
        this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
      }
      stop() {
        this.onstop?.();
      }
    }

    const canvas = document.createElement("canvas");
    canvas.getContext = (() => ({}) as unknown as CanvasRenderingContext2D) as never;
    (canvas as unknown as { captureStream: (fps: number) => unknown }).captureStream = (fps) => {
      taxas.push(fps);
      return stream;
    };
    let cadencia: ReturnType<typeof medirCadencia> | null = null;
    const anterior = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = RecorderFalso;
    try {
      const blob = await recordVideo({
        canvas,
        width: 720,
        height: 1280,
        fps: 30,
        durationSec: 0.25,
        format: FORMATO,
        bitrate: 1_000_000,
        draw: (_ctx, t, elapsed) => {
          desenhados.push({ t, elapsed });
        },
        onCadencia: (c) => {
          cadencia = c;
        },
      });
      expect(blob.size).toBeGreaterThan(0);
      // ninguém captura sozinho: quem manda é o desenho
      expect(taxas).toEqual([0]);
      /*
       * Um pedido de captura por quadro desenhado — o primeiro (desenhado antes
       * de a captura existir) também é pedido à mão, senão o arquivo começaria no
       * quadro 1.
       */
      expect(pedidos.length).toBe(desenhados.length);
      expect(desenhados.length).toBe(8); // o quadro 0 + os sete da grade
      /*
       * O instante de cada quadro é o do **relógio** dividido pela duração —
       * exatamente o que o `MediaRecorder` carimba no arquivo. É por isso que a
       * velocidade não oscila quando a tela entrega quadros de durações
       * diferentes.
       */
      for (const { t, elapsed } of desenhados) {
        expect(t).toBeCloseTo(elapsed / 0.25, 9);
      }
      expect(desenhados.map((d) => d.t)).toEqual([...desenhados.map((d) => d.t)].sort((a, b) => a - b));
      expect(desenhados[desenhados.length - 1].t).toBeGreaterThan(0.2);
      // e a cadência é medida e entregue: um intervalo por quadro desenhado,
      // contado a partir dos instantes reais do desenho
      expect(cadencia).not.toBeNull();
      const c = cadencia as unknown as ReturnType<typeof medirCadencia>;
      expect(c.intervalos.length).toBe(desenhados.length - 1);
      expect(c.tipico).toBeGreaterThan(0);
      /*
       * A regularidade aqui é só "foi medida", não "foi boa".
       *
       * Este teste desenha em **tempo real** (0,25 s de relógio de verdade), e
       * num executor de CI dividido com outras máquinas os quadros se
       * agrupam: dois saem no mesmo milissegundo e o seguinte vem 40 ms
       * depois. Isso derrubou o CI uma vez com 43% — sem nenhum defeito no
       * app. Quem garante a qualidade da conta são os casos sintéticos de
       * `medirCadencia` (93% no vídeo fluido, 78% no que travava), que não
       * dependem do relógio.
       */
      expect(c.regular).toBeGreaterThan(0);
    } finally {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = anterior;
    }
  }, 15000);
});

/*
 * A cadência: com que regularidade os quadros saíram.
 *
 * É o número que separa o vídeo que flui do que trava — e que não depende da
 * rota nem do zoom. Medido nos três mp4 do usuário: o que ele achou fluido
 * tinha 93% dos quadros no mesmo intervalo; o de 30 quadros por segundo, 78%;
 * o de 24, 46%. O passo do mapa por quadro era o mesmo (~7 px) nos três.
 */
describe("a cadência da gravação", () => {
  /** instantes de `n` quadros, com o intervalo dado em ms */
  const instantes = (n: number, ms: number, variar?: (i: number) => number) => {
    const out = [0];
    for (let i = 1; i < n; i++) out.push((i * ms + (variar?.(i) ?? 0)) / 1000);
    return out;
  };

  it("quadros igualmente espaçados dão cadência 100%", () => {
    const c = medirCadencia(instantes(120, 1000 / 60));
    expect(c.regular).toBe(1);
    expect(c.tipico).toBeCloseTo(1000 / 60, 6);
    expect(c.intervalos).toHaveLength(119);
  });

  it("reconhece a cadência do vídeo que o usuário achou fluido (93% a 19 ms)", () => {
    // ~53 quadros por segundo, com 7% deles chegando tarde (38 ms)
    const c = medirCadencia(instantes(100, 18.9, (i) => (i % 14 === 0 ? 18.9 : 0)));
    expect(Math.round(c.regular * 100)).toBeGreaterThanOrEqual(90);
    expect(c.tipico).toBeCloseTo(18.9, 1);
  });

  it("reconhece a cadência do vídeo que travava (78% a 33 ms)", () => {
    // 30 quadros por segundo com um em cada cinco vindo em 50 ms
    const c = medirCadencia(instantes(100, 1000 / 30, (i) => (i % 5 === 0 ? 1000 / 30 : 0)));
    expect(c.regular).toBeLessThan(0.9);
    expect(Math.round(c.regular * 100)).toBeCloseTo(78, -1);
  });

  it("não se engana com um engasgo grande no meio", () => {
    const base = instantes(90, 1000 / 30);
    base[45] += 0.4; // meio segundo de engasgo
    const c = medirCadencia(base);
    expect(c.tipico).toBeCloseTo(1000 / 30, 6);
    expect(c.regular).toBeLessThan(0.99);
    expect(c.regular).toBeGreaterThan(0.9);
  });

  it("aguenta entrada vazia, um quadro só e valores inválidos", () => {
    expect(medirCadencia([])).toEqual({ intervalos: [], tipico: 0, regular: 0, atraso: 0 });
    expect(medirCadencia([0.5])).toEqual({ intervalos: [], tipico: 0, regular: 0, atraso: 0 });
    // NaN e Infinity saem da conta; sobram os três instantes válidos → dois intervalos
    const comRuim = medirCadencia([0, Number.NaN, 1 / 30, Number.POSITIVE_INFINITY, 2 / 30]);
    expect(comRuim.intervalos).toHaveLength(2);
    expect(comRuim.regular).toBe(1);
  });

  it("instantes fora de ordem não produzem intervalo negativo", () => {
    const c = medirCadencia([0, 1 / 30, 2 / 30, 1 / 30, 3 / 30]);
    expect(c.intervalos.every((d) => d > 0)).toBe(true);
  });
});

/*
 * O teto do tempo real.
 *
 * A 60 quadros por segundo cada quadro tem 16,7 ms para desenhar o mapa inteiro
 * e entregá-lo ao gravador. No vídeo do usuário, só 63% dos quadros saíram no
 * mesmo intervalo — 1 em cada 3 chegou 8, 16 ou 25 ms atrasado, e é isso que o
 * olho lê como travada. A 30 sobram 33 ms por quadro.
 */
describe("o fps da gravação em tempo real", () => {
  it("nunca passa de 30, mesmo com 60 pedido numa tela de 60 Hz", () => {
    expect(fpsDoTempoReal(60, 60)).toBe(30);
    expect(fpsDoTempoReal(60, 30)).toBe(30);
    // numa tela de 144 Hz, o divisor mais próximo de 30 é 144/5 = 28,8
    expect(fpsDoTempoReal(144, 60)).toBe(28.8);
  });

  it("continua ajustando para dividir a taxa da tela", () => {
    // 24 numa tela de 60 Hz sai com 33 e 50 ms alternados: vira 20
    expect(fpsDoTempoReal(60, 24)).toBe(20);
    expect(fpsDoTempoReal(50, 60)).toBe(25);
    // tela de 120 Hz aceita 24 exato
    expect(fpsDoTempoReal(120, 24)).toBe(24);
  });

  it("sem medida da tela, fica no teto", () => {
    expect(fpsDoTempoReal(0, 60)).toBe(30);
    expect(fpsDoTempoReal(Number.NaN, 30)).toBe(30);
    expect(fpsDoTempoReal(0, 24)).toBe(24);
  });

  it("o pedido inválido não derruba a gravação", () => {
    expect(fpsDoTempoReal(60, Number.NaN)).toBe(30);
    expect(fpsDoTempoReal(60, -5)).toBe(30);
  });
});

/*
 * A régua da cadência é a mesma a 30 e a 60 quadros por segundo.
 *
 * A tolerância era só 5% do intervalo: 0,83 ms a 60 fps, menos que o tremor
 * normal do navegador. Sem o piso de 1 ms, a mesma gravação era medida com
 * régua mais dura a 60 do que a 30 — e o número que o painel mostra não podia
 * ser comparado entre os dois.
 */
describe("a régua da cadência", () => {
  /**
   * O mesmo tremor, a 30 ou a 60 quadros por segundo: ±0,45 ms em cada
   * instante vira ±0,9 ms no intervalo — dentro do piso de 1 ms, e fora dos
   * 0,83 ms que a tolerância relativa daria a 60.
   */
  const comTremor = (ms: number, n = 120) => {
    // ruído determinístico que **não** alterna em +/− (a alternância perfeita
    // move a mediana para um dos lados, o que não é o caso real)
    const ruido = (i: number) => (((i * 7919) % 1001) / 1000 - 0.5) * 0.9;
    const out = [0];
    for (let i = 1; i < n; i++) out.push((i * ms + ruido(i)) / 1000);
    return out;
  };

  it("o mesmo tremor dá a mesma porcentagem a 30 e a 60", () => {
    const a30 = medirCadencia(comTremor(1000 / 30));
    const a60 = medirCadencia(comTremor(1000 / 60));
    expect(a30.regular).toBe(1);
    expect(a60.regular).toBe(1);
  });

  it("um atraso de verdade continua contando como atraso", () => {
    const instantes = [0];
    for (let i = 1; i < 60; i++) {
      // 1 em cada 10 quadros chega um quadro inteiro depois (33 ms a mais)
      instantes.push((i * (1000 / 60) + (i % 10 === 0 ? 1000 / 30 : 0)) / 1000);
    }
    const c = medirCadencia(instantes);
    expect(c.regular).toBeLessThan(0.95);
    expect(c.regular).toBeGreaterThan(0.8);
  });

  it("diz quanto atrasa quando um quadro sai do tempo", () => {
    const ms = 1000 / 30;
    const instantes = [0];
    for (let i = 1; i < 100; i++) {
      // 1 em cada 20 quadros chega 16 ms depois
      instantes.push((i * ms + (i % 20 === 0 ? 16 : 0)) / 1000);
    }
    const c = medirCadencia(instantes);
    expect(c.atraso).toBeGreaterThan(10);
    expect(c.atraso).toBeLessThan(25);
  });

  it("cadência perfeita não inventa atraso", () => {
    const c = medirCadencia(Array.from({ length: 60 }, (_, i) => (i * 1000) / 60 / 1000));
    expect(c.regular).toBe(1);
    expect(c.atraso).toBe(0);
  });
});
