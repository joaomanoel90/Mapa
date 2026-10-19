import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoFormat } from "./recorder";
import {
  createMuxer,
  encoderConfigFor,
  framePlan,
  isFastEncodeSupported,
  motivoRapidoIndisponivel,
  recordVideoFast,
  webmCodecFor,
} from "./webcodecs";

const MP4: VideoFormat = {
  id: "mp4-h264",
  label: "MP4 (H.264)",
  ext: "mp4",
  mime: "video/mp4;codecs=avc1.42E01E",
  container: "mp4",
  codec: "avc1.42E01E",
};

const WEBM_VP9: VideoFormat = {
  id: "webm-vp9",
  label: "WebM (VP9)",
  ext: "webm",
  mime: "video/webm;codecs=vp9",
  container: "webm",
  codec: "vp09.00.10.08",
};

const WEBM_VP8: VideoFormat = { ...WEBM_VP9, id: "webm-vp8", codec: "vp8" };

beforeEach(() => {
  // o webm-muxer faz instanceof nesta classe
  vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("framePlan", () => {
  it("gera exatamente fps × duração quadros", () => {
    expect(framePlan(30, 14)).toHaveLength(420);
    expect(framePlan(24, 5)).toHaveLength(120);
  });

  it("começa em 0 e termina em 1 na rota", () => {
    const plan = framePlan(30, 10);
    expect(plan[0].t).toBe(0);
    expect(plan[plan.length - 1].t).toBe(1);
  });

  it("cresce de forma monotônica", () => {
    const plan = framePlan(30, 6);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].t).toBeGreaterThan(plan[i - 1].t);
      expect(plan[i].timestampUs).toBeGreaterThan(plan[i - 1].timestampUs);
    }
  });

  it("espaça os timestamps em 1/fps", () => {
    const plan = framePlan(30, 3);
    const passo = 1_000_000 / 30;
    for (let i = 1; i < plan.length; i++) {
      expect(Math.abs(plan[i].timestampUs - plan[i - 1].timestampUs - passo)).toBeLessThan(1);
    }
    expect(plan[0].timestampUs).toBe(0);
  });

  it("marca um quadro-chave a cada 2 segundos, começando no primeiro", () => {
    const plan = framePlan(30, 10);
    expect(plan[0].keyFrame).toBe(true);
    expect(plan[30].keyFrame).toBe(false);
    expect(plan[60].keyFrame).toBe(true);
    expect(plan[120].keyFrame).toBe(true);
    expect(plan.filter((f) => f.keyFrame)).toHaveLength(5);
  });

  it("dá a mesma duração a todos os quadros", () => {
    const plan = framePlan(25, 4);
    const esperado = Math.round(1_000_000 / 25);
    expect(plan.every((f) => f.durationUs === esperado)).toBe(true);
  });

  it("não quebra com duração ou fps degenerados", () => {
    expect(framePlan(30, 0)).toHaveLength(1);
    expect(framePlan(30, 0)[0].t).toBe(0);
    expect(framePlan(1, 1)).toHaveLength(1);
  });

  it("resolve o tempo decorrido em segundos", () => {
    const plan = framePlan(10, 5);
    expect(plan[0].elapsed).toBe(0);
    expect(plan[10].elapsed).toBeCloseTo(1, 6);
    expect(plan[plan.length - 1].elapsed).toBeCloseTo(4.9, 6);
  });
});

describe("encoderConfigFor", () => {
  it("pede saída avcC para MP4", () => {
    // sem isso o arquivo sai em Annex B e não abre em vários tocadores
    const cfg = encoderConfigFor(MP4, 1280, 720, 10_000_000, 30);
    expect(cfg.avc).toEqual({ format: "avc" });
    expect(cfg.codec).toBe("avc1.42E01E");
  });

  it("não manda configuração de AVC em WebM", () => {
    expect(encoderConfigFor(WEBM_VP9, 1280, 720, 10_000_000, 30).avc).toBeUndefined();
  });

  it("leva tamanho, bitrate e fps", () => {
    const cfg = encoderConfigFor(WEBM_VP9, 720, 1280, 5_000_000, 24);
    expect(cfg.width).toBe(720);
    expect(cfg.height).toBe(1280);
    expect(cfg.bitrate).toBe(5_000_000);
    expect(cfg.framerate).toBe(24);
  });

  it("mantém o codec do formato escolhido", () => {
    expect(encoderConfigFor(WEBM_VP8, 1280, 720, 1_000_000, 30).codec).toBe("vp8");
    expect(encoderConfigFor(WEBM_VP9, 1280, 720, 1_000_000, 30).codec).toBe("vp09.00.10.08");
  });
});

describe("webmCodecFor", () => {
  it("traduz para o vocabulário do Matroska", () => {
    expect(webmCodecFor(WEBM_VP9)).toBe("V_VP9");
    expect(webmCodecFor(WEBM_VP8)).toBe("V_VP8");
  });

  it("cai para VP8 em codec desconhecido", () => {
    expect(webmCodecFor({ ...WEBM_VP9, codec: "qualquer" })).toBe("V_VP8");
  });
});

/* ------------------------------------------------------------------ */
/* Montagem do arquivo                                                 */
/* ------------------------------------------------------------------ */

/**
 * O webm-muxer verifica `chunk instanceof EncodedVideoChunk`, e o Node não tem
 * essa classe. Um stub global deixa os dois muxers aceitarem os quadros falsos.
 */
class FakeEncodedVideoChunk {
  type: "key" | "delta";
  timestamp: number;
  duration: number;
  byteLength = 4;
  constructor(init: { type: "key" | "delta"; timestamp: number; duration: number }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }
  copyTo(dest: Uint8Array) {
    dest.set([0, 0, 0, 1]);
  }
}

/** Quadro falso no formato que os muxers esperam. */
function fakeChunk(timestamp: number, isKey: boolean): EncodedVideoChunk {
  return new FakeEncodedVideoChunk({
    type: isKey ? "key" : "delta",
    timestamp,
    duration: 33_333,
  }) as unknown as EncodedVideoChunk;
}

/** avcC mínimo, que o muxer de MP4 exige para descrever o H.264. */
const avcMeta = {
  decoderConfig: {
    codec: "avc1.42E01E",
    description: new Uint8Array([
      1, 100, 0, 31, 255, 225, 0, 4, 103, 100, 0, 31, 1, 0, 4, 104, 238, 60, 128,
    ]),
  },
} as unknown as EncodedVideoChunkMetadata;

describe("createMuxer", () => {
  it("produz um MP4 válido", () => {
    const { muxer, buffer } = createMuxer(MP4, 1280, 720, 30);
    muxer.addVideoChunk(fakeChunk(0, true), avcMeta);
    muxer.addVideoChunk(fakeChunk(33_333, false), avcMeta);
    muxer.finalize();

    const bytes = new Uint8Array(buffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    // todo MP4 começa com um box "ftyp" nos bytes 4..8
    expect(String.fromCharCode(...bytes.slice(4, 8))).toBe("ftyp");
  });

  it("produz um WebM válido", () => {
    const { muxer, buffer } = createMuxer(WEBM_VP9, 720, 1280, 30);
    muxer.addVideoChunk(fakeChunk(0, true));
    muxer.addVideoChunk(fakeChunk(33_333, false));
    muxer.finalize();

    const bytes = new Uint8Array(buffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    // assinatura EBML do Matroska/WebM
    expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it("grava as dimensões no cabeçalho", () => {
    const muxar = (w: number, h: number) => {
      const { muxer, buffer } = createMuxer(WEBM_VP9, w, h, 30);
      muxer.addVideoChunk(fakeChunk(0, true));
      muxer.finalize();
      return new Uint8Array(buffer());
    };

    const pequeno = muxar(640, 360);
    const grande = muxar(1280, 720);

    // as dimensões são metadados: o cabeçalho tem o mesmo tamanho, mas os
    // bytes mudam — é o que garante que o vídeo sai no tamanho escolhido
    expect(pequeno.byteLength).toBe(grande.byteLength);
    expect([...pequeno]).not.toEqual([...grande]);
  });
});

describe("isFastEncodeSupported", () => {
  it("diz que não quando o navegador não tem WebCodecs", async () => {
    vi.stubGlobal("VideoEncoder", undefined);
    vi.stubGlobal("VideoFrame", undefined);
    expect(await isFastEncodeSupported(MP4, 1280, 720)).toBe(false);
  });

  it("diz que não quando só existe VideoEncoder", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: true }) });
    vi.stubGlobal("VideoFrame", undefined);
    expect(await isFastEncodeSupported(MP4, 1280, 720)).toBe(false);
  });

  it("aceita quando o navegador confirma o formato", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", {
      isConfigSupported: async () => ({ supported: true }),
    });
    expect(await isFastEncodeSupported(MP4, 1280, 720)).toBe(true);
  });

  it("respeita a recusa do navegador", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", {
      isConfigSupported: async () => ({ supported: false }),
    });
    expect(await isFastEncodeSupported(WEBM_VP9, 1280, 720)).toBe(false);
  });

  it("sobrevive a um isConfigSupported que lança", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", {
      isConfigSupported: async () => {
        throw new Error("codec inválido");
      },
    });
    expect(await isFastEncodeSupported(MP4, 1280, 720)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Fluxo completo de codificação                                       */
/* ------------------------------------------------------------------ */

/** Canvas mínimo: o fluxo só usa `width`, `height` e `getContext`. */
function fakeCanvas() {
  const ctx = { id: "ctx" };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

type QuadroGravado = { timestamp: number; duration: number; keyFrame: boolean };

/**
 * Instala um navegador falso com o mínimo para exercitar `recordVideoFast`:
 * o encoder emite chunks sintéticos que os muxers reais conseguem montar.
 */
function stubEncoder(formato: VideoFormat) {
  const gravados: QuadroGravado[] = [];

  class FakeVideoFrame {
    timestamp: number;
    duration: number;
    constructor(_src: unknown, init: { timestamp: number; duration: number }) {
      this.timestamp = init.timestamp;
      this.duration = init.duration;
    }
    close() {
      /* nada a liberar */
    }
  }

  class FakeVideoEncoder {
    static ultimo: FakeVideoEncoder | null = null;
    private output: (chunk: unknown, meta?: unknown) => void;
    private error: (e: unknown) => void;
    encodeQueueSize = 0;
    configurado: unknown = null;
    fechado = false;
    finalizado = false;

    constructor(init: { output: (c: unknown, m?: unknown) => void; error: (e: unknown) => void }) {
      this.output = init.output;
      this.error = init.error;
      FakeVideoEncoder.ultimo = this;
    }
    configure(cfg: unknown) {
      this.configurado = cfg;
    }
    encode(frame: FakeVideoFrame, opts?: { keyFrame?: boolean }) {
      const keyFrame = Boolean(opts?.keyFrame);
      gravados.push({ timestamp: frame.timestamp, duration: frame.duration, keyFrame });
      const chunk = new FakeEncodedVideoChunk({
        type: keyFrame ? "key" : "delta",
        timestamp: frame.timestamp,
        duration: frame.duration,
      });
      // MP4 precisa do avcC para descrever o H.264
      this.output(chunk, formato.container === "mp4" ? avcMeta : undefined);
    }
    flush() {
      this.finalizado = true;
      return Promise.resolve();
    }
    close() {
      this.fechado = true;
    }
    dispararErro(e: unknown) {
      this.error(e);
    }
  }

  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
  return { gravados, Encoder: FakeVideoEncoder };
}

describe("recordVideoFast", () => {
  const opcoes = (formato: VideoFormat, extras: Record<string, unknown> = {}) => ({
    canvas: fakeCanvas(),
    width: 640,
    height: 360,
    fps: 10,
    durationSec: 1,
    format: formato,
    bitrate: 1_000_000,
    draw: () => undefined,
    ...extras,
  });

  it("codifica um quadro por passo do plano", async () => {
    const { gravados } = stubEncoder(WEBM_VP9);
    const blob = await recordVideoFast(opcoes(WEBM_VP9));
    expect(gravados).toHaveLength(10);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("video/webm");
  });

  it("gera MP4 quando o formato é MP4", async () => {
    stubEncoder(MP4);
    const blob = await recordVideoFast(opcoes(MP4));
    expect(blob.type).toBe("video/mp4");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(4, 8))).toBe("ftyp");
  });

  it("usa os timestamps exatos do plano", async () => {
    const { gravados } = stubEncoder(WEBM_VP9);
    await recordVideoFast(opcoes(WEBM_VP9));
    expect(gravados[0].timestamp).toBe(0);
    expect(gravados[1].timestamp).toBe(100_000);
    expect(gravados[9].timestamp).toBe(900_000);
    expect(gravados.every((g) => g.duration === 100_000)).toBe(true);
  });

  it("desenha cada quadro antes de codificá-lo, com t de 0 a 1", async () => {
    stubEncoder(WEBM_VP9);
    const vistos: number[] = [];
    let quadrosNaHoraDoDesenho = -1;
    await recordVideoFast(
      opcoes(WEBM_VP9, {
        draw: (_c: unknown, t: number) => {
          vistos.push(t);
          quadrosNaHoraDoDesenho = vistos.length;
        },
      }),
    );
    expect(vistos[0]).toBe(0);
    expect(vistos[vistos.length - 1]).toBe(1);
    expect(vistos).toHaveLength(10);
    // o desenho acontece antes do encode: o total desenhado iguala o codificado
    expect(quadrosNaHoraDoDesenho).toBe(10);
  });

  it("reporta progresso crescente até 1", async () => {
    stubEncoder(WEBM_VP9);
    const progresso: number[] = [];
    await recordVideoFast(opcoes(WEBM_VP9, { onProgress: (t: number) => progresso.push(t) }));
    expect(progresso[0]).toBe(0);
    expect(progresso[progresso.length - 1]).toBe(1);
    for (let i = 1; i < progresso.length; i++) {
      expect(progresso[i]).toBeGreaterThan(progresso[i - 1]);
    }
  });

  it("marca o primeiro quadro como chave", async () => {
    const { gravados } = stubEncoder(WEBM_VP9);
    await recordVideoFast(opcoes(WEBM_VP9));
    expect(gravados[0].keyFrame).toBe(true);
  });

  it("fecha o encoder e finaliza a fila", async () => {
    stubEncoder(WEBM_VP9);
    await recordVideoFast(opcoes(WEBM_VP9));
    const enc = (globalThis as unknown as { VideoEncoder: { ultimo: { fechado: boolean; finalizado: boolean } } })
      .VideoEncoder.ultimo;
    expect(enc.fechado).toBe(true);
    expect(enc.finalizado).toBe(true);
  });

  it("cancela no meio e não deixa o encoder aberto", async () => {
    stubEncoder(WEBM_VP9);
    let chamadas = 0;
    await expect(
      recordVideoFast(
        opcoes(WEBM_VP9, {
          shouldCancel: () => ++chamadas > 3,
        }),
      ),
    ).rejects.toThrow(/cancelada/i);
  });

  it("propaga erro do encoder", async () => {
    stubEncoder(WEBM_VP9);
    const promessa = recordVideoFast(
      opcoes(WEBM_VP9, {
        // dispara o erro do encoder logo depois que ele é configurado
        draw: () => {
          const enc = (
            globalThis as unknown as { VideoEncoder: { ultimo: { dispararErro: (e: unknown) => void } | null } }
          ).VideoEncoder.ultimo;
          if (enc) enc.dispararErro(new Error("codec explodiu"));
        },
      }),
    );
    await expect(promessa).rejects.toThrow(/codec explodiu/);
  });

  it("avisa quando o navegador não tem WebCodecs", async () => {
    vi.stubGlobal("VideoEncoder", undefined);
    vi.stubGlobal("VideoFrame", undefined);
    await expect(recordVideoFast(opcoes(WEBM_VP9))).rejects.toThrow(/WebCodecs/);
  });
});

/*
 * O motivo é a diferença entre "não deu" e "não deu por isto".
 *
 * O app caía para a gravação em tempo real sem dizer nada: o usuário ligou o ⚡,
 * recebeu um arquivo de tempo real a 60 quadros por segundo e só descobriu pelo
 * painel do fim, com 63% de cadência.
 */
describe("motivoRapidoIndisponivel", () => {
  it("explica que falta WebCodecs no navegador", async () => {
    vi.stubGlobal("VideoEncoder", undefined);
    vi.stubGlobal("VideoFrame", undefined);
    const motivo = await motivoRapidoIndisponivel(MP4, 720, 1280, 60);
    expect(motivo).toContain("WebCodecs");
  });

  it("devolve null quando o navegador aceita o formato", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: true }) });
    expect(await motivoRapidoIndisponivel(MP4, 720, 1280, 60)).toBeNull();
  });

  it("diz qual formato e tamanho foram recusados", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: false }) });
    const motivo = await motivoRapidoIndisponivel(MP4, 720, 1280, 60);
    expect(motivo).toContain("MP4 (H.264)");
    expect(motivo).toContain("720×1280");
  });

  it("conta quando o navegador estoura ao ser perguntado", async () => {
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("VideoEncoder", {
      isConfigSupported: async () => {
        throw new Error("sem encoder");
      },
    });
    const motivo = await motivoRapidoIndisponivel(WEBM_VP9, 1080, 1920, 30);
    expect(motivo).toContain("WebM (VP9)");
    expect(motivo?.length).toBeGreaterThan(10);
  });
});
