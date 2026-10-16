/**
 * Como o arquivo saiu: `fast` = WebCodecs, com o tempo exato de cada quadro;
 * `realtime` = `MediaRecorder`, que captura a tela no ritmo dela.
 */
export type VideoEngine = "fast" | "realtime";

export type VideoContainer = "mp4" | "webm";

export type VideoFormat = {
  id: string;
  label: string;
  ext: string;
  mime: string;
  /** contêiner do arquivo final */
  container: VideoContainer;
  /** codec no formato que o WebCodecs espera — usado na exportação rápida */
  codec: string;
};

const CANDIDATES: VideoFormat[] = [
  {
    id: "mp4-h264",
    label: "MP4 (H.264)",
    ext: "mp4",
    mime: "video/mp4;codecs=avc1.42E01E",
    container: "mp4",
    codec: "avc1.42E01E",
  },
  {
    id: "mp4",
    label: "MP4",
    ext: "mp4",
    mime: "video/mp4",
    container: "mp4",
    codec: "avc1.42E01E",
  },
  {
    id: "webm-vp9",
    label: "WebM (VP9)",
    ext: "webm",
    mime: "video/webm;codecs=vp9",
    container: "webm",
    codec: "vp09.00.10.08",
  },
  {
    id: "webm-vp8",
    label: "WebM (VP8)",
    ext: "webm",
    mime: "video/webm;codecs=vp8",
    container: "webm",
    codec: "vp8",
  },
  {
    id: "webm",
    label: "WebM",
    ext: "webm",
    mime: "video/webm",
    container: "webm",
    codec: "vp8",
  },
];

export function availableFormats(): VideoFormat[] {
  if (typeof MediaRecorder === "undefined") return [];
  const out: VideoFormat[] = [];
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) out.push(c);
    } catch {
      /* ignore */
    }
  }
  return out;
}

export type RecordOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  format: VideoFormat;
  bitrate: number;
  /** desenha o frame para o tempo t (0..1). elapsed = segundos desde o início */
  draw: (ctx: CanvasRenderingContext2D, t: number, elapsed: number) => void;
  onProgress?: (t: number) => void;
  shouldCancel?: () => boolean;
};

export class CancelledError extends Error {
  constructor() {
    super("Gravação cancelada");
  }
}

/**
 * Qual quadro do vídeo desenhar num instante do relógio.
 *
 * O desenho é feito na **grade do vídeo** (`i/fps`), e não no instante em que a
 * tela pediu o quadro. Num monitor de 60 Hz, um vídeo de 24 quadros por segundo
 * recebe 2 ou 3 quadros de tela alternados (33 ms e 50 ms); desenhando o
 * instante do relógio, cada captura levaria um meio-caminho entre dois quadros
 * do vídeo e o arquivo sairia com o movimento picado. Com a grade, cada captura
 * é um quadro inteiro do vídeo — o mesmo conteúdo que a exportação rápida
 * escreve —, e o codificador descarta o quadro repetido.
 *
 * O resultado é preso às pontas: nunca antes do primeiro, nunca depois do
 * último.
 */
export function indiceDoQuadro(elapsed: number, fps: number, total: number): number {
  const ultimo = Math.max(0, total - 1);
  return Math.min(ultimo, Math.max(0, Math.floor(elapsed * fps)));
}

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
  const { canvas, width, height, fps, durationSec, format, bitrate } = opts;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");

  // primeiro frame antes de iniciar a captura
  opts.draw(ctx, 0, 0);

  const stream = canvas.captureStream(fps);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: bitrate,
  });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(200);
  const startedAt = performance.now();

  /* os quadros saem na grade do vídeo — ver `indiceDoQuadro` */
  const total = Math.max(1, Math.round(fps * durationSec));
  const tempoDoQuadro = (i: number) => i / fps;
  let desenhado = 0;

  await new Promise<void>((resolve, reject) => {
    let raf = 0;
    const loop = () => {
      if (opts.shouldCancel?.()) {
        cancelAnimationFrame(raf);
        reject(new CancelledError());
        return;
      }
      const elapsed = (performance.now() - startedAt) / 1000;
      const i = indiceDoQuadro(elapsed, fps, total);
      const t = total <= 1 ? 1 : i / (total - 1);
      if (i !== desenhado) {
        desenhado = i;
        try {
          opts.draw(ctx, t, tempoDoQuadro(i));
        } catch (err) {
          cancelAnimationFrame(raf);
          reject(err instanceof Error ? err : new Error("Falha ao renderizar frame"));
          return;
        }
        opts.onProgress?.(t);
      }
      if (desenhado >= total - 1 || elapsed >= durationSec) {
        cancelAnimationFrame(raf);
        resolve();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  })
    .catch((err) => {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((tr) => tr.stop());
      throw err;
    })
    .then(() => undefined);

  // deixa o último frame "assentar" antes de fechar o arquivo
  await new Promise((r) => setTimeout(r, 300));
  try {
    recorder.stop();
  } catch {
    /* ignore */
  }
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());

  if (chunks.length === 0) throw new Error("Nada foi gravado. Tente outro formato de vídeo.");
  return new Blob(chunks, { type: format.mime.split(";")[0] });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
