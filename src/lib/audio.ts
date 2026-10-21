/**
 * O som do vídeo.
 *
 * Até agora o arquivo saía **mudo** — `video/*` puro, sem faixa de áudio. Um
 * Reel sem som perde metade do efeito, mas música de terceiros não pode entrar
 * no arquivo de quem publica. Então o som tem duas camadas, com origens
 * diferentes:
 *
 * 1. **pops** — sintetizados aqui, nota por nota, sem sample nenhum. Ninguém
 *    precisa de licença para um `sin()` que decai. Eles marcam os momentos que
 *    o vídeo já destaca na tela: a largada, cada parada passada e a chegada;
 * 2. **música** — o arquivo que o usuário escolher. O app não distribui faixa
 *    nenhuma: decodifica o arquivo dele, ajusta ao tamanho do vídeo (repetindo
 *    com emenda suave, se for curta) e mistura por baixo dos pops.
 *
 * Tudo o que dá para conferir sem navegador — quando cada pop cai, como cada um
 * soa, a emenda da repetição, o corte do fim, a divisão em blocos para o
 * codificador — é função pura aqui. Só a decodificação do arquivo de música e a
 * reprodução na gravação em tempo real tocam o navegador.
 */

import { routeEnd, type Timeline } from "./timeline";

/** Taxa de amostragem de tudo o que sai daqui. AAC e Opus adoram 48 kHz. */
export const AUDIO_SAMPLE_RATE = 48_000;

/** Bits por segundo da faixa de áudio — o mesmo que um podcast leve. */
export const AUDIO_BITRATE = 128_000;

/** Volume padrão da música, por baixo dos pops. */
export const MUSICA_VOLUME_PADRAO = 0.55;

/** Emenda da repetição da música, em segundos. */
export const EMENDA_S = 0.12;

/* ------------------------------------------------------------------ */
/* Quando cada pop acontece                                            */
/* ------------------------------------------------------------------ */

/** O que o pop marca. */
export type SomKind = "largada" | "parada" | "chegada" | "recap";

export type SomEvento = {
  /** instante no vídeo, em segundos */
  at: number;
  kind: SomKind;
};

/** Dois pops mais próximos que isto viram um só (senão o volume dobra). */
const MIN_SEPARACAO_S = 0.12;

/**
 * Os instantes dos pops, em segundos de vídeo.
 *
 * As paradas vêm em **progresso do percurso** (0..1), como o resto do desenho;
 * aqui elas viram tempo de vídeo pelo mesmo par `voo`/`percurso` que a câmera
 * usa — é o que faz o pop cair junto com o pino, e não antes nem depois.
 *
 * O vídeo começa no voo de abertura: durante ele não há pop nenhum, porque
 * nada aconteceu ainda. O primeiro é a largada, quando o personagem começa a
 * andar.
 */
export function momentosDoSom(opts: {
  duration: number;
  timeline: Timeline;
  /** instantes de passagem, em progresso do percurso (0..1) */
  passages?: { t: number }[];
  /** há cartela no fim? (muda o volume do último pop, não a posição) */
  cartela?: boolean;
  /** quantos melhores momentos o fim do vídeo mostra (0/ausente = sem bloco) */
  recap?: number;
}): SomEvento[] {
  const dur = Number.isFinite(opts.duration) ? Math.max(0, opts.duration) : 0;
  const tl = opts.timeline;
  const fim = Math.min(routeEnd(tl), dur);
  const brutos: SomEvento[] = [];

  // a largada: quando o voo acaba e o personagem parte
  if (tl.voo > 0.15 && tl.voo < fim - 0.1) brutos.push({ at: tl.voo, kind: "largada" });

  for (const p of opts.passages ?? []) {
    const t = Number.isFinite(p.t) ? Math.min(1, Math.max(0, p.t)) : 0;
    const at = tl.voo + t * tl.percurso;
    if (at > 0 && at < fim - MIN_SEPARACAO_S) brutos.push({ at, kind: "parada" });
  }

  if (fim > 0) brutos.push({ at: fim, kind: "chegada" });

  /*
   * As viradas dos **melhores momentos**: um pop mais discreto a cada cartão
   * novo. O primeiro cartão entra junto da chegada (que já tem o seu pop), por
   * isso a contagem começa no segundo.
   */
  const nRecap = Math.max(0, Math.floor(opts.recap ?? 0));
  if (tl.recap > 0 && nRecap >= 2) {
    const passo = tl.recap / nRecap;
    for (let i = 1; i < nRecap; i++) {
      const at = routeEnd(tl) + i * passo;
      if (at < dur - MIN_SEPARACAO_S) brutos.push({ at, kind: "recap" });
    }
  }

  /*
   * Ordena e junta o que caiu em cima: duas paradas no mesmo ponto (ou a
   * primeira passagem colada na largada) somariam dois pops no mesmo instante —
   * o dobro de volume, e o ouvido não distingue "dois" de "um mais alto".
   */
  brutos.sort((a, b) => a.at - b.at);
  const out: SomEvento[] = [];
  for (const e of brutos) {
    const anterior = out[out.length - 1];
    if (anterior && Math.abs(e.at - anterior.at) < MIN_SEPARACAO_S) continue;
    out.push(e);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Como cada pop soa                                                   */
/* ------------------------------------------------------------------ */

/**
 * Uma nota do pop: uma senoide que decai, com um harmônico e um estalo curto.
 *
 * O estalo é o que faz soar como "pop" e não como "bipe": são 4 ms de 3,2 kHz
 * decaindo — o ouvido lê isso como o começo de uma batida, não como um tom.
 */
type Nota = {
  /** frequência fundamental, em Hz */
  freq: number;
  /** quando a nota começa, em segundos depois do evento */
  atraso: number;
  /** quanto tempo a nota leva para sumir (constante do decaimento) */
  decaimento: number;
  duracao: number;
  ganho: number;
};

/**
 * A receita de cada pop.
 *
 * - **largada**: grave e curta, um "toc" que só marca o começo;
 * - **parada**: aguda e curtinha, para não competir com o que está na tela;
 * - **chegada**: duas notas (uma quinta acima), a segunda mais longa — é o
 *   único momento do vídeo em que o som pode celebrar.
 */
const RECEITAS: Record<SomKind, Nota[]> = {
  largada: [{ freq: 520, atraso: 0, decaimento: 0.045, duracao: 0.18, ganho: 0.2 }],
  parada: [{ freq: 880, atraso: 0, decaimento: 0.04, duracao: 0.2, ganho: 0.3 }],
  recap: [{ freq: 740, atraso: 0, decaimento: 0.04, duracao: 0.16, ganho: 0.14 }],
  chegada: [
    { freq: 660, atraso: 0, decaimento: 0.06, duracao: 0.26, ganho: 0.26 },
    { freq: 990, atraso: 0.11, decaimento: 0.14, duracao: 0.5, ganho: 0.24 },
  ],
};

/** Quanto a música abaixa quando um pop entra por cima dela. */
export const ABAIXO_DO_POP = 0.55;

/** Em quanto tempo a música desce e volta (ataque curto, volta macia). */
const ATAQUE_POP_S = 0.015;
const VOLTA_POP_S = 0.3;

/**
 * Abaixa a música por um instante, em cada pop.
 *
 * Sem isso, o pop disputa volume com a música e some — ou, para ser ouvido,
 * teria de ser alto a ponto de estourar. É o mesmo truque de rádio: a voz entra,
 * o fundo desce um pouco e volta. O ataque é de 15 ms (para não estalar) e a
 * volta leva 300 ms.
 */
export function abaixarSobPops(
  canais: Float32Array[],
  eventos: SomEvento[],
  sampleRate = AUDIO_SAMPLE_RATE,
): Float32Array[] {
  const n = canais[0]?.length ?? 0;
  if (n === 0 || eventos.length === 0) return canais;

  const envelope = new Float32Array(n).fill(1);
  const ataque = Math.max(1, Math.round(ATAQUE_POP_S * sampleRate));
  const volta = Math.max(1, Math.round(VOLTA_POP_S * sampleRate));

  for (const ev of eventos) {
    const inicio = Math.round(ev.at * sampleRate);
    if (inicio >= n) continue;
    for (let i = 0; i < ataque + volta; i++) {
      const k = inicio + i;
      if (k >= n) break;
      const g =
        i < ataque
          ? 1 - (1 - ABAIXO_DO_POP) * (i / ataque)
          : ABAIXO_DO_POP + (1 - ABAIXO_DO_POP) * (i - ataque) / volta;
      if (g < envelope[k]) envelope[k] = g;
    }
  }

  return canais.map((canal) => {
    const out = new Float32Array(canal.length);
    for (let i = 0; i < canal.length; i++) out[i] = canal[i] * envelope[i];
    return out;
  });
}

const TAU = Math.PI * 2;

/**
 * Desenha os pops numa faixa **mono**, com `duration` segundos.
 *
 * Mono de propósito: um pop não tem lado. Quem transforma em estéreo é a
 * montagem da trilha, que copia o mesmo sinal para os dois canais.
 */
export function renderSom(
  eventos: SomEvento[],
  duration: number,
  sampleRate = AUDIO_SAMPLE_RATE,
): Float32Array {
  const n = Math.max(0, Math.round(Math.max(0, duration) * sampleRate));
  const out = new Float32Array(n);
  if (n === 0) return out;

  for (const ev of eventos) {
    for (const nota of RECEITAS[ev.kind] ?? []) {
      const inicio = Math.round((ev.at + nota.atraso) * sampleRate);
      if (inicio >= n) continue;
      const fim = Math.min(n, inicio + Math.round(nota.duracao * sampleRate));
      for (let i = Math.max(0, inicio); i < fim; i++) {
        const t = (i - inicio) / sampleRate;
        const env = Math.exp(-t / nota.decaimento);
        if (env < 1e-4) continue;
        const corpo = Math.sin(TAU * nota.freq * t) + 0.3 * Math.sin(TAU * nota.freq * 2 * t);
        // o estalo dos primeiros milissegundos: é ele que vira "pop"
        const estalo =
          t < 0.005 ? 0.5 * Math.sin(TAU * 3200 * t) * Math.exp(-t / 0.0015) : 0;
        out[i] += nota.ganho * (corpo * env + estalo);
      }
    }
  }

  // dois pops que se sobrepõem não podem estourar o arquivo
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/* ------------------------------------------------------------------ */
/* Música: repetir, cortar e baixar o volume                           */
/* ------------------------------------------------------------------ */

/** Uma faixa de áudio já decodificada: 1 ou 2 canais planares. */
export type Faixa = {
  canais: Float32Array[];
  sampleRate: number;
};

/**
 * A música do tamanho do vídeo.
 *
 * Faixa curta **repete**, com uma emenda de `EMENDA_S` em que o fim se mistura
 * com o começo (sem emenda, cada volta começa com um estalo). Faixa longa é
 * **cortada**, com a saída suavizada — o vídeo termina na cartela, e a música
 * não pode acabar no meio de um compasso.
 *
 * Devolve sempre **dois canais**: o muxer não gosta de descobrir o número de
 * canais no meio do arquivo.
 */
export function camaMusical(
  faixa: Faixa,
  duration: number,
  volume = MUSICA_VOLUME_PADRAO,
): Float32Array[] {
  const { sampleRate } = faixa;
  const n = Math.max(0, Math.round(duration * sampleRate));
  const canais = faixa.canais.length > 0 ? faixa.canais : [new Float32Array(0)];
  const esq = new Float32Array(n);
  const dir = new Float32Array(n);
  if (n === 0) return [esq, dir];

  const comprimento = canais[0].length;
  if (comprimento === 0) return [esq, dir];

  const emenda = Math.min(Math.round(EMENDA_S * sampleRate), Math.floor(comprimento / 2));
  const passo = Math.max(1, comprimento - emenda);

  const escrever = (destino: Float32Array, origem: Float32Array) => {
    let volta = 0;
    while (volta * passo < n) {
      const inicio = volta * passo;
      for (let i = 0; i < comprimento && inicio + i < n; i++) {
        /*
         * Na emenda, a cauda de uma volta e a cabeça da seguinte se somam com
         * pesos que dão 1 — é o que faz a repetição não estalar.
         */
        let peso = 1;
        if (volta > 0 && i < emenda) peso = i / emenda;
        if (i >= passo && emenda > 0) {
          const j = i - passo;
          if (j < emenda) peso = Math.min(peso, (emenda - j) / emenda);
        }
        destino[inicio + i] += origem[i] * peso;
      }
      volta++;
    }
  };

  escrever(esq, canais[0]);
  escrever(dir, canais[1] ?? canais[0]);

  /*
   * Entrada e saída: 0,5 s para a música aparecer e 1,2 s para ela sair. Sem a
   * saída, o corte no último quadro vira um "tec" no arquivo.
   */
  const entrada = Math.min(Math.round(0.5 * sampleRate), Math.floor(n / 4));
  const saida = Math.min(Math.round(1.2 * sampleRate), Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    let g = volume;
    if (entrada > 0 && i < entrada) g *= i / entrada;
    if (saida > 0 && i >= n - saida) g *= (n - i) / saida;
    esq[i] *= g;
    dir[i] *= g;
  }
  return [esq, dir];
}

/** Mistura os pops (mono) por cima da cama (estéreo). */
export function misturarSom(canais: Float32Array[], pops: Float32Array, ganho = 1): Float32Array[] {
  const n = Math.max(pops.length, canais[0]?.length ?? 0);
  const out = canais.map((c) => {
    const destino = new Float32Array(n);
    destino.set(c.subarray(0, Math.min(c.length, n)));
    return destino;
  });
  const esq = out[0] ?? new Float32Array(n);
  const dir = out[1] ?? esq;
  for (let i = 0; i < pops.length; i++) {
    esq[i] += pops[i] * ganho;
    dir[i] += pops[i] * ganho;
  }
  return [esq, dir];
}

/**
 * A trilha completa do vídeo: música (se houver) + pops.
 *
 * Pura de propósito: entra a música já decodificada, sai o PCM que o
 * codificador vai comer. É o que permite testar a mistura sem navegador.
 */
export function montarTrilha(opts: {
  duration: number;
  eventos: SomEvento[];
  musica?: Faixa | null;
  volume?: number;
  sampleRate?: number;
}): { sampleRate: number; canais: Float32Array[] } {
  const sampleRate = opts.sampleRate ?? AUDIO_SAMPLE_RATE;
  const n = Math.max(0, Math.round(opts.duration * sampleRate));
  const pops = renderSom(opts.eventos, opts.duration, sampleRate);

  const musica = opts.musica
    ? reamostrar(opts.musica, sampleRate)
    : null;
  const cama = musica
    ? abaixarSobPops(
        camaMusical(musica, opts.duration, opts.volume ?? MUSICA_VOLUME_PADRAO),
        opts.eventos,
        sampleRate,
      )
    : [new Float32Array(n), new Float32Array(n)];

  const mix = misturarSom(cama, pops);
  // a soma de música + pops pode passar de 1: o arquivo não pode estourar
  for (const canal of mix) {
    for (let i = 0; i < canal.length; i++) {
      canal[i] = Math.max(-1, Math.min(1, canal[i]));
    }
  }
  return { sampleRate, canais: mix };
}

/* ------------------------------------------------------------------ */
/* Reamostragem                                                        */
/* ------------------------------------------------------------------ */

/**
 * Leva uma faixa para outra taxa de amostragem, por interpolação linear.
 *
 * Precisa existir porque o arquivo do usuário pode vir em 44,1 kHz (CD, MP3) e
 * a trilha é montada em 48 kHz. Misturar taxas diferentes sairia com o som
 * acelerado ou arrastado — e o erro passaria despercebido até alguém ouvir.
 */
export function reamostrar(faixa: Faixa, destino: number): Faixa {
  const { sampleRate } = faixa;
  if (!(destino > 0) || !(sampleRate > 0) || sampleRate === destino) return faixa;
  const razao = destino / sampleRate;
  return {
    sampleRate: destino,
    canais: faixa.canais.map((canal) => {
      const n = Math.max(0, Math.round(canal.length * razao));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const pos = i / razao;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = canal[i0] ?? 0;
        const b = canal[i0 + 1] ?? a;
        out[i] = a + (b - a) * frac;
      }
      return out;
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Blocos para o codificador                                           */
/* ------------------------------------------------------------------ */

/** Um bloco planar pronto para virar `AudioData`. */
export type BlocoDeAudio = {
  /** canais concatenados (`f32-planar`: primeiro o esquerdo inteiro, depois o direito) */
  data: Float32Array;
  /** quantos quadros (amostras por canal) este bloco tem */
  frames: number;
};

/**
 * Fatia a trilha em blocos de `framesPorBloco` quadros.
 *
 * O último bloco é **completado com silêncio** em vez de sair menor: o AAC
 * codifica em quadros de 1024 amostras e o Opus em múltiplos de 2,5 ms; um
 * bloco torto no fim faz alguns codificadores recusarem o arquivo inteiro.
 */
export function blocosDeAudio(
  canais: Float32Array[],
  framesPorBloco: number,
): BlocoDeAudio[] {
  const canaisOk = canais.length > 0 ? canais : [new Float32Array(0)];
  const total = canaisOk[0].length;
  const passo = Math.max(1, Math.floor(framesPorBloco));
  const out: BlocoDeAudio[] = [];
  for (let inicio = 0; inicio < total; inicio += passo) {
    const frames = Math.min(passo, total - inicio);
    const data = new Float32Array(passo * canaisOk.length);
    for (let c = 0; c < canaisOk.length; c++) {
      for (let i = 0; i < frames; i++) data[c * passo + i] = canaisOk[c][inicio + i] ?? 0;
    }
    out.push({ data, frames: passo });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Navegador: decodificar a música e tocar na gravação em tempo real    */
/* ------------------------------------------------------------------ */

type JanelaDeAudio = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function contextoDeAudio(): AudioContext | null {
  const w = globalThis as unknown as JanelaDeAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    // já no formato da trilha: o navegador reamostra o arquivo na decodificação
    return new Ctor({ sampleRate: AUDIO_SAMPLE_RATE });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

/** O arquivo pode ser usado como música? Devolve o motivo quando não pode. */
export function checkAudioFile(file: { type?: string; size?: number }): string | null {
  const tipo = file.type ?? "";
  if (!tipo.startsWith("audio/")) {
    return "Este arquivo não é áudio. Use MP3, M4A, WAV ou OGG.";
  }
  const tamanho = file.size ?? 0;
  if (tamanho > 24 * 1024 * 1024) {
    return "O arquivo de música passa de 24 MB. Use uma versão menor (ou um trecho).";
  }
  if (tamanho === 0) return "O arquivo está vazio.";
  return null;
}

/**
 * Decodifica o arquivo de música escolhido.
 *
 * Devolve `null` quando o navegador não conseguiu abrir — a exportação segue
 * sem música, com os pops, em vez de falhar.
 */
export async function lerMusica(file: Blob): Promise<Faixa | null> {
  const ctx = contextoDeAudio();
  if (!ctx) return null;
  try {
    const dados = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(dados);
    const canais: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
      canais.push(buffer.getChannelData(c).slice());
    }
    return { canais, sampleRate: buffer.sampleRate };
  } catch {
    return null;
  } finally {
    void ctx.close?.().catch(() => undefined);
  }
}

/** Quanto tempo dura uma faixa, em segundos. */
export function duracaoDaFaixa(faixa: Faixa): number {
  const canal = faixa.canais[0];
  return canal && faixa.sampleRate > 0 ? canal.length / faixa.sampleRate : 0;
}

/**
 * Toca a trilha dentro da gravação em tempo real.
 *
 * O `MediaRecorder` grava o que chega na `MediaStream`: o canvas entra pelo
 * vídeo e a trilha entra por um `MediaStreamAudioDestinationNode`. Devolve a
 * faixa de áudio para quem chamou juntar na stream, e `start`/`stop` para
 * alinhar com o começo e o fim da gravação.
 */
export function tocarNaGravacao(
  canais: Float32Array[],
  sampleRate: number,
): { track: MediaStreamTrack | null; start: () => void; stop: () => void } | null {
  const ctx = contextoDeAudio();
  if (!ctx) return null;
  try {
    const destino = ctx.createMediaStreamDestination();
    const buffer = ctx.createBuffer(2, Math.max(1, canais[0]?.length ?? 0), sampleRate);
    const esq = new Float32Array(buffer.length);
    const dir = new Float32Array(buffer.length);
    esq.set((canais[0] ?? new Float32Array(0)).subarray(0, buffer.length));
    dir.set((canais[1] ?? canais[0] ?? new Float32Array(0)).subarray(0, buffer.length));
    buffer.copyToChannel(esq, 0);
    buffer.copyToChannel(dir, 1);
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(destino);
    const track = destino.stream.getAudioTracks()[0] ?? null;
    return {
      track,
      start: () => {
        void ctx.resume?.();
        try {
          fonte.start();
        } catch {
          /* já começou */
        }
      },
      stop: () => {
        try {
          fonte.stop();
        } catch {
          /* já parou */
        }
        void ctx.close?.().catch(() => undefined);
      },
    };
  } catch {
    void ctx.close?.().catch(() => undefined);
    return null;
  }
}
