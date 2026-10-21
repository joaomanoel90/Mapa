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
import {
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  blocosDeAudio,
  type BlocoDeAudio,
} from "./audio";
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

/* ------------------------------------------------------------------ */
/* H.264: o nível tem de caber no quadro                               */
/* ------------------------------------------------------------------ */

/**
 * Quanto um quadro precisa em macroblocos (16×16), como o H.264 conta.
 *
 * Em 720×1280 (o retrato do app) são `45 × 80 = 3600` macroblocos por quadro.
 */
export function macroblocosDoQuadro(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16);
}

type NivelH264 = {
  /** o nível em decimal (30 = 3.0) e em hexadecimal, como vai no codec */
  nivel: number;
  hex: string;
  /** `MaxFS`: macroblocos por quadro */
  maxFs: number;
  /** `MaxMBPS`: macroblocos por segundo */
  maxMbps: number;
};

/**
 * A tabela de níveis do H.264 (A.3), só com o que o app pode precisar.
 *
 * **Este era o defeito.** O app declarava o codec `avc1.42E01E` para qualquer
 * tamanho: `42E0` é o perfil Baseline e `1E` é o **nível 3.0**, cujo limite é
 * **1620 macroblocos por quadro**. Um quadro de 720×1280 tem **3600** — o dobro
 * do que o nível aceita. Ou seja, o app pedia ao navegador um perfil que **não
 * comporta nem um quadro**, e um navegador que siga a especificação responde
 * "não suportado" — e o app caía para a gravação em tempo real **sem nunca
 * conseguir usar o ⚡**. É a explicação de todas as gravações do usuário até
 * aqui terem saído em tempo real, mesmo com o ⚡ ligado.
 */
export const NIVEIS_H264: NivelH264[] = [
  { nivel: 30, hex: "1E", maxFs: 1620, maxMbps: 40_500 },
  { nivel: 31, hex: "1F", maxFs: 3600, maxMbps: 108_000 },
  { nivel: 32, hex: "20", maxFs: 5120, maxMbps: 216_000 },
  { nivel: 40, hex: "28", maxFs: 8192, maxMbps: 245_760 },
  { nivel: 41, hex: "29", maxFs: 8192, maxMbps: 245_760 },
  { nivel: 42, hex: "2A", maxFs: 8704, maxMbps: 522_240 },
  { nivel: 50, hex: "32", maxFs: 22_080, maxMbps: 589_824 },
  { nivel: 51, hex: "33", maxFs: 36_864, maxMbps: 983_040 },
  { nivel: 52, hex: "34", maxFs: 36_864, maxMbps: 2_073_600 },
];

/**
 * O nível mínimo que comporta este quadro nesta cadência.
 *
 * Precisa das duas contas: **por quadro** (720×1280 = 3600) e **por segundo**
 * (3600 × 60 = 216 000). Um quadro grande a 60 quadros por segundo pede um
 * nível acima do que o mesmo quadro a 30.
 *
 * O limite é tratado como **exclusivo**: 720×1280 a 30 fps dá exatamente os
 * 108 000 macroblocos por segundo do nível 3.1, e ficar no talo é o pior lugar
 * para se estar — os codificadores arredondam a conta e alguns recusam a
 * configuração na borda. No limite exato, sobe um nível. É por isso que 720×1280
 * a 60 fps (216 000, exatamente o teto do 3.2) resulta no **4.0**.
 */
export function nivelH264Para(width: number, height: number, fps: number): NivelH264 {
  const fs = macroblocosDoQuadro(width, height);
  const mbps = fs * Math.max(1, fps);
  for (const n of NIVEIS_H264) {
    if (fs <= n.maxFs && mbps < n.maxMbps) return n;
  }
  return NIVEIS_H264[NIVEIS_H264.length - 1];
}

/**
 * Os codecs H.264 a tentar, do mais capaz ao mais básico.
 *
 * O perfil importa para o navegador aceitar: o Safari (iPhone/iPad) só sabe
 * codificar **High** e **Main** pelo WebCodecs; o Chrome aceita os três. Por
 * isso a lista é tentada em ordem — e o primeiro que o navegador confirmar é o
 * que grava. Todos com o **nível calculado**, que é a parte que faltava.
 */
export function codecsH264(width: number, height: number, fps: number): string[] {
  const { hex } = nivelH264Para(width, height, fps);
  return [
    `avc1.6400${hex}`, // High
    `avc1.4D00${hex}`, // Main
    `avc1.4200${hex}`, // Baseline
    `avc1.42E0${hex}`, // Baseline com constraints (o que o Safari gosta)
  ];
}

/**
 * Configuração do `VideoEncoder` para o formato escolhido.
 *
 * `codec` é o escolhido por `codecAceito` — no H.264 ele **não** pode ser o do
 * formato: o formato traz o nível 3.0 fixo, e o nível tem de sair do tamanho do
 * quadro (ver `nivelH264Para`).
 */
export function encoderConfigFor(
  format: VideoFormat,
  width: number,
  height: number,
  bitrate: number,
  fps: number,
  codec = format.codec,
): VideoEncoderConfig {
  const base: VideoEncoderConfig = {
    codec,
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

/**
 * O primeiro codec que **este** navegador aceita para este tamanho e cadência.
 *
 * Devolve `null` quando nenhum passa — aí a exportação rápida não existe mesmo.
 * O H.264 é testado na lista de perfis (`codecsH264`); os outros formatos têm um
 * codec só.
 */
export async function codecAceito(
  format: VideoFormat,
  width: number,
  height: number,
  fps = 30,
  bitrate = 8_000_000,
): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const candidatos = format.container === "mp4" ? codecsH264(width, height, fps) : [format.codec];
  for (const codec of candidatos) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported(
        encoderConfigFor(format, width, height, bitrate, fps, codec),
      );
      if (supported) return codec;
    } catch {
      /* tenta o próximo perfil */
    }
  }
  return null;
}

/** Interface mínima comum aos dois muxers. */
export type MuxerLike = {
  addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  addAudioChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;
  finalize: () => void;
};

/** A faixa de áudio que o muxer precisa declarar no cabeçalho do arquivo. */
export type MuxerAudio = { numberOfChannels: number; sampleRate: number };

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
  audio?: MuxerAudio | null,
): MuxerBundle {
  /*
   * A faixa de áudio é declarada **aqui**, no cabeçalho: um arquivo com trilha
   * anunciada e nenhum bloco dentro sai quebrado em vários tocadores. Por isso
   * quem chama só passa `audio` depois de o áudio já estar codificado.
   */
  if (format.container === "mp4") {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      video: { codec: "avc", width, height, frameRate: fps },
      ...(audio
        ? {
            audio: {
              codec: "aac" as const,
              numberOfChannels: audio.numberOfChannels,
              sampleRate: audio.sampleRate,
            },
          }
        : {}),
      // deixa o arquivo pronto para tocar/baixar sem passar pelo fim
      fastStart: "in-memory",
    });
    return { muxer: muxer as unknown as MuxerLike, buffer: () => target.buffer };
  }

  const target = new WebmTarget();
  const muxer = new WebmMuxer({
    target,
    video: { codec: webmCodecFor(format), width, height, frameRate: fps },
    ...(audio
      ? {
          audio: {
            // o CodecID do Matroska é `A_OPUS` — `"opus"` gravaria um arquivo
            // que os tocadores não reconhecem (o WebCodecs usa outro nome)
            codec: "A_OPUS" as const,
            numberOfChannels: audio.numberOfChannels,
            sampleRate: audio.sampleRate,
          },
        }
      : {}),
  });
  return { muxer: muxer as unknown as MuxerLike, buffer: () => target.buffer };
}

/* ------------------------------------------------------------------ */
/* Áudio no arquivo                                                    */
/* ------------------------------------------------------------------ */

/**
 * A configuração do codificador de áudio para este contêiner.
 *
 * MP4 leva **AAC-LC** (`mp4a.40.2`), que é o que toca em tudo; WebM leva
 * **Opus**, que é o que o contêiner aceita. Os dois em 48 kHz, que é a taxa da
 * trilha montada em `audio.ts` — pedir outra obrigaria a reamostrar de novo.
 */
export function audioConfigFor(
  format: VideoFormat,
  channels = 2,
  sampleRate = AUDIO_SAMPLE_RATE,
  bitrate = AUDIO_BITRATE,
): AudioEncoderConfig {
  return {
    codec: format.container === "mp4" ? "mp4a.40.2" : "opus",
    sampleRate,
    numberOfChannels: channels,
    bitrate,
  };
}

/** O navegador sabe codificar áudio nesta configuração? */
export async function audioSuportado(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const r = await AudioEncoder.isConfigSupported(config);
    return !!r.supported;
  } catch {
    return false;
  }
}

/**
 * Quantos quadros de áudio por bloco.
 *
 * AAC codifica em quadros de **1024** amostras; Opus, em múltiplos de 2,5 ms
 * (960 amostras a 48 kHz = 20 ms). Blocos tortos fazem o codificador recusar ou
 * preencher com silêncio no meio.
 */
export function framesPorBlocoDeAudio(format: VideoFormat): number {
  return format.container === "mp4" ? 1024 : 960;
}

type BlocoCodificado = {
  chunk: EncodedAudioChunk;
  meta?: EncodedAudioChunkMetadata;
};

/**
 * Codifica a trilha inteira antes do primeiro quadro de vídeo.
 *
 * A ordem importa: o muxer precisa saber, ao ser criado, se o arquivo tem
 * áudio. Codificando antes, um erro no áudio vira "vídeo sem som" em vez de um
 * arquivo com a faixa anunciada e vazia.
 */
async function codificarAudio(
  canais: Float32Array[],
  sampleRate: number,
  format: VideoFormat,
  config: AudioEncoderConfig,
): Promise<BlocoCodificado[] | null> {
  const blocos: BlocoDeAudio[] = blocosDeAudio(canais, framesPorBlocoDeAudio(format));
  if (blocos.length === 0) return null;

  const saida: BlocoCodificado[] = [];
  let erro: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => saida.push({ chunk, meta }),
    error: (err) => {
      erro = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    encoder.configure(config);
    const canaisReais = config.numberOfChannels ?? 2;
    const usPorBloco = (blocos[0].frames / sampleRate) * 1_000_000;
    for (let i = 0; i < blocos.length; i++) {
      if (erro) throw erro;
      const data = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: blocos[i].frames,
        numberOfChannels: canaisReais,
        timestamp: Math.round(i * usPorBloco),
        data: blocos[i].data as unknown as BufferSource,
      });
      encoder.encode(data);
      data.close();
    }
    await encoder.flush();
    if (erro) throw erro;
  } catch {
    return null;
  } finally {
    try {
      encoder.close();
    } catch {
      /* já fechado */
    }
  }
  return saida.length > 0 ? saida : null;
}

export type FastEncodeOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  format: VideoFormat;
  bitrate: number;
  /**
   * O codec exato que o navegador aceitou (`codecAceito`). No H.264 ele traz o
   * **nível** calculado para o tamanho do quadro — o codec do formato é fixo no
   * nível 3.0 e não cabe em 720×1280.
   */
  codec?: string;
  /** desenha um quadro para o tempo t (0..1). elapsed = segundos desde o início */
  draw: (ctx: CanvasRenderingContext2D, t: number, elapsed: number) => void;
  onProgress?: (t: number) => void;
  shouldCancel?: () => boolean;
  /**
   * A trilha do vídeo (música + pops), já montada e do tamanho do vídeo.
   * Ausente = vídeo mudo, como era antes.
   */
  audio?: { canais: Float32Array[]; sampleRate: number };
  /** avisa se o arquivo saiu com som (o navegador pode não codificar áudio) */
  onSom?: (comSom: boolean) => void;
};

/**
 * O navegador tem WebCodecs e sabe codificar **este** tamanho, nesta cadência?
 *
 * Passa pela lista de perfis (`codecAceito`): antes a pergunta era feita com o
 * codec fixo do formato — `avc1.42E01E`, nível 3.0 —, e a resposta era "não"
 * para qualquer quadro acima de 1620 macroblocos (720×1280 tem 3600).
 */
export async function isFastEncodeSupported(
  format: VideoFormat,
  width: number,
  height: number,
  fps = 30,
): Promise<boolean> {
  return (await codecAceito(format, width, height, fps)) !== null;
}

/**
 * Por que a exportação rápida (⚡) não pode rodar — ou `null` se ela pode.
 *
 * A pergunta já existia (`isFastEncodeSupported`) e a resposta era um simples
 * "não": o app caía para a gravação em tempo real **em silêncio**. Foi assim que
 * o usuário gravou 60 segundos em tempo real a 60 fps achando que estava no ⚡
 * — e o painel do fim veio com 63% de cadência. Um "não" sem motivo não dá o que
 * fazer; o motivo diz se é o navegador, o formato ou o tamanho.
 */
export async function motivoRapidoIndisponivel(
  format: VideoFormat,
  width: number,
  height: number,
  fps = 30,
): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    return "este navegador não tem WebCodecs (a exportação rápida precisa dele)";
  }
  if ((await codecAceito(format, width, height, fps)) !== null) return null;
  if (format.container === "mp4") {
    const nivel = nivelH264Para(width, height, fps);
    return (
      `este navegador não codifica H.264 em ${width}×${height} a ${fps} quadros por segundo ` +
      `(nem no nível ${(nivel.nivel / 10).toFixed(1)}, que é o que esse tamanho pede). ` +
      "Escolha WebM (VP9) no campo Arquivo: não tem essa limitação de nível."
    );
  }
  return `este navegador não sabe codificar ${format.label} em ${width}×${height}`;
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

  /*
   * O áudio é codificado **antes** do primeiro quadro de vídeo.
   *
   * Duas razões: o muxer precisa declarar a faixa no cabeçalho (uma faixa
   * anunciada e vazia quebra o arquivo), e 14 s de áudio levam milissegundos —
   * não vale a pena intercalar com o desenho. Se o navegador não souber
   * codificar, o vídeo sai mudo e `onSom(false)` avisa a tela.
   */
  const canais = opts.audio?.canais?.length ? opts.audio.canais : null;
  const numeroDeCanais = canais ? Math.min(2, canais.length) : 0;
  const configAudio =
    canais && numeroDeCanais > 0
      ? audioConfigFor(format, numeroDeCanais, opts.audio!.sampleRate)
      : null;
  const podeAudio = configAudio ? await audioSuportado(configAudio) : false;
  const audioCodificado =
    podeAudio && canais && configAudio
      ? await codificarAudio(canais, opts.audio!.sampleRate, format, configAudio)
      : null;
  /*
   * Se o muxer recusar a faixa (contêiner sem suporte, configuração estranha),
   * o vídeo sai **mudo** em vez de a exportação inteira falhar: perder o som é
   * ruim, perder o vídeo é pior.
   */
  let comAudio = !!audioCodificado && !!configAudio;
  const criar = (comFaixa: boolean) =>
    createMuxer(
      format,
      width,
      height,
      fps,
      comFaixa && configAudio
        ? { numberOfChannels: numeroDeCanais, sampleRate: opts.audio!.sampleRate }
        : null,
    );

  let bundle: MuxerBundle;
  try {
    bundle = criar(comAudio);
  } catch (err) {
    if (!comAudio) throw err;
    comAudio = false;
    bundle = criar(false);
  }
  opts.onSom?.(comAudio);

  const { muxer, buffer } = bundle;

  /*
   * Os blocos de áudio entram **intercalados** com os quadros: o muxer escreve
   * o arquivo na ordem em que recebe, e um arquivo com 14 s de áudio na frente
   * e o vídeo inteiro depois obriga o tocador a pular o arquivo inteiro para
   * começar a imagem.
   */
  let audioIdx = 0;
  const drenarAudio = (ateUs: number) => {
    if (!comAudio || !audioCodificado) return;
    while (
      audioIdx < audioCodificado.length &&
      Number(audioCodificado[audioIdx].chunk.timestamp) <= ateUs
    ) {
      const { chunk, meta } = audioCodificado[audioIdx++];
      muxer.addAudioChunk(chunk, meta);
    }
  };

  // objeto em vez de variável solta: o TS estreita `let` capturado por closure
  const state: { error: Error | null } = { error: null };

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      state.error = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    /*
     * O codec vem resolvido (`codecAceito`), com o nível que cabe no quadro. Se
     * quem chamou não passou, resolvemos aqui — nunca a configuração crua do
     * formato, que tem o nível 3.0 fixo.
     */
    const codec =
      opts.codec ?? (await codecAceito(format, width, height, fps, bitrate)) ?? format.codec;
    encoder.configure(encoderConfigFor(format, width, height, bitrate, fps, codec));

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

      drenarAudio(f.timestampUs);

      opts.onProgress?.(f.t);

      // contrapressão: sem isso a fila do encoder cresce sem limite e a aba trava
      if (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    drenarAudio(Number.POSITIVE_INFINITY);
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
