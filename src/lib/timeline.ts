/**
 * O relógio do vídeo, separado do relógio do percurso.
 *
 * Antes havia um só: `t` era ao mesmo tempo "quanto do vídeo passou" e "quanto
 * do percurso foi feito". Isso produzia dois efeitos indesejados, os dois vistos
 * pelo usuário no vídeo exportado:
 *
 * - o personagem **corria durante o voo de abertura** — num vídeo de 20 s ele já
 *   tinha andado 13% do trajeto antes de a câmera pousar (o pedido é literal:
 *   "fazer o voo panorâmico até o ponto inicial, aí começa a correr");
 * - a **cartela final** entrava em 79% do percurso e cobria o fim do trajeto
 *   ("cartela aparecendo muito antes, terminar percurso e depois aparecer").
 *
 * Aqui o vídeo tem três janelas em sequência: **voo → percurso → cartela**. O
 * personagem espera na partida enquanto a câmera sobrevoa, o percurso acontece
 * inteiro no meio, e a cartela só aparece depois que o percurso termina.
 *
 * O que era `t` no renderizador continua sendo o **progresso do percurso**
 * (0..1); quem converte é `routeProgress`. Assim todo o resto — paradas,
 * passagens, HUD, barra de progresso — segue medido em percurso, e só as
 * janelas de vídeo (fotos, cartela, abertura) falam em segundos de vídeo.
 */

import { openingSeconds } from "./camera";

/** Quanto a cartela final fica na tela, em segundos de vídeo. */
export const CARTA_SECONDS = 4.2;

export type Timeline = {
  /** voo de abertura: segundos de vídeo com a câmera sobrevoando (0 = sem voo) */
  voo: number;
  /** segundos de vídeo em que a rota é percorrida */
  percurso: number;
  /** segundos de vídeo da cartela final (0 = sem cartela) */
  cartela: number;
};

/**
 * As três janelas para um vídeo de `duration` segundos.
 *
 * O percurso é o dono da maior parte do vídeo: em clipe curto, voo e cartela
 * **encolhem juntos** (na proporção um do outro) em vez de comer o percurso.
 */
export function buildTimeline(
  duration: number,
  opts: { voo: boolean; cartela: boolean },
): Timeline {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 10;
  let voo = opts.voo ? openingSeconds(d) : 0;
  let cartela = opts.cartela ? CARTA_SECONDS : 0;
  const limite = d * 0.6; // o percurso fica com pelo menos 40% do vídeo
  if (voo + cartela > limite) {
    const k = limite / (voo + cartela);
    voo *= k;
    cartela *= k;
  }
  return { voo, percurso: Math.max(0, d - voo - cartela), cartela };
}

/** Em que instante (segundos de vídeo) o percurso termina. */
export function routeEnd(tl: Timeline): number {
  return tl.voo + tl.percurso;
}

/** Progresso do percurso (0..1) no instante `elapsed` do vídeo. */
export function routeProgress(tl: Timeline, elapsed: number): number {
  if (!(tl.percurso > 0)) return 1;
  const x = (elapsed - tl.voo) / tl.percurso;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * O relógio que vale para este quadro.
 *
 * Sem `timeline` (chamadas antigas, testes de unidade), o vídeo inteiro é
 * percurso e a cartela reserva a sua fatia no fim — que é exatamente o
 * comportamento de antes.
 */
export function timelineOr(
  tl: Timeline | null | undefined,
  duration: number,
): Timeline {
  return tl ?? buildTimeline(duration, { voo: false, cartela: true });
}
