/**
 * A desaceleração nos pontos do percurso.
 *
 * O pedido: "quando ele passar por pontos, dar uma desacelerada e focar no
 * ponto". A câmera já focava (o `stopBoost` aproxima o zoom em cima da parada),
 * mas a parada passava rápido demais para o foco ser visto — a personagem
 * atravessava o ponto em um ou dois quadros.
 *
 * Aqui o relógio do percurso é **esticado perto de cada ponto**: a posição que o
 * vídeo desenha não é mais o progresso linear do relógio, e sim uma função dele
 * que anda devagar nas paradas e um pouco mais depressa entre elas. Nada mais
 * precisa saber disso — como a posição visual é o único "onde" do desenho, tudo
 * o que deriva dela (o personagem, a rota percorrida, o anel do progresso, as
 * passagens, e o próprio foco da câmera, que compara a posição com o instante da
 * parada) acompanha junto.
 *
 * Três decisões que valem explicação:
 *
 * 1. **O vídeo não fica mais longo.** O tempo da desaceleração sai do próprio
 *    percurso: o que se gasta a mais nos pontos é compensado por um caminhar um
 *    pouco mais rápido entre eles. A duração que a pessoa escolheu continua
 *    sendo a duração do vídeo — e a rota inteira continua sendo percorrida.
 * 2. **O "cinematográfico" é a curva, não a duração.** A força é dada pela
 *    densidade de tempo no ponto (`1 + DESACELERA_FORCA`): no centro do ponto a
 *    personagem anda 4x mais devagar do que anda fora dele. O que limita o
 *    exagero é o teto (`DESACELERA_TETO`): com muitos pontos, as janelas
 *    encolhem em vez de o vídeo virar um trecho frenético entre paradas.
 * 3. **Tudo é analítico, nada é tabela.** A curva é uma soma de "cossenos"
 *    (`bump`), cuja integral tem forma fechada; então a posição é o inverso de
 *    uma função crescente, achado por bisseção. Não há grade amostrada, e por
 *    isso as contas são exatas: `posicao(0) = 0`, `posicao(1) = 1`, e a curva
 *    nunca anda para trás.
 */

/** Quanto mais devagar no centro de um ponto (densidade = 1 + isto). */
export const DESACELERA_FORCA = 3;

/**
 * Meia-janela da desaceleração, em segundos de percurso.
 *
 * Casa com a janela do foco da câmera (`stopSpan`, ~1,6 s): o zoom começa a
 * entrar junto com a freada, e não depois dela.
 */
export const DESACELERA_JANELA_S = 1.6;

/**
 * Fatia máxima do percurso que pode ser gasta dentro dos pontos.
 *
 * Com a força acima, metade do percurso dentro dos pontos significa andar 2x
 * mais depressa entre eles — é o limite do que ainda parece um trajeto e não
 * uma perseguição.
 */
export const DESACELERA_TETO = 0.5;

/** A posição visual (0..1) e a curva por trás dela. */
export type Pacing = {
  /** posição visual da rota para um progresso linear `t` (0..1) */
  posicao: (t: number) => number;
  /**
   * Em que instante do percurso (0..1) a posição `x` é alcançada.
   *
   * É o inverso da `posicao`, e o que liga a desaceleração ao foco da câmera: o
   * foco de uma parada (`stopFocus`) olha a **posição**, então ele chega ao
   * máximo exatamente em `tempoDe(ts)` — e dura, em segundos de vídeo, o quanto
   * a desaceleração o segura ali.
   */
  tempoDe: (x: number) => number;
  /** densidade de tempo na posição `x` (1 = ritmo normal; maior = mais devagar) */
  densidade: (x: number) => number;
  /** velocidade relativa na posição `x` (média 1; menor = mais devagar) */
  velocidade: (x: number) => number;
  /** meia-janela usada, em fração da rota (0 = sem desaceleração) */
  janela: number;
  /**
   * O ritmo médio do percurso: `∫ densidade dx`.
   *
   * 1 = o relógio passa direto; 2 = entre os pontos a personagem anda duas vezes
   * mais depressa do que andaria sem a freada (é o preço de gastar tempo nos
   * pontos sem alongar o vídeo).
   */
  fator: number;
  /** quantos pontos distintos entraram */
  pontos: number;
  /** fatia do percurso gasta dentro das janelas (0..1) */
  fatiaNosPontos: number;
};

/**
 * O "cosseno" da janela: 1 no centro do ponto, 0 nas bordas.
 *
 * É a forma clássica de suavizar (`(1 + cos)/2`), e a razão de ser dela aqui é
 * prática: a integral tem forma fechada, então a posição sai exata sem tabela.
 */
function bump(u: number): number {
  if (u <= -1 || u >= 1) return 0;
  return (1 + Math.cos(Math.PI * u)) / 2;
}

/** Primitiva do `bump`, com a parte de fora valendo as constantes das pontas. */
function bumpIntegral(u: number): number {
  if (u <= -1) return -0.5;
  if (u >= 1) return 0.5;
  return u / 2 + Math.sin(Math.PI * u) / (2 * Math.PI);
}

/**
 * A curva de desaceleração para os pontos em `stopTs` (fração da rota).
 *
 * `percurso` é a duração do percurso em segundos de vídeo — só para converter a
 * janela pedida em fração da rota (o vídeo curto não pode ter a mesma janela em
 * fração que um longo, senão a desaceleração ocuparia o vídeo inteiro).
 */
export function curvaDePacing(
  stopTs: number[] | null | undefined,
  percurso: number,
  opts: { forca?: number; janelaS?: number; teto?: number } = {},
): Pacing {
  const forca = opts.forca ?? DESACELERA_FORCA;
  const janelaS = opts.janelaS ?? DESACELERA_JANELA_S;
  const teto = opts.teto ?? DESACELERA_TETO;
  const d = Number.isFinite(percurso) && percurso > 0 ? percurso : 10;

  // pontos válidos: dentro da rota e sem repetição exata (dois pontos no mesmo
  // lugar desacelerariam duas vezes o mesmo instante)
  const pontos: number[] = [];
  for (const ts of stopTs ?? []) {
    if (!Number.isFinite(ts)) continue;
    const t = ts < 0 ? 0 : ts > 1 ? 1 : ts;
    if (!pontos.some((p) => Math.abs(p - t) < 1e-6)) pontos.push(t);
  }
  pontos.sort((a, b) => a - b);

  const parado: Pacing = {
    posicao: (t) => Math.max(0, Math.min(1, t)),
    tempoDe: (x) => Math.max(0, Math.min(1, x)),
    densidade: () => 1,
    velocidade: () => 1,
    janela: 0,
    fator: 1,
    pontos: 0,
    fatiaNosPontos: 0,
  };
  if (pontos.length === 0 || forca <= 0) return parado;

  /*
   * A janela: a pedida (1,6 s de percurso), limitada pelo teto.
   *
   * O teto é sobre a **área** das janelas (`forca·Σjanela`), porque é a área que
   * mede o tempo gasto: a fatia de tempo dentro delas é área/(1 + área). Daí a
   * conta abaixo — com n pontos, cada um pode ter no máximo `teto/((1−teto)·forca·n)`.
   */
  const pedida = janelaS / d;
  const cabePeloTeto = teto / ((1 - teto) * forca * pontos.length);
  const janela = Math.max(1e-4, Math.min(pedida, cabePeloTeto));

  /** soma das primitivas de todos os pontos (a integral de `bump` deslocada) */
  const somaEm = (x: number) => {
    let soma = 0;
    for (const ts of pontos) soma += bumpIntegral((x - ts) / janela) + 0.5;
    return janela * soma;
  };
  const densidadeEm = (x: number) => {
    let soma = 0;
    for (const ts of pontos) soma += bump((x - ts) / janela);
    return 1 + forca * soma;
  };

  /*
   * A janela pode começar antes da largada (um ponto em `t = 0`): aí a parte de
   * fora da rota não existe. Descontando a primitiva em 0 na hora de normalizar,
   * a curva continua saindo de 0 e chegando em 1 — e o tempo gasto na janela
   * passa a ser só a parte que de fato acontece.
   */
  const inicio = somaEm(0);
  const total = 1 + forca * (somaEm(1) - inicio);

  const tempoEm = (x: number) => (x + forca * (somaEm(x) - inicio)) / total;

  /** o inverso de `tempoEm`, por bisseção: a posição que o relógio já alcançou */
  const posicao = (t: number) => {
    const alvo = Math.max(0, Math.min(1, t));
    if (alvo <= 0) return 0;
    if (alvo >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const meio = (lo + hi) / 2;
      if (tempoEm(meio) < alvo) lo = meio;
      else hi = meio;
    }
    return (lo + hi) / 2;
  };

  return {
    posicao,
    tempoDe: (x) => tempoEm(Math.max(0, Math.min(1, x))),
    densidade: densidadeEm,
    // velocidade média 1: entre os pontos anda `total` (mais que 1), no centro
    // do ponto anda `total/(1 + forca)`
    velocidade: (x) => total / densidadeEm(x),
    janela,
    fator: total,
    pontos: pontos.length,
    fatiaNosPontos: 1 - 1 / total,
  };
}
