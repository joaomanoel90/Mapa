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
import type { CinematicConfig, FocusPoint } from "./camera";

/**
 * Menor zoom de acompanhamento que o app aceita — abaixo disso a rota viraria
 * um pontinho.
 *
 * Era 11, e isso é zoom de **cidade**: num percurso intercontinental (milhares
 * de km) nem o 11 cabe no teto, e a exportação era recusada de vez — o usuário
 * só podia usar a câmera "Rota toda". Num mapa, 3 é escala de continente (um
 * bloco cobre ~5.000 km), e é o que faz o "Seguir" valer também para uma
 * travessia: o personagem continua sendo o centro do quadro, com o continente
 * inteiro passando por trás.
 */
export const MIN_FOLLOW_ZOOM = 3;

export type BudgetInput = {
  track: Track;
  width: number;
  height: number;
  basemap: BasemapId;
  maxZoom: number;
  cinematic?: CinematicConfig | null;
  /**
   * Onde fica o ponto de cada parada (o lugar, que pode estar fora da linha).
   * Sem ela a conta pede os blocos da **rota** e o vídeo sai borrado na parada
   * — a mesma função que o desenho usa tem de entrar aqui.
   */
  foco?: FocusPoint | null;
};

/**
 * O teto de blocos **com o relevo ligado**.
 *
 * Com o sombreado, cada bloco do mapa custa **duas** requisições (o mapa e a
 * sombra do mesmo pedaço), então o teto cai pela metade. Sem isso, uma rota que
 * cabia nos 1.400 blocos passaria a pedir 2.800 imagens — o dobro do que os
 * servidores gratuitos aguentam numa gravação, e a exportação sairia com
 * buracos.
 *
 * Metade é a conta certa, não um arredondamento: o número que importa é o de
 * **requisições**, e ele continua sendo 1.400.
 */
export function budgetDeBlocos(relevo: boolean, base = TILE_BUDGET): number {
  return relevo ? Math.floor(base / 2) : base;
}

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
    resto.foco,
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
  input: BudgetInput & {
    /** a câmera do painel: a terceira pessoa (e o giro) mudam a conta */
    camera?: CameraConfig;
    budget?: number;
    minFollowZoom?: number;
  },
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
      // a busca mexe só no zoom: o resto da câmera (a terceira pessoa, o giro)
      // continua o que o painel mandou — senão a sugestão valeria para outra
      // câmera e o vídeo estouraria o teto
      camera: { ...(input.camera ?? {}), mode: "follow", followZoom: zoom },
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

/**
 * A câmera com que o vídeo **vai realmente sair**, cabendo no teto de blocos.
 *
 * Antes, quando a conta estourava, a exportação era recusada com um texto — e
 * numa rota intercontinental o texto mandava trocar para "Rota toda" mesmo com
 * a câmera "Seguir" perfeitamente possível num zoom de continente. Aqui a
 * escolha é resolvida antes de gravar:
 *
 * 1. cabe como está? devolve a câmera do painel, sem mexer em nada;
 * 2. não cabe no "Seguir"? desce o zoom até o maior que cabe (`maxFollowZoom`,
 *    agora com piso em escala de continente);
 * 3. nem assim? cai para a câmera "Rota toda", que é um enquadramento só.
 *
 * `reduzido` diz se houve mudança, para a janela de gravação poder explicar —
 * mexer na câmera do usuário sem avisar seria pior que recusar.
 */
export function planejarCamera(
  input: BudgetInput & { camera: CameraConfig; budget?: number },
): { camera: CameraConfig; blocos: number; reduzido: boolean; zoom: number | null } {
  const budget = input.budget ?? TILE_BUDGET;
  const blocos = tilesNeeded(input);
  if (blocos <= budget) return { camera: input.camera, blocos, reduzido: false, zoom: null };
  if (input.camera.mode !== "follow") return { camera: input.camera, blocos, reduzido: false, zoom: null };

  const zoom = maxFollowZoom({ ...input, budget });
  if (zoom !== null) {
    return { camera: { ...input.camera, followZoom: zoom }, blocos, reduzido: true, zoom };
  }
  // último recurso: um enquadramento só, do traçado inteiro
  return { camera: { ...input.camera, mode: "fit" }, blocos, reduzido: true, zoom: null };
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
