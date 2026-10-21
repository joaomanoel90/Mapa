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

import { boundsOf, fitZoom, haversine, sampleTrack, type LatLng, type Track } from "./geo";

export type CinematicConfig = {
  /** abertura sobrevoando a região antes de pousar na rota */
  opening: boolean;
  /** aproxima a câmera nas paradas */
  stops: boolean;
  /** posições (0..1) das paradas ao longo do traçado */
  stopTs: number[];
  /**
   * A **chegada** ganha a mesma aproximação das paradas.
   *
   * O fim do percurso é uma ponta do trajeto como a partida — e a partida já
   * tem o seu momento de câmera (o pouso do voo). Sem isto, a chegada era a
   * única parada "sem ênfase": o usuário viu e cobrou ("o ponto B não está com
   * efeito de aumentar quando chega nele, igual o A quando inicia").
   */
  chegada?: boolean;
};

/**
 * Câmera de terceira pessoa: o personagem desce na tela (a câmera fica atrás e
 * acima dele, olhando para a frente) e, se `gira`, o mapa roda no rumo — o
 * caminho fica sempre "para cima".
 */
export type ChaseConfig = {
  /** gira o mapa no rumo do personagem (0 = norte para cima) */
  gira: boolean;
  /**
   * Inclina o quadro para "ver o horizonte".
   *
   * O mapa 2D não tem horizonte: numa vista de cima, perto e longe ocupam a
   * mesma altura. Com a inclinação, a parte de cima do quadro é comprimida,
   * como o chão visto de um ângulo baixo — a estrada à frente "sobe" para o
   * horizonte e o que está longe aparece menor. É o truque de sempre das vistas
   * de GPS, e o usuário pediu pelo nome ("dar uma inclinação para enxergar o
   * horizonte").
   */
  tilt?: boolean;
};

/** Onde o personagem cai na tela na terceira pessoa (0 = topo, 1 = base). */
export const CHASE_ALTURA = 0.68;

/** Quantos níveis de zoom a mais na terceira pessoa (é o que dá o "atrás"). */
export const CHASE_ZOOM = 1.5;

/**
 * O quanto a vista é comprimida na vertical com a inclinação (1 = sem ela).
 *
 * 0,62 = a metade de cima do quadro mostra o chão visto de raspão, como quem
 * olha o horizonte de uma janela alta. Testado no lab nesta faixa: menos que
 * ~0,5 a rota fica espremida demais, mais que ~0,8 não se percebe a inclinação.
 */
export const CHASE_TILT = 0.62;

/** O zoom de acompanhamento de verdade (a terceira pessoa chega mais perto). */
export function zoomEfetivo(camera: { followZoom: number; chase?: ChaseConfig }): number {
  return camera.followZoom + (camera.chase ? CHASE_ZOOM : 0);
}

/**
 * O fator de compressão vertical da vista (1 = quadro de cima, sem horizonte).
 *
 * Vale para quem desenha e para quem conta blocos: a inclinação faz a vista
 * olhar mais longe, então a mesma rota precisa de mais blocos de mapa.
 */
export function fatorDeTilt(camera: { chase?: ChaseConfig }): number {
  return camera.chase?.tilt ? CHASE_TILT : 1;
}

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

/**
 * Quantos níveis de zoom a mais em cima de uma parada.
 *
 * Era 1,4 — o pedido é "a visão cinematográfica mais perto do ponto com um
 * zoom". Com 2,2 a parada chega a ser ~1,7x maior na tela do que era (o zoom
 * dobra a cada nível), e o teto do mapa continua respeitado (`maxZoom`).
 *
 * O custo é de blocos de mapa (cada nível acima é mais um nível de blocos no
 * aquecimento): o renderizador só reserva a vista extra de uma parada enquanto
 * ela couber no teto, então o número pôde subir sem estourar o orçamento.
 */
export const STOP_BOOST = 2.2;

/**
 * Onde fica o ponto que a ênfase de uma parada focaliza, por instante do
 * percurso.
 *
 * É uma função porque a parada pode ter **lugar próprio**, fora da linha (o
 * usuário arrasta o pino até a igreja, a cachoeira) — e aí o foco não é o ponto
 * da rota. Quem não tem lugar próprio devolve o ponto da rota.
 */
export type FocusPoint = (ts: number) => LatLng | null;

/**
 * Quanto do quadro (a metade do menor lado) o personagem e o ponto da ênfase
 * podem ocupar juntos.
 *
 * A regra é: **o vídeo não pode perder o personagem**. O ponto da parada pode
 * estar a centenas de metros da linha (o usuário arrasta o pino para fora), e
 * com o ganho de zoom cheio essa distância vira mais de um quadro inteiro: o
 * personagem sai da tela e o que se vê é um mapa de um lugar qualquer. Numa
 * parada a 300 m da linha, em 720x1280, o ganho cheio de 2,2 níveis punha o
 * personagem a ~1.100 px do centro — fora do quadro.
 */
export const RAIO_DO_PAR = 0.42;

/** Metros por pixel no zoom 0, no equador (o mundo tem 256·2^z pixels). */
const METROS_NO_EQUADOR = 156543.0339;

/**
 * Quantos níveis de zoom a ênfase pode acrescentar sem perder de vista o
 * personagem.
 *
 * O ganho cheio (`STOP_BOOST`) só vale enquanto a **distância entre o
 * personagem e o ponto** couber no quadro no zoom resultante — é o que mantém
 * os dois na tela ao mesmo tempo. Quanto mais longe o pino estiver da linha,
 * menos zoom: a 300 m da linha, em 720x1280, cabem ~1,1 nível em vez de 2,2.
 *
 * Nunca fica **abaixo** do zoom normal: a ênfase é um ganho, e não pode
 * afastar a câmera do que já estava (o vídeo daria um "recuo" na parada).
 */
export function boostQueCabe(
  camera: { followZoom: number; chase?: ChaseConfig },
  width: number,
  height: number,
  metros: number,
  lat: number,
): number {
  const base = zoomEfetivo(camera);
  if (!(metros > 0) || !Number.isFinite(metros)) return STOP_BOOST;
  const raio = RAIO_DO_PAR * Math.min(width, height);
  const cos = Math.cos((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  const zoomQueCabe = Math.log2((raio * METROS_NO_EQUADOR * cos) / metros);
  return Math.max(0, Math.min(STOP_BOOST, zoomQueCabe - base));
}

/** Duração da abertura para um vídeo de `duration` segundos. */
export function openingSeconds(duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 10;
  return Math.max(0.4, Math.min(OPEN_CAP_S, d * OPEN_SHARE));
}

/**
 * Velocidade com que a abertura **parte**, medida em "voos por voo".
 *
 * `1` é a velocidade média do voo inteiro: a câmera já está andando no primeiro
 * quadro, na cadência de quem vem de longe, e desacelera até pousar. Zero é o
 * que se tinha antes (a curva era `easeInOutCubic`, e sair do repouso é o que
 * faz o primeiro quadro parecer uma foto que só depois se mexe — no feed, esse
 * quadro é justamente o que aparece parado antes do play). Três seria pular
 * direto para a velocidade máxima e passar o resto do voo arrastando.
 */
const ABERTURA_V0 = 1;

/**
 * Curva da abertura: sai andando, chega parando.
 *
 * Hermite cúbico com `f(0)=0`, `f(1)=1`, `f'(0)=ABERTURA_V0` e `f'(1)=0`. O
 * começo tem velocidade de verdade — é o que põe movimento no primeiro quadro —,
 * e a chegada continua com velocidade zero, que é o que faz parecer um pouso e
 * não um corte. No meio a curva acelera um pouco (o pico é ~1,3× a média)
 * porque a câmera vem de longe e o enquadramento ainda abre: não é um degrau,
 * é um S com partida.
 *
 * Com `v=1` ela é monótona em [0,1]: `f'(x) = -3x² + 2x + 1`, que é positivo no
 * intervalo e zera só em `x=1`.
 */
function aberturaSuave(x: number): number {
  const v = ABERTURA_V0;
  return v * (x * x * x - 2 * x * x + x) + (-2 * x * x * x + 3 * x * x);
}

/**
 * Andamento da abertura, de 0 a 1.
 *
 * A saída é suave de propósito — terminar devagar é o que faz parecer um pouso,
 * e não um corte. A **entrada** deixou de ser: começando do repouso, o primeiro
 * quadro (o que o feed mostra parado, antes do play) era uma foto da região, e o
 * pedido é que o vídeo abra **em movimento**.
 *
 * O tempo do voo não mudou (`openingSeconds`): só a distribuição dentro dele.
 */
export function openingProgress(elapsed: number, duration: number): number {
  const total = openingSeconds(duration);
  const x = Math.max(0, Math.min(1, elapsed / total));
  return aberturaSuave(x);
}

/**
 * Meia-janela (em fração do **percurso**) em que a parada puxa a câmera.
 *
 * ~1,6 s de percurso de cada lado: acompanha a janela da foto (2,6 s de vídeo) e
 * é o tempo que a câmera leva para **chegar** na parada. Com uma janela curta
 * ela só começava a se mexer nos últimos quadros, e a parada continuava saindo
 * pela borda no 9:16.
 *
 * É a janela **pedida**: quem manda nela é a `janelaDaEnfase`, que ainda limita
 * o quanto cada parada pode ocupar da rota.
 */
export function stopSpan(duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 10;
  return Math.max(0.03, Math.min(0.12, 1.6 / d));
}

/**
 * Quanto do **espaço entre paradas** as janelas de ênfase podem ocupar.
 *
 * Com `N` paradas igualmente espaçadas, cada uma pode ter no máximo
 * `ENFASE_ENTRE_PARADAS / (2·N)` de cada lado — o que deixa ~30% do espaço entre
 * uma parada e a seguinte **sem** ênfase nenhuma.
 *
 * Sem este teto, a janela era só a pedida (~1,6 s de percurso): com oito paradas
 * numa rota de 21 km e um vídeo de 14 s, cada janela ficava com 12% da rota
 * (2,5 km de cada lado) — **mais larga que a distância entre as paradas**. Medido
 * nesse caso: o zoom entrava em 2,6 s e ia até o fim do vídeo, com o máximo em
 * todas as paradas e ~56% de zoom ainda entre elas. Ou seja, a visão aproximada
 * já estava na tela muito antes de o personagem chegar em qualquer ponto — que é
 * exatamente o que o usuário viu ("a parada cinematográfica está sendo muito
 * antes do ponto").
 */
export const ENFASE_ENTRE_PARADAS = 0.7;

/**
 * A meia-janela da ênfase de uma parada, em fração da rota.
 *
 * `routeSeconds` = segundos do percurso; `quantos` = quantas paradas caem na
 * rota (no foco da câmera, a chegada conta como uma a mais).
 */
export function janelaDaEnfase(routeSeconds: number, quantos: number): number {
  const n = Number.isFinite(quantos) ? Math.max(1, Math.floor(quantos)) : 1;
  return Math.min(stopSpan(routeSeconds), ENFASE_ENTRE_PARADAS / (2 * n));
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
  const span = janelaDaEnfase(duration, stopTs.length);
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
  camera: {
    mode: "fit" | "follow";
    followZoom: number;
    cinematic?: CinematicConfig;
    chase?: ChaseConfig;
  };
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
  stopPos?: FocusPoint;
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
  /*
   * A chegada entra na mesma lista de focos (t = 1): o fim do percurso recebe a
   * aproximação que as paradas recebem — e que a partida já tem, com o pouso do
   * voo de abertura.
   */
  const focos = cine?.stops
    ? cine.chegada
      ? [...cine.stopTs, 1]
      : cine.stopTs
    : [];
  const foco = focos.length > 0 ? stopFocus(t, focos, rotaSec) : { forca: 0, ts: null };
  const ponto = foco.ts !== null ? input.stopPos?.(foco.ts) ?? null : null;
  /*
   * O ganho de zoom é **limitado pelo que cabe no quadro**: com o pino fora da
   * linha (o lugar próprio da parada), o ganho cheio punha o personagem fora da
   * tela — o usuário viu e cobrou ("está até perdendo o personagem do trajeto
   * quando vai dar o zoom no ponto"). `boostQueCabe` devolve o quanto dá para
   * chegar perto sem perder o personagem de vista; numa parada em cima da linha
   * (a distância é de metros) continua sendo o ganho cheio.
   */
  const boost = ponto
    ? boostQueCabe(camera, width, height, haversine(pos, ponto), pos.lat)
    : STOP_BOOST;
  const alvo = Math.min(zoomEfetivo(camera) + foco.forca * boost, maxZoom);
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
