/**
 * Exportação rápida com WebCodecs.
 *
 * O `MediaRecorder` grava em **tempo real**: um vídeo de 14 s leva 14 s ou
 * mais, e o instante de cada quadro depende do `requestAnimationFrame` — um
 * quadro perdido vira engasgo no arquivo. Aqui os quadros são renderizados o
 * mais rápido que a máquina conseguir, com timestamp exato e fps constante.
 *
 * O `MediaRecorder` continua sendo o caminho de fallback: nem todo navegador
 * tem `VideoEncoder` (e o Safari só ganhou suporte recentemente).
 *
 * As partes puras — plano de quadros e configuração do encoder — ficam
 * separadas para poderem ser testadas sem navegador.
 */

import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { CancelledError, type VideoFormat } from "./recorder";

/** Um quadro do vídeo, com o tempo já resolvido. */
export type FrameStep = {
  /** instante normalizado da rota (0..1) */
  t: number;
  /** segundos desde o início — para animações que dependem do tempo */
  elapsed: number;
  /** timestamp exato, em microssegundos */
  timestampUs: number;
  /** duração do quadro, em microssegundos */
  durationUs: number;
  /** quadro-chave: permite abrir o vídeo rápido e cortar com precisão */
  keyFrame: boolean;
};

/** Um quadro-chave a cada 2 s. */
const KEYFRAME_SECONDS = 2;

/**
 * Distribui os quadros no tempo.
 *
 * O último quadro cai exatamente em `t = 1`, para o vídeo terminar junto com a
 * rota — diferente da gravação em tempo real, que depende de onde o relógio
 * estava quando o laço parou.
 */
export function framePlan(fps: number, durationSec: number): FrameStep[] {
  const total = Math.max(1, Math.round(fps * durationSec));
  const durationUs = Math.round(1_000_000 / fps);
  const keyEvery = Math.max(1, Math.round(fps * KEYFRAME_SECONDS));
  const out: FrameStep[] = [];

  for (let i = 0; i < total; i++) {
    out.push({
      t: total <= 1 ? 0 : i / (total - 1),
      elapsed: i / fps,
      timestampUs: Math.round((i * 1_000_000) / fps),
      durationUs,
      keyFrame: i % keyEvery === 0,
    });
  }
  return out;
}

/** Configuração do `VideoEncoder` para o formato escolhido. */
export function encoderConfigFor(
  format: VideoFormat,
  width: number,
  height: number,
  bitrate: number,
  fps: number,
): VideoEncoderConfig {
  const base: VideoEncoderConfig = {
    codec: format.codec,
    width,
    height,
    bitrate,
    framerate: fps,
  };
  if (format.container === "mp4") {
    // o muxer precisa do avcC; sem isso o MP4 sai com Annex B e não abre
    return { ...base, avc: { format: "avc" } };
  }
  return base;
}

/** Interface mínima comum aos dois muxers. */
export type MuxerLike = {
  addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  finalize: () => void;
};

export type MuxerBundle = { muxer: MuxerLike; buffer: () => ArrayBuffer };

/** Código do codec no vocabulário do Matroska, que é o que o webm-muxer usa. */
export function webmCodecFor(format: VideoFormat): "V_VP8" | "V_VP9" {
  return format.codec.startsWith("vp09") ? "V_VP9" : "V_VP8";
}

export function createMuxer(
  format: VideoFormat,
  width: number,
  height: number,
  fps: number,
): MuxerBundle {
  if (format.container === "mp4") {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      video: { codec: "avc", width, height, frameRate: fps },
      // deixa o arquivo pronto para tocar/baixar sem passar pelo fim
      fastStart: "in-memory",
    });
    return { muxer: muxer as unknown as MuxerLike, buffer: () => target.buffer };
  }

  const target = new WebmTarget();
  const muxer = new WebmMuxer({
    target,
    video: { codec: webmCodecFor(format), width, height, frameRate: fps },
  });
  return { muxer: muxer as unknown as MuxerLike, buffer: () => target.buffer };
}

export type FastEncodeOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  format: VideoFormat;
  bitrate: number;
  /** desenha um quadro para o tempo t (0..1). elapsed = segundos desde o início */
  draw: (ctx: CanvasRenderingContext2D, t: number, elapsed: number) => void;
  onProgress?: (t: number) => void;
  shouldCancel?: () => boolean;
};

/** O navegador tem WebCodecs e sabe codificar este formato neste tamanho? */
export async function isFastEncodeSupported(
  format: VideoFormat,
  width: number,
  height: number,
  fps = 30,
): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported(
      encoderConfigFor(format, width, height, 8_000_000, fps),
    );
    return Boolean(supported);
  } catch {
    return false;
  }
}

/**
 * Renderiza e codifica o vídeo o mais rápido possível.
 *
 * Lança `CancelledError` se `shouldCancel()` virar verdadeiro no meio.
 */
export async function recordVideoFast(opts: FastEncodeOptions): Promise<Blob> {
  const { canvas, width, height, fps, durationSec, format, bitrate } = opts;

  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("Este navegador não tem WebCodecs.");
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");

  const plan = framePlan(fps, durationSec);
  const { muxer, buffer } = createMuxer(format, width, height, fps);

  // objeto em vez de variável solta: o TS estreita `let` capturado por closure
  const state: { error: Error | null } = { error: null };

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      state.error = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    encoder.configure(encoderConfigFor(format, width, height, bitrate, fps));

    for (const f of plan) {
      if (opts.shouldCancel?.()) throw new CancelledError();
      if (state.error) throw state.error;

      opts.draw(ctx, f.t, f.elapsed);

      const frame = new VideoFrame(canvas, {
        timestamp: f.timestampUs,
        duration: f.durationUs,
      });
      encoder.encode(frame, { keyFrame: f.keyFrame });
      frame.close();

      opts.onProgress?.(f.t);

      // contrapressão: sem isso a fila do encoder cresce sem limite e a aba trava
      if (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    if (state.error) throw state.error;
  } finally {
    try {
      encoder.close();
    } catch {
      /* já fechado */
    }
  }

  muxer.finalize();
  const out = buffer();
  if (!out || out.byteLength === 0) {
    throw new Error("Nada foi codificado. Tente outro formato de vídeo.");
  }
  return new Blob([out], { type: format.mime.split(";")[0] });
}
