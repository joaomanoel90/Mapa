/**
 * Orçamento de blocos de mapa: quantos a rota precisa, e qual zoom cabe.
 *
 * O problema que este arquivo resolve tem número: a câmera "Seguir" no zoom 16
 * mostra ~2,4 km de largura, então o app precisa de um bloco a cada ~1,4 km de
 * rota. Medido, com o teto de 1.400 blocos:
 *
 * | rota (seguir, zoom 16) | blocos |
 * |---|---|
 * | 50 km | 924 |
 * | 75 km | 1.349 |
 * | 80 km | 1.439 — recusa |
 * | 200 km | 3.473 — recusa |
 * | 435 km | 7.237 — recusa |
 *
 * Ou seja: **toda rota acima de ~80 km era recusada** na exportação, com uma
 * mensagem que dizia "diminua a aproximação" sem dizer até onde. Numa rota
 * interestadual, o zoom que cabe é 13,5 — e ninguém adivinha isso arrastando um
 * controle.
 *
 * Aqui a conta é local (não usa rede): a mesma função que conta os blocos é
 * usada para procurar o maior zoom que cabe, em passos de 0,5 (os mesmos do
 * controle do painel).
 */

import type { Track } from "./geo";
import type { BasemapId } from "./tiles";
import {
  TILE_BUDGET,
  tilesForAnimation,
  type CameraConfig,
  type CameraMode,
} from "./renderer";
import type { CinematicConfig } from "./camera";

/** Menor zoom que o painel oferece — abaixo disso a rota viraria um pontinho. */
export const MIN_FOLLOW_ZOOM = 11;

export type BudgetInput = {
  track: Track;
  width: number;
  height: number;
  basemap: BasemapId;
  maxZoom: number;
  cinematic?: CinematicConfig | null;
};

/** Blocos que a câmera escolhida vai precisar. */
export function tilesNeeded(
  input: BudgetInput & { camera: CameraConfig },
): number {
  const { camera, ...resto } = input;
  return tilesForAnimation(
    resto.track,
    camera,
    resto.width,
    resto.height,
    resto.basemap,
    resto.cinematic,
  ).length;
}

/**
 * Maior zoom de acompanhamento que ainda cabe no teto.
 *
 * Busca binária na lista de zooms que o controle oferece (de 0,5 em 0,5, do
 * teto do mapa para baixo): a contagem cresce quando o zoom cresce, então dá
 * para descartar metade da lista a cada medição em vez de testar todos. Cada
 * medição percorre a rota inteira, e o painel mostra o número enquanto o
 * usuário arrasta o controle.
 *
 * Devolve `null` quando nem o zoom mínimo cabe — aí só a câmera "Rota toda"
 * resolve, e é isso que a tela diz.
 */
export function maxFollowZoom(
  input: BudgetInput & { budget?: number; minFollowZoom?: number },
): number | null {
  const budget = input.budget ?? TILE_BUDGET;
  const min = input.minFollowZoom ?? MIN_FOLLOW_ZOOM;

  // lista de zooms oferecidos, do maior para o menor
  const opcoes: number[] = [];
  for (let z = input.maxZoom; z >= min; z -= 0.5) {
    opcoes.push(Math.round(z * 2) / 2);
  }
  if (opcoes.length === 0) return null;

  const cabe = (zoom: number) =>
    tilesNeeded({
      ...input,
      camera: { mode: "follow", followZoom: zoom },
    }) <= budget;

  if (cabe(opcoes[0])) return opcoes[0];

  let lo = 0;
  let hi = opcoes.length - 1;
  let melhor: number | null = null;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (cabe(opcoes[meio])) {
      melhor = opcoes[meio];
      hi = meio - 1;
    } else {
      lo = meio + 1;
    }
  }
  return melhor;
}

/** Teto de blocos, reexportado para a tela não precisar saber do renderizador. */
export { TILE_BUDGET };

/** Texto do aviso de rota longa — o mesmo no painel e no erro da exportação. */
export function budgetAdvice(
  needed: number,
  suggestion: number | null,
  mode: CameraMode,
): string {
  if (mode !== "follow") {
    return `Esta rota precisaria de ${needed} blocos de mapa — demais para os servidores gratuitos.`;
  }
  if (suggestion === null) {
    return (
      `Esta rota precisaria de ${needed} blocos de mapa — demais para os servidores ` +
      `gratuitos, mesmo no zoom mínimo. Use a câmera “Rota toda”.`
    );
  }
  return (
    `Esta rota precisaria de ${needed} blocos de mapa — demais para os servidores ` +
    `gratuitos. Com a câmera “Seguir”, o zoom ${suggestion} cabe.`
  );
}
