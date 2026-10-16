// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fpsQueCasa, indiceDoQuadro, recordVideo, type VideoFormat } from "./recorder";

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
 * O desenho é feito na **grade do vídeo** (`i/fps`), e não no instante em que a
 * tela pediu o quadro: com `captureStream(0)` + `requestFrame()` cada captura é
 * um quadro inteiro do vídeo, e o passo do mapa entre dois quadros do arquivo é
 * sempre o mesmo.
 */
describe("o quadro desenhado na gravação em tempo real", () => {
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

  it("o tempo de vídeo de cada quadro é i/fps", () => {
    for (const fps of [24, 30, 60]) {
      for (const i of [0, 1, 7, 23, 1441]) {
        expect(indiceDoQuadro(i / fps, fps, 10_000) * (1 / fps)).toBeCloseTo(i / fps, 9);
      }
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

  it("pede um quadro capturado por quadro desenhado, na grade do vídeo", async () => {
    const taxas: number[] = [];
    const pedidos: number[] = [];
    const desenhados: number[] = [];
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
        draw: (_ctx, _t, elapsed) => {
          desenhados.push(elapsed);
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
      // e o tempo de cada quadro é o da grade (1/30 s), nunca o do relógio
      expect(desenhados.map((t) => Math.round(t * 30))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    } finally {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = anterior;
    }
  }, 15000);
});
