import { tocarNaGravacao } from "./audio";

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

/**
 * O `mimeType` com áudio, para o `MediaRecorder` gravar a trilha junto.
 *
 * O formato guarda só o codec de vídeo (`video/webm;codecs=vp9`). Passar esse
 * texto com uma faixa de áudio na stream faz o navegador **ignorar** o áudio em
 * silêncio, então o codec de áudio precisa estar escrito aqui.
 */
export function mimeComAudio(format: VideoFormat): string {
  if (format.container === "mp4") return "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
  const video = format.codec.startsWith("vp09") ? "vp9" : "vp8";
  return `video/webm;codecs=${video},opus`;
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
  /**
   * A cadência da gravação, entregue no fim.
   *
   * Na gravação em tempo real é a única testemunha do que aconteceu: se a tela
   * engasgou, os intervalos entre quadros ficam desiguais e o vídeo trava —
   * mesmo com a velocidade média certa. O painel do fim mostra o número.
   */
  onCadencia?: (c: Cadencia) => void;
  /**
   * A trilha do vídeo (música + pops), do tamanho do vídeo. Ausente = mudo.
   *
   * Na gravação em tempo real o som entra como faixa da `MediaStream` — o
   * `MediaRecorder` grava o que chega nele, e um `MediaStreamAudioDestination`
   * entrega a trilha no mesmo relógio do canvas.
   */
  audio?: { canais: Float32Array[]; sampleRate: number };
  /** avisa se o arquivo saiu com som */
  onSom?: (comSom: boolean) => void;
};

export class CancelledError extends Error {
  constructor() {
    super("Gravação cancelada");
  }
}

/**
 * A **cadência** de uma gravação: com que regularidade os quadros foram
 * desenhados.
 *
 * É a medida que separa o vídeo que flui do que trava — e ela não depende da
 * rota nem do zoom, então vale comparar uma gravação com outra. Nos três mp4 do
 * usuário (mesma medição, janelas equivalentes):
 *
 * | arquivo | fps | quadros no intervalo típico |
 * |---|---|---|
 * | “Meia Maratona de Sorocaba” (o que ele achou fluido) | ~53 | **93%** |
 * | 18-27 (travava) | 30 | 78% |
 * | 12-16 | 24 | 46% |
 *
 * Ou seja: o que ele gostou não é um passo menor por quadro (os três andam ~7 px
 * por quadro) — é o **mesmo intervalo entre um quadro e outro**, mais vezes por
 * segundo. Quando a tela engasga, o quadro seguinte vem tarde; a cadência cai e
 * o olho lê como travada, mesmo que a velocidade média esteja certa.
 */
export type Cadencia = {
  /** intervalos entre quadros desenhados, em ms */
  intervalos: number[];
  /** o intervalo típico (mediana), em ms */
  tipico: number;
  /** fração dos quadros que caem dentro da tolerância do intervalo típico (0..1) */
  regular: number;
  /**
   * Quando um quadro sai do intervalo típico, **quanto** ele atrasa (mediana dos
   * desvios, em ms); zero se todos caem dentro.
   *
   * É o número que o olho sente. A porcentagem no intervalo diz *quantos* se
   * atrasaram; este diz *quanto* — e um atraso de 16 ms (um quadro inteiro a 60
   * por segundo) não parece o mesmo que 3 ms.
   */
  atraso: number;
};

/** A tolerância relativa do "mesmo intervalo": 5% (33 ms aceita 31,7 a 34,7). */
export const TOLERANCIA_CADENCIA = 0.05;

/**
 * O piso da tolerância, em ms.
 *
 * A 60 quadros por segundo o intervalo é de 16,7 ms, e 5% dele são **0,8 ms** —
 * menos que o tremor normal de um navegador (um quadro de 16,6 e outro de 17,5
 * já contariam como "fora do tempo"). Sem o piso, a mesma gravação era medida
 * com régua mais dura a 60 do que a 30, e a porcentagem não era comparável
 * entre os dois. Com 1 ms, a régua é a mesma nos dois casos.
 */
export const PISO_TOLERANCIA_MS = 1;

/**
 * Mede a cadência a partir dos **instantes** (em segundos) de cada quadro
 * desenhado.
 *
 * Função pura para poder ser medida no teste: os instantes vêm do mesmo relógio
 * do desenho, e é só isso que a conta precisa.
 */
export function medirCadencia(instantes: number[]): Cadencia {
  const validos = instantes.filter((t) => Number.isFinite(t));
  const dt: number[] = [];
  for (let i = 1; i < validos.length; i++) {
    const d = (validos[i] - validos[i - 1]) * 1000;
    if (d > 0) dt.push(d);
  }
  if (dt.length === 0) return { intervalos: [], tipico: 0, regular: 0, atraso: 0 };
  const ordenado = [...dt].sort((a, b) => a - b);
  const meio = ordenado.length >> 1;
  const tipico =
    ordenado.length % 2 === 1 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
  if (!(tipico > 0)) return { intervalos: dt, tipico: 0, regular: 0, atraso: 0 };
  const folga = Math.max(tipico * TOLERANCIA_CADENCIA, PISO_TOLERANCIA_MS);
  const desvios = dt.map((d) => Math.abs(d - tipico));
  const fora = desvios.filter((v) => v > folga);
  const dentro = dt.length - fora.length;
  /*
   * "Quando atrasa, atrasa quanto": a mediana dos desvios de quem saiu do
   * intervalo. Não é a média — um único engasgo de meio segundo não pode virar
   * a resposta para "o quanto costuma atrasar".
   */
  let atraso = 0;
  if (fora.length > 0) {
    const ordenados = [...fora].sort((a, b) => a - b);
    const m = ordenados.length >> 1;
    const mediana =
      ordenados.length % 2 === 1 ? ordenados[m] : (ordenados[m - 1] + ordenados[m]) / 2;
    // arredondado a 0,1 ms: ruído de ponto flutuante não é atraso
    atraso = Math.round(mediana * 10) / 10;
  }
  return { intervalos: dt, tipico, regular: dentro / dt.length, atraso };
}

/**
 * Taxa em que a **tela** desenha, medida com alguns quadros de `requestAnimationFrame`.
 *
 * É ela que decide se a gravação em tempo real sai com o tempo regular: o
 * `MediaRecorder` carimba cada quadro com o relógio do instante em que a tela o
 * entregou. Numa tela de 60 Hz, um pedido de 24 quadros por segundo é atendido
 * de 2 ou 3 quadros de tela em 2 ou 3 — os quadros do arquivo saem com 33 ms e
 * 50 ms **alternados**. O conteúdo anda o mesmo por unidade de tempo, então a
 * velocidade aparente oscila a cada quadro: é o *"o mapa fica pulando"*.
 *
 * Devolve 0 quando não dá para medir (sem `requestAnimationFrame`, aba
 * escondida, tudo travado).
 */
export async function medirTaxaDaTela(amostras = 24): Promise<number> {
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") return 0;
  const passos: number[] = [];
  await new Promise<void>((resolve) => {
    let anterior = 0;
    let n = 0;
    const tique = (agora: number) => {
      if (anterior > 0) passos.push(agora - anterior);
      anterior = agora;
      if (++n >= amostras) {
        resolve();
        return;
      }
      requestAnimationFrame(tique);
    };
    requestAnimationFrame(tique);
    // rede de segurança: aba escondida não entrega quadros
    setTimeout(resolve, 1000);
  });
  if (passos.length < 8) return 0;
  const ordenados = passos.slice().sort((a, b) => a - b);
  /*
   * O intervalo **curto** típico, e não a mediana: se a máquina engasgar no meio
   * da medição (o aquecimento do mapa está rodando junto), metade dos quadros
   * chega atrasada e a mediana diria "30 Hz" numa tela de 60 — e a gravação sairia
   * com metade da taxa pedida. O 5º menor intervalo de 24 é a taxa da tela.
   */
  const base = ordenados[Math.min(ordenados.length - 1, Math.max(2, Math.floor(ordenados.length * 0.2)))];
  if (!(base > 0)) return 0;
  return Math.round(1_000_000 / base) / 1000;
}

/**
 * Qual `fps` usar na gravação em tempo real para o arquivo sair com o **tempo
 * regular**.
 *
 * O `MediaRecorder` não inventa os instantes: ele carimba cada quadro com o
 * relógio do momento em que a tela o entregou. Então o arquivo só sai com
 * durações iguais quando o `fps` **divide** a taxa da tela — 30 numa tela de
 * 60 Hz, 20 numa de 60 Hz, 22,5 numa de 90 Hz. Pedir 24 numa tela de 60 Hz é o
 * pior caso: os quadros saem de 2 e 3 quadros de tela (33 ms e 50 ms
 * alternados) e o mapa anda aos pulos — foi o que o usuário cobrou
 * (*"o problema é o mapa ficar pulando"*) e o que o arquivo de exemplo dele
 * mostra: 1.441 quadros com as durações agrupadas em 999 e 1.500 (1/30.000 s).
 *
 * Vale a divisora da tela **mais próxima do pedido** (em proporção, para 20 e 30
 * ficarem à mesma distância de 24), nunca abaixo de 6 quadros por segundo e
 * nunca mais de 10% acima do pedido — subir a taxa num aparelho que já desenha
 * no limite troca um problema pelo outro. Sem medida confiável da tela, devolve
 * o pedido.
 */
export function fpsQueCasa(taxaDaTela: number, pedido: number): number {
  const desejado = Math.max(1, Math.round(pedido));
  if (!Number.isFinite(taxaDaTela) || taxaDaTela < 10) return desejado;
  const tela = taxaDaTela;
  /** o fps cabe na tela sem sobra de meia tela? */
  const casado = (f: number) => {
    const quadros = Math.round(tela / f);
    return quadros >= 1 && Math.abs(tela / quadros - f) <= 0.005 * f;
  };
  if (casado(desejado)) return desejado;
  let melhor = 0;
  let distancia = Infinity;
  for (let n = 1; n <= Math.floor(tela / 6); n++) {
    const f = tela / n;
    if (!casado(f)) continue;
    /*
     * Nunca muito acima do pedido: numa tela de 75 Hz, 60 pedidos cairiam em
     * 75 quadros por segundo (um quadro por quadro de tela) — não sobra folga
     * nenhuma para o desenho e o movimento engasga mais do que a taxa baixa.
     */
    if (f > desejado * 1.1) continue;
    const d = Math.abs(Math.log(f / desejado));
    /*
     * Empate fica com o **maior**: entre 20 e 30 quadros por segundo (que estão
     * à mesma distância de 24), o de cima é o mais macio.
     */
    if (d < distancia - 1e-9 || (Math.abs(d - distancia) <= 1e-9 && f > melhor)) {
      distancia = d;
      melhor = f;
    }
  }
  if (melhor <= 0) return Math.max(6, Math.min(desejado, Math.round(tela)));
  return Math.max(6, Math.round(melhor * 100) / 100);
}

/**
 * O teto de fps da gravação em **tempo real**.
 *
 * A 60 quadros por segundo cada quadro tem **16,7 ms** para desenhar o mapa
 * inteiro (blocos, rota, personagem, HUD) e entregá-lo ao gravador. Numa máquina
 * comum esse orçamento não fecha: medido no vídeo do usuário, a 60 fps só **63%**
 * dos quadros saíram no mesmo intervalo, e 1 em cada 3 chegou 8, 16 ou 25 ms
 * atrasado — exatamente o que ele viu como "travada". O mesmo desenho a 30 fps
 * tem 33 ms por quadro e sobra folga.
 *
 * Então o tempo real grava no máximo a 30; quem quer 60 usa a **exportação
 * rápida (⚡)**, que não espera o relógio — ela desenha cada quadro e escreve o
 * tempo exato, então o custo do desenho não vira atraso no arquivo.
 */
export const TEMPO_REAL_MAX_FPS = 30;

/**
 * O fps da gravação em tempo real: o pedido, limitado pelo que a tela
 * sustenta.
 *
 * Duas contas em série, e cada uma resolve um problema diferente:
 *
 * 1. o **teto de 30** (`TEMPO_REAL_MAX_FPS`): 60 não cabe no orçamento de um
 *    quadro e o que não cabe vira quadro atrasado — a causa medida da "travada";
 * 2. o **divisor da tela** (`fpsQueCasa`): pedir 24 numa tela de 60 Hz dá
 *    quadros de 33 e 50 ms alternados, mesmo quando o desenho cabe no tempo.
 */
export function fpsDoTempoReal(taxaDaTela: number, pedido: number, custoQuadroMs = 0): number {
  const pedidoValido = Number.isFinite(pedido) && pedido > 0 ? pedido : TEMPO_REAL_MAX_FPS;
  const topo = Math.min(pedidoValido, TEMPO_REAL_MAX_FPS);
  const candidato = fpsQueCasa(taxaDaTela, topo);
  return custoQuadroMs > 0 ? fpsQueCabeNoDesenho(taxaDaTela, candidato, custoQuadroMs) : candidato;
}

/** Quanto do intervalo de um quadro o desenho pode ocupar (o resto é a captura). */
export const FOLGA_DO_DESENHO = 0.6;

/** Os degraus de fps que o app aceita descer, do mais suave ao mais econômico. */
export const DEGRAUS_DE_FPS = [60, 50, 40, 30, 25, 20, 15, 12, 10];

/**
 * O fps mais alto em que **o desenho cabe** no intervalo de um quadro.
 *
 * O teto de 30 resolve metade do problema (16,7 ms por quadro é pouco numa
 * máquina comum); a outra metade é que nem 33 ms bastam em todo aparelho: no
 * vídeo do usuário, a 30 quadros por segundo, **1 em cada 3** quadros chegou
 * 12,2 ms atrasado. Em vez de insistir num ritmo que a tela não sustenta, o app
 * mede o custo de desenhar alguns quadros e desce até caber — com 60% do
 * intervalo como teto para o desenho (o resto é a captura e o codificador).
 *
 * Descer de 30 para 20 troca uma cadência irregular (68% no intervalo) por uma
 * regular — e regularidade é o que o olho lê como "fluido".
 */
export function fpsQueCabeNoDesenho(
  taxaDaTela: number,
  pedido: number,
  custoQuadroMs: number,
): number {
  const teto = Math.min(pedido, TEMPO_REAL_MAX_FPS);
  if (!(custoQuadroMs > 0)) return fpsQueCasa(taxaDaTela, teto);
  for (const degrau of DEGRAUS_DE_FPS) {
    if (degrau > teto) continue;
    const intervalo = 1000 / degrau;
    if (custoQuadroMs <= intervalo * FOLGA_DO_DESENHO) {
      return fpsQueCasa(taxaDaTela, degrau);
    }
  }
  return fpsQueCasa(taxaDaTela, 10);
}

/**
 * Em que **degrau** da grade do vídeo está o instante do relógio.
 *
 * Serve para decidir **quantas vezes por segundo desenhar** — não para decidir
 * *o que* desenhar. Quem diz o que desenhar é `tempoDoQuadro`, que usa o
 * relógio; ver a explicação lá.
 *
 * O resultado é preso às pontas: nunca antes do primeiro, nunca depois do
 * último.
 */
export function indiceDoQuadro(elapsed: number, fps: number, total: number): number {
  const ultimo = Math.max(0, total - 1);
  return Math.min(ultimo, Math.max(0, Math.floor(elapsed * fps)));
}

/**
 * O momento do vídeo (0..1) que um quadro desenhado no relógio representa.
 *
 * **É o relógio, e não a contagem de quadros.** O `MediaRecorder` carimba cada
 * quadro com o instante em que ele foi capturado — 33 ms, 20 ms, 46 ms, o que a
 * tela der —, e o conteúdo tem de andar no **mesmo** relógio. Desenhando por
 * índice (`i/fps`, como era), num monitor de 60 Hz com 30 quadros por segundo o
 * arquivo recebia quadros de 20 ms e de 46 ms carregando **o mesmo** passo de
 * mapa: a velocidade aparente oscilava até 1,7× de um quadro para o outro, 30
 * vezes por segundo — o "travadinha em todo o vídeo" que o usuário viu, e que
 * não aparece no voo de abertura só porque ali o passo é de fração de pixel.
 *
 * Está medido nos dois arquivos dele (passo do mapa nos quadros de intervalo
 * longo ÷ nos de intervalo curto):
 *
 * | arquivo | intervalos | longo | curto | razão |
 * |---|---|---|---|---|
 * | 12-16 (funcionava) | 33 e 50 ms | 11,11 px | 7,45 px | **1,49×** |
 * | 18-27 (travava) | 20 a 46 ms | 8,47 px | 8,37 px | **1,01×** |
 *
 * 1,5× é o certo: o tempo quase dobrou, então o deslocamento quase dobra. Com o
 * conteúdo saindo do relógio, um quadro perdido não muda a velocidade — ele só
 * carrega o pedaço maior que lhe cabe.
 */
export function tempoDoQuadro(elapsed: number, durationSec: number): number {
  const total = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  return Math.max(0, Math.min(1, t / total));
}

export async function recordVideo(opts: RecordOptions): Promise<Blob> {
  const { canvas, width, height, fps, durationSec, format, bitrate } = opts;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");

  // primeiro frame antes de iniciar a captura
  opts.draw(ctx, 0, 0);

  /*
   * Um quadro capturado por quadro desenhado.
   *
   * O caminho de sempre (`captureStream(fps)`) deixa o **navegador** escolher o
   * instante da captura: numa tela de 60 Hz com 24 quadros por segundo pedidos,
   * ele entrega 2 ou 3 quadros de tela por quadro — e o quadro entregue é o que
   * estiver na tela naquele instante, que não é o instante do desenho. O
   * resultado é o arquivo com o movimento aos pulos (foi o que o usuário viu:
   * *"o mapa fica pulando"*). Com `captureStream(0)` ninguém captura sozinho, e
   * `requestFrame()` marca a captura **no quadro que acabou de ser desenhado**.
   */
  let stream = canvas.captureStream(0);
  const trilha = stream.getVideoTracks()[0] as
    | (CanvasCaptureMediaStreamTrack & { requestFrame?: () => void })
    | undefined;
  const porQuadro = typeof trilha?.requestFrame === "function";
  if (!porQuadro) {
    // navegador sem `requestFrame`: volta ao ritmo da tela, limitado pelo `fps`
    for (const t of stream.getTracks()) t.stop();
    stream = canvas.captureStream(fps);
  }
  /*
   * O som entra depois de a stream de vídeo estar decidida: no caminho sem
   * `requestFrame` a stream é trocada por `captureStream(fps)`, e uma faixa
   * presa na stream antiga seria descartada.
   */
  const som = opts.audio ? tocarNaGravacao(opts.audio.canais, opts.audio.sampleRate) : null;
  let mime = format.mime;
  if (som?.track) {
    const comAudio = mimeComAudio(format);
    let cabe = false;
    try {
      cabe = MediaRecorder.isTypeSupported(comAudio);
    } catch {
      cabe = false;
    }
    if (cabe) {
      mime = comAudio;
      stream.addTrack(som.track);
    } else {
      try {
        som.track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  const chunks: BlobPart[] = [];
  let comSom = stream.getAudioTracks().length > 0;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  } catch (err) {
    /*
     * O tipo com áudio pode ser recusado na hora de montar o gravador (o
     * `isTypeSupported` responde pelo navegador, não pela combinação com a
     * stream). Nesse caso o vídeo sai mudo — não deixa de sair.
     */
    if (mime === format.mime) throw err;
    stream.getAudioTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    mime = format.mime;
    comSom = false;
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  }
  opts.onSom?.(comSom);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  /*
   * O primeiro quadro já está desenhado desde antes de a captura existir: com
   * `requestFrame()` quem manda é o desenho, então ele precisa ser pedido uma
   * vez à mão para o arquivo não começar no quadro 1.
   */
  trilha?.requestFrame?.();
  recorder.start(200);
  // a trilha começa junto com a gravação: é o relógio real que carimba os dois
  if (comSom) som?.start();
  const startedAt = performance.now();

  /*
   * `total` é o número de degraus da grade, e é ele que decide **quantas vezes
   * por segundo** desenhar (e capturar). O conteúdo de cada quadro, porém, sai
   * do **relógio** (`tempoDoQuadro`): é o mesmo relógio em que o `MediaRecorder`
   * carimba os quadros do arquivo. Antes o conteúdo saía do índice do degrau, e
   * aí um quadro de 46 ms carregava o mesmo passo de mapa que um de 20 ms — a
   * velocidade aparente oscilava e o vídeo "travava" em todo o percurso.
   */
  const total = Math.max(1, Math.round(fps * durationSec));
  let desenhado = 0;
  /** os instantes de cada quadro desenhado — a cadência sai daqui (ver `medirCadencia`) */
  const instantes: number[] = [0];

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
      if (i !== desenhado) {
        desenhado = i;
        /*
         * O momento do conteúdo vem do relógio (é o que o arquivo vai carimbar);
         * o segundo argumento do `draw` é esse mesmo instante, para quem
         * desenha saber há quanto tempo o vídeo começou.
         */
        const t = tempoDoQuadro(elapsed, durationSec);
        instantes.push(elapsed);
        try {
          opts.draw(ctx, t, elapsed);
          trilha?.requestFrame?.();
        } catch (err) {
          cancelAnimationFrame(raf);
          reject(err instanceof Error ? err : new Error("Falha ao renderizar frame"));
          return;
        }
        opts.onProgress?.(t);
      }
      if (desenhado >= total - 1 || elapsed >= durationSec) {
        /*
         * Fecha no quadro final (a cartela) mesmo que o navegador tenha
         * engasgado no último degrau: o fim do vídeo não pode ficar no meio do
         * percurso.
         */
        if (desenhado < total - 1) {
          desenhado = total - 1;
          const t = tempoDoQuadro(Math.max(elapsed, durationSec), durationSec);
          try {
            opts.draw(ctx, t, durationSec);
            trilha?.requestFrame?.();
          } catch (err) {
            cancelAnimationFrame(raf);
            reject(err instanceof Error ? err : new Error("Falha ao renderizar frame"));
            return;
          }
          opts.onProgress?.(t);
        }
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
      // sem isto, o contexto de áudio fica aberto depois de uma gravação cancelada
      som?.stop();
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
  som?.stop();
  stream.getTracks().forEach((tr) => tr.stop());

  opts.onCadencia?.(medirCadencia(instantes));

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
