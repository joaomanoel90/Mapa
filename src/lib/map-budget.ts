/**
 * Orçamento do mapa: quantas imagens a rota pede, e qual zoom cabe.
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
import { hillshadeBloco, relevoDoMapa, type BasemapId } from "./tiles";
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
  /**
   * O sombreado do relevo está ligado?
   *
   * Ele custa pedidos extras — mas **não o dobro**, e é essa diferença que
   * mantém o zoom escolhido. Acima do zoom 16 o relevo não tem bloco próprio:
   * quatro blocos do 18 compartilham **um** do 16 (ver `hillshadeBloco`), então
   * a conta certa é a de **URLs únicas**, não a de blocos × 2.
   */
  relevo?: boolean;
};

/** Os blocos de mapa que a animação inteira desenha. */
function refsDaAnimacao(input: BudgetInput & { camera: CameraConfig }) {
  return tilesForAnimation(
    input.track,
    input.camera,
    input.width,
    input.height,
    input.basemap,
    input.cinematic,
    input.foco,
  );
}

export type Pedidos = {
  /** blocos do mapa */
  mapa: number;
  /** blocos do sombreado (cada um contado uma vez: um do z16 serve a quatro do z18) */
  relevo: number;
  /** os dois servidores juntos — informativo, não é o que decide */
  total: number;
};

/**
 * Quantas **imagens** a animação pede, separando mapa e relevo.
 *
 * O relevo tem servidor próprio (Esri Hillshade), e é por isso que ele **não
 * entra no mesmo teto** do mapa: cada servidor responde pelo seu. Somar os dois
 * contra 1.400 foi o erro da segunda versão — abaixo do zoom 16 cada bloco do
 * mapa pede a sua própria sombra (1:1), então baixar o zoom quase não diminuía a
 * soma, e uma rota de 16 km no zoom 17 (1.381 blocos de mapa, dentro do teto)
 * despencava para o **12** só para caber a soma.
 *
 * As sombras também se repetem acima do zoom 16: quatro blocos do 18 dividem
 * **uma** do 16 (ver `hillshadeBloco`), então a contagem é de URLs únicas.
 */
export function pedidosDaAnimacao(
  refs: { url: string; z: number; x: number; y: number }[],
  basemap: BasemapId,
  relevo: boolean,
): Pedidos {
  const mapa = refs.length;
  if (!relevo || !relevoDoMapa(basemap)) return { mapa, relevo: 0, total: mapa };
  const urls = new Set<string>();
  for (const r of refs) urls.add(hillshadeBloco(r.z, r.x, r.y).url);
  return { mapa, relevo: urls.size, total: mapa + urls.size };
}

/** Os pedidos da câmera escolhida (mapa + sombreado). */
export function pedidosNecessarios(input: BudgetInput & { camera: CameraConfig }): Pedidos {
  return pedidosDaAnimacao(refsDaAnimacao(input), input.basemap, !!input.relevo);
}

/**
 * Quanta folga o teto aceita antes de derrubar o zoom.
 *
 * O 1.400 é uma proteção redonda, medida numa vista de cima. A terceira pessoa
 * com giro e inclinação cobre mais chão — o quadro girado busca os cantos, e a
 * inclinação comprime a vertical —, então a mesma rota pede alguns por cento a
 * mais **no mesmo zoom**. Numa rota de 16 km no 17 a diferença medida foi de
 * 1.381 (vista de cima) para 1.490 (terceira pessoa com giro e inclinação):
 * 8%. Derrubar o zoom por causa disso é justamente o "o zoom não fixa" que o
 * usuário relatou — a folga de 10% absorve a variação e mantém a escolha.
 */
export const FOLGA_DO_TETO = 1.1;

/** O teto efetivo de cada servidor, já com a folga. */
export function limiteDoServidor(budget = TILE_BUDGET): number {
  return Math.round(budget * FOLGA_DO_TETO);
}

/**
 * Cabe no teto dos servidores gratuitos?
 *
 * **Um teto por servidor**: o mapa e o sombreado do relevo são hosts
 * diferentes, e o número que protege cada um é o mesmo 1.400 (com a folga
 * acima). O que não pode acontecer é o relevo empurrar o mapa para fora do
 * teto dele — era isso que fazia a rota curta perder o zoom.
 */
export function cabeNoTeto(pedidos: Pedidos, budget = TILE_BUDGET): boolean {
  const limite = limiteDoServidor(budget);
  return pedidos.mapa <= limite && pedidos.relevo <= limite;
}

/** Blocos **do mapa** que a câmera escolhida vai precisar. */
export function tilesNeeded(input: BudgetInput & { camera: CameraConfig }): number {
  return refsDaAnimacao(input).length;
}

/**
 * Maior zoom de acompanhamento (até o pedido) que ainda cabe no teto.
 *
 * Não é uma busca binária, e o motivo é medido: o "cabe" **não** é monotônico
 * no zoom. Logo abaixo do 16 a sombra do relevo passa a ser 1:1 e a conta
 * sobe; as paradas dão picos em níveis fixos. Numa rota de 16 km, a binária
 * devolvia **16** quando o **17** cabia — o usuário pedia um zoom e recebia
 * dois degraus abaixo. Então o caminho é: desce degrau a degrau a partir do
 * zoom pedido (a correção de verdade costuma estar a 1–2 níveis), e só se
 * precisar descer muitos níveis é que usa a binária para o resto.
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

  /*
   * A lista começa no zoom **pedido** (nunca acima dele): a sugestão existe
   * para dizer até onde descer, e não para subir a câmera de quem já escolheu.
   */
  const topo = Math.min(input.maxZoom, input.camera?.followZoom ?? input.maxZoom);
  const opcoes: number[] = [];
  for (let z = topo; z >= min; z -= 0.5) {
    opcoes.push(Math.round(z * 2) / 2);
  }
  if (opcoes.length === 0) return null;

  const cabe = (zoom: number) =>
    cabeNoTeto(
      pedidosNecessarios({
        ...input,
        // a busca mexe só no zoom: o resto da câmera (a terceira pessoa, o giro)
        // continua o que o painel mandou — senão a sugestão valeria para outra
        // câmera e o vídeo estouraria o teto
        camera: { ...(input.camera ?? {}), mode: "follow", followZoom: zoom },
      }),
      budget,
    );

  /** degraus que valem a pena testar um a um antes de partir para a binária */
  const PASSOS = 10;

  for (let i = 0; i < opcoes.length && i < PASSOS; i++) {
    if (cabe(opcoes[i])) return opcoes[i];
  }
  if (opcoes.length <= PASSOS) return null;

  let lo = PASSOS;
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
): {
  camera: CameraConfig;
  /** blocos do mapa (sem o relevo) */
  blocos: number;
  /** mapa + relevo, que é o que o teto conta */
  pedidos: Pedidos;
  reduzido: boolean;
  zoom: number | null;
} {
  const budget = input.budget ?? TILE_BUDGET;
  const pedidos = pedidosNecessarios(input);
  const base = { blocos: pedidos.mapa, pedidos };
  if (cabeNoTeto(pedidos, budget)) {
    return { ...base, camera: input.camera, reduzido: false, zoom: null };
  }
  if (input.camera.mode !== "follow") {
    return { ...base, camera: input.camera, reduzido: false, zoom: null };
  }

  const zoom = maxFollowZoom({ ...input, budget });
  if (zoom !== null) {
    return { ...base, camera: { ...input.camera, followZoom: zoom }, reduzido: true, zoom };
  }
  // último recurso: um enquadramento só, do traçado inteiro
  return { ...base, camera: { ...input.camera, mode: "fit" }, reduzido: true, zoom: null };
}

/** Teto de imagens, reexportado para a tela não precisar saber do renderizador. */
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
