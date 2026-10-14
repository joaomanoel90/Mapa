/**
 * Câmera cinematográfica: abertura sobrevoando a região e aproximação nas
 * paradas.
 *
 * O alvo da câmera morava dentro do `render`, misturado com a suavização — e
 * assim não tinha como ser testado. Aqui ele é uma **função pura**: recebe o
 * tempo, o traçado e as opções, devolve para onde a câmera quer ir. O `render`
 * cuida só de suavizar o caminho até lá.
 *
 * As duas partes são independentes:
 *
 * - **abertura**: o vídeo começa com a região inteira na tela (o mesmo
 *   enquadramento do "Rota toda") e "pousa" na rota em ~2 s. As duas pontas da
 *   animação já existem no app; aqui elas só são misturadas.
 * - **paradas**: perto de uma parada a câmera chega mais perto, e volta ao
 *   normal depois de passar. É um zoom, não um desvio: o personagem continua no
 *   centro da tela.
 *
 * Só faz sentido no modo "Seguir" — no "Rota toda" a rota já está inteira na
 * tela e não há para onde "pousar".
 */

import { boundsOf, fitZoom, sampleTrack, type Track } from "./geo";

export type CinematicConfig = {
  /** abertura sobrevoando a região antes de pousar na rota */
  opening: boolean;
  /** aproxima a câmera nas paradas */
  stops: boolean;
  /** posições (0..1) das paradas ao longo do traçado */
  stopTs: number[];
};

export type CameraTarget = {
  lat: number;
  lng: number;
  zoom: number;
  /** 0 = sobrevoando a região, 1 = já pousou na rota */
  opening: number;
  /** 0 = sem aproximação, 1 = em cima da parada */
  boost: number;
};

/** Teto da abertura: além disso a região na tela vira espera. */
export const OPEN_CAP_S = 2.6;

/** Quanto do vídeo a abertura pode ocupar (o resto é a rota). */
export const OPEN_SHARE = 0.25;

/** Quantos níveis de zoom a mais em cima de uma parada. */
export const STOP_BOOST = 1.4;

/** Duração da abertura para um vídeo de `duration` segundos. */
export function openingSeconds(duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 10;
  return Math.max(0.4, Math.min(OPEN_CAP_S, d * OPEN_SHARE));
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Andamento da abertura, de 0 a 1.
 *
 * A entrada e a saída são suaves de propósito: começar devagar dá tempo de ler
 * a região, e terminar devagar é o que faz parecer um pouso, e não um corte.
 */
export function openingProgress(elapsed: number, duration: number): number {
  const total = openingSeconds(duration);
  const x = Math.max(0, Math.min(1, elapsed / total));
  return easeInOutCubic(x);
}

/**
 * Meia-janela (em fração do **percurso**) em que a parada puxa a câmera.
 *
 * ~1,6 s de percurso de cada lado: acompanha a janela da foto (2,6 s de vídeo) e
 * é o tempo que a câmera leva para **chegar** na parada. Com uma janela curta
 * ela só começava a se mexer nos últimos quadros, e a parada continuava saindo
 * pela borda no 9:16.
 */
export function stopSpan(duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 10;
  return Math.max(0.03, Math.min(0.12, 1.6 / d));
}

/**
 * Aproximação por causa de uma parada, de 0 a 1.
 *
 * Vale a parada mais próxima; duas paradas vizinhas não somam (a segunda não
 * teria como ser "mais perto" que a outra).
 */
export function stopBoost(t: number, stopTs: number[], duration: number): number {
  return stopFocus(t, stopTs, duration).forca;
}

/**
 * A parada que a câmera está focando neste instante — e com que força.
 *
 * Devolve o **instante da passagem** e não só a intensidade porque a câmera
 * precisa saber para onde ir: no quadro estreito (9:16) a parada ficava fora da
 * tela, e a única forma de mostrá-la inteira (foto e nome) é levar a **parada**
 * ao centro em vez de manter o personagem no centro.
 */
export function stopFocus(
  t: number,
  stopTs: number[],
  duration: number,
): { forca: number; ts: number | null } {
  if (stopTs.length === 0) return { forca: 0, ts: null };
  const span = stopSpan(duration);
  let maior = 0;
  let escolhida: number | null = null;
  for (const ts of stopTs) {
    if (!Number.isFinite(ts)) continue;
    const d = Math.abs(t - ts);
    if (d >= span) continue;
    const x = 1 - d / span;
    const suave = x * x * (3 - 2 * x);
    if (suave > maior) {
      maior = suave;
      escolhida = ts;
    }
  }
  return { forca: maior, ts: escolhida };
}

/**
 * Para onde a câmera quer ir neste instante.
 *
 * No modo "Rota toda" nada muda: o enquadramento é o do traçado inteiro e as
 * opções cinematográficas ficam inertes (é o que o painel avisa).
 */
export function cameraTarget(input: {
  track: Track;
  t: number;
  camera: { mode: "fit" | "follow"; followZoom: number; cinematic?: CinematicConfig };
  width: number;
  height: number;
  maxZoom: number;
  elapsed: number;
  duration: number;
  /**
   * Segundos de vídeo do **percurso** (sem o voo e sem a cartela).
   *
   * A janela do foco é medida em fração do percurso — e não do vídeo — para
   * valer o mesmo em qualquer duração de vídeo. Sem ele, vale `duration`.
   */
  routeSeconds?: number;
  /** Onde fica a parada (a câmera vai até ela). Sem isto, não há deslocamento. */
  stopPos?: (ts: number) => { lat: number; lng: number } | null;
}): CameraTarget {
  const { track, t, camera, width, height, maxZoom, elapsed, duration } = input;
  const b = boundsOf(track.pts);
  const centro = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
  const fitZ = Math.min(fitZoom(b, width, height, 0.16), maxZoom);

  if (camera.mode !== "follow") {
    return { lat: centro.lat, lng: centro.lng, zoom: fitZ, opening: 1, boost: 0 };
  }

  const pos = sampleTrack(track, t).pos;
  const cine = camera.cinematic;
  const abertura = cine?.opening ? openingProgress(elapsed, duration) : 1;

  /*
   * Ênfase na parada: a câmera anda **até a parada** e chega mais perto.
   *
   * Antes o personagem ficava sempre no centro e a parada podia sair pela borda
   * — no 9:16, onde o quadro é estreito, era o que acontecia. Levar a parada ao
   * centro é o que garante que ela, a foto e o nome apareçam inteiros.
   */
  const rotaSec = input.routeSeconds && input.routeSeconds > 0 ? input.routeSeconds : duration;
  const foco = cine?.stops ? stopFocus(t, cine.stopTs, rotaSec) : { forca: 0, ts: null };
  const ponto = foco.ts !== null ? input.stopPos?.(foco.ts) ?? null : null;
  const alvo = Math.min(camera.followZoom + foco.forca * STOP_BOOST, maxZoom);
  const focoLat = ponto ? pos.lat + (ponto.lat - pos.lat) * foco.forca : pos.lat;
  const focoLng = ponto ? pos.lng + (ponto.lng - pos.lng) * foco.forca : pos.lng;

  return {
    lat: centro.lat + (focoLat - centro.lat) * abertura,
    lng: centro.lng + (focoLng - centro.lng) * abertura,
    zoom: fitZ + (alvo - fitZ) * abertura,
    opening: abertura,
    boost: foco.forca,
  };
}
