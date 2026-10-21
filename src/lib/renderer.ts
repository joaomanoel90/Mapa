import { gaitOf, type Character } from "./characters";
import { focoDasParadas, poiLatLng, type Poi } from "./pois";
import { hasMark, type Endpoints } from "./endpoints";
import {
  BASEMAPS,
  comporRelevo,
  hillshadeBloco,
  relevoDoMapa,
  tileUrl,
  loadTile,
  filterTile,
  isFailedTile,
  type BasemapId,
  type TileImage,
} from "./tiles";
import type { EndCard } from "./stats";
import { averagePace, elapsedAt, formatClock, formatPace, speedAt } from "./hud";
import {
  boostQueCabe,
  cameraTarget,
  CHASE_ALTURA,
  CHASE_TILT,
  METROS_NO_EQUADOR,
  fatorDeTilt,
  zoomEfetivo,
  type ChaseConfig,
  type CinematicConfig,
  type FocusPoint,
} from "./camera";
import { routeEnd, timelineOr, type Timeline } from "./timeline";
import { NEUTRAL_COLOR, slopeAt, slopeSeries, type ColoredRoute } from "./coloring";
import { destaqueEmCena, destaques, type Destaque } from "./highlights";
import type { KmMark } from "./km-marks";
import { countPassed } from "./passages";
import { diaNaTela, type Dia } from "./days";
import {
  elevacaoEm,
  inclinacaoDaSubida,
  profileLayout,
  trailProfile,
  type TrailProfile,
} from "./profile";
import { coverSquare, type PhotoImage, type PhotoLookup } from "./photos";
import {
  TILE_SIZE,
  bearing,
  boundsOf,
  buildTrack,
  fitZoom,
  cumDoDesenho,
  formatDistance,
  haversine,
  project,
  rumoSuave,
  sampleTrack,
  unproject,
  visibleRuns,
  type Bounds,
  type IndexRange,
  type LatLng,
  type Sample,
  type Track,
} from "./geo";

export type CameraMode = "fit" | "follow";

export type CameraConfig = {
  mode: CameraMode;
  followZoom: number;
  /** abertura sobrevoando a região e aproximação nas paradas */
  cinematic?: CinematicConfig;
  /** câmera de terceira pessoa (personagem mais abaixo, opcionalmente girando o mapa) */
  chase?: ChaseConfig;
};

export type SceneStyle = {
  accent: string;
  basemap: BasemapId;
  /**
   * Sombreado do relevo por baixo da rota (ver `RELEVO_DO_MAPA`).
   *
   * Não é 3D: é a luz e a sombra do terreno vistas de cima, misturadas no
   * próprio bloco do mapa. Onde o mapa já traz o seu (OpenTopoMap), não muda
   * nada.
   */
  relevo?: boolean;
  showRoute: boolean;
  showTraveled: boolean;
  showEndpoints: boolean;
  /**
   * O **fantasma**: um segundo personagem, translúcido, andando à frente na
   * mesma rota. Ver `pontoFantasma`.
   */
  ghost?: boolean;
  /**
   * O aviso de **dia novo** no percurso de vários dias ("DIA 2 · 41,2 km").
   *
   * Só aparece quando o arquivo realmente tem mais de um dia (ver
   * `diasDoPercurso`); num percurso de um dia não há o que avisar.
   */
  showDays?: boolean;
  /** exibe as paradas (ponte, cachoeira, igreja…) no vídeo */
  showStops: boolean;
  /** mostra o nome da parada em uma etiqueta */
  showStopLabels: boolean;
  /** mostra o contador "2/5 paradas" no canto do vídeo */
  showStopCounter: boolean;
  showTitle: boolean;
  showProgress: boolean;
  /** cartela com o resumo do percurso nos últimos segundos do vídeo */
  showSummary: boolean;
  /** painel de números no canto (velocidade, distância, relógio) */
  showHud: boolean;
  /**
   * Mapa em miniatura no canto, abaixo do título.
   *
   * Mostra a rota **inteira** pequena, com o pedaço já percorrido em destaque e
   * o personagem marcado: é a resposta ao "tem como ir desenhando no canto da
   * tela em baixo do título o mapa que está sendo percorrido". Sem ele, quem
   * está na terceira pessoa vê só alguns metros à frente e não sabe onde está
   * no percurso.
   */
  showMinimap?: boolean;
  /**
   * Faixa do **perfil de elevação** no rodapé: a linha do relevo, que se enche
   * junto com o personagem, com a altitude atual e a maior subida marcada.
   *
   * É o que conta a dureza do percurso — o que falta nos vídeos automáticos,
   * que mostram o traçado visto de cima mas não dizem onde sobe. Só aparece
   * quando o arquivo tem altitude (sem ela, não há o que desenhar).
   */
  showProfile?: boolean;
  /**
   * Logo da marca (data URL), na **cartela final**.
   *
   * A cartela é o quadro que vira print: é ali que a marca do projeto tem de
   * estar. Com o avatar no alto, o logo fica na mesma linha, à esquerda dele;
   * sozinho, ocupa o alto do painel.
   */
  logo?: string;
  /** placa clara atrás do logo (para logo escuro no painel escuro) */
  logoChip?: boolean;
  /**
   * Destaques do percurso: a **melhor parcial** e a **maior subida** aparecem
   * como um aviso curto quando o personagem chega nelas.
   *
   * É o que conta a corrida — onde o atleta foi melhor e onde foi mais duro —,
   * e é o que sobra de assunto para quem comenta o vídeo depois. Só aparece
   * quando o arquivo tem o dado (hora para a parcial, altitude para a subida).
   */
  showHighlights?: boolean;
  /**
   * Avatar do personagem (data URL da foto), no lugar do emoji.
   *
   * Vem separado do `character` porque a foto não é um desenho: o emoji gira
   * com o rumo (o barco aponta para onde vai) e a cara de quem corre, não — ela
   * fica sempre de pé dentro do selo, e quem diz a direção é a seta.
   */
  avatar?: string;
  /**
   * No HUD, mostra o **ritmo** (min/km) no lugar da velocidade.
   *
   * Vale para corrida e caminhada: `min/km` é a unidade de quem vai a pé, e o
   * número é a média do percurso.
   */
  pace?: boolean;
  title: string;
  subtitle: string;
};

export type View = { z: number; s: number; ox: number; oy: number };

export type FrameState = {
  track: Track;
  t: number;
  character: Character;
  rotate: boolean;
  camera: CameraConfig;
  style: SceneStyle;
  /** dias do percurso (vazio ou ausente = percurso de um dia só) */
  days?: Dia[] | null;
  /** paradas do percurso (aparecem quando o personagem passa) */
  stops: Poi[];
  /** locais marcados de partida/chegada (null = letras A/B) */
  endpoints: Endpoints;
  /** segundos desde o início do **vídeo** (para efeitos) */
  elapsed: number;
  duration: number;
  /**
   * As janelas do vídeo: voo → percurso → cartela.
   *
   * Sem ele, o vídeo inteiro é percurso e a cartela reserva a sua fatia no fim
   * (o comportamento antigo). Com ele, quem manda no relógio é quem exporta:
   * `t` continua sendo o progresso do percurso, e `elapsed` o instante do vídeo.
   */
  timeline?: Timeline | null;
  /** cartela final (números digitados + linha de baixo) — null quando não há nada */
  summary: EndCard | null;
  /**
   * Horas dos pontos do traçado (NaN onde não há), quando o arquivo é de GPS.
   *
   * É o que permite o HUD mostrar a velocidade **real** e o relógio da
   * pedalada.
   */
  times: number[] | null;
  /**
   * Tempo do percurso escrito na cartela, em segundos.
   *
   * Quando o arquivo não tem hora, o relógio do HUD conta até este tempo — o
   * número que o usuário escreveu, em vez do tempo do clipe (que é o que a
   * barra de progresso já mostra).
   */
  cardSeconds: number | null;
  /**
   * Rota colorida por velocidade ou inclinação (null = linha sólida).
   * Calculada uma vez pelo app e reaproveitada em todos os quadros: a rampa
   * envolve médias móveis e não cabe dentro de um laço de 30 quadros/s.
   */
  colored?: ColoredRoute | null;
  /** marcas de km ao longo do traçado */
  marks?: KmMark[] | null;
  /**
   * Fotos já decodificadas (paradas e cartela).
   *
   * O desenho é síncrono e roda 30 vezes por segundo, então ele só **consulta**:
   * foto que ainda não ficou pronta não aparece naquele quadro, e o quadro
   * seguinte a mostra. Nada de esperar imagem dentro do laço.
   */
  photos?: PhotoLookup | null;
  /** foto do projeto (data URL) — aparece no alto da cartela final */
  cardPhoto?: string | null;
  /**
   * Passagens de cada parada, por id.
   *
   * Uma parada pode ser passada mais de uma vez (ida e volta pelo mesmo
   * caminho): a lista traz **todos** os instantes em que a rota chega perto
   * dela. Sem esta informação, cada parada acontece uma vez só, no seu `t` —
   * o comportamento antigo.
   */
  passages?: Record<string, number[]> | null;
};

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

export class TileStore {
  private imgs = new Map<string, TileImage | null>();
  private pending = new Set<string>();

  /**
   * O relevo entra **no mesmo bloco** do mapa (ver `comporRelevo`), mas o cache
   * é separado: o bloco com sombreado não serve para o mapa sem ele. A chave
   * carrega o `+r` para os dois mundos não se misturarem ao ligar e desligar o
   * interruptor.
   */
  constructor(
    public basemap: BasemapId,
    public relevo = false,
  ) {}

  key(z: number, x: number, y: number) {
    return `${this.basemap}${this.relevo ? "+r" : ""}/${z}/${x}/${y}`;
  }

  put(z: number, x: number, y: number, img: TileImage | null) {
    this.imgs.set(this.key(z, x, y), img);
  }

  get(z: number, x: number, y: number): TileImage | null {
    return this.imgs.get(this.key(z, x, y)) ?? null;
  }

  /** já está carregado (ou já falhou de vez)? */
  isSettled(z: number, x: number, y: number) {
    return this.imgs.has(this.key(z, x, y));
  }

  /** baixa + aplica o filtro do estilo uma única vez (e o relevo, se ligado) */
  async fetchTile(z: number, x: number, y: number): Promise<TileImage | null> {
    const bm = BASEMAPS[this.basemap];
    const raw = await loadTile(tileUrl(bm, z, x, y));
    if (!raw) return null;
    const filtrado = await filterTile(raw, bm.filter);

    /*
     * O sombreado é **opcional**: servidor fora do ar, bloco que não existe ou
     * canvas sem `createImageBitmap` devolvem o mapa sem relevo. Perder a
     * sombra é ruim; perder o mapa no meio do vídeo não pode acontecer.
     */
    const estilo = this.relevo ? relevoDoMapa(this.basemap) : null;
    if (!estilo) return filtrado;
    const bloco = hillshadeBloco(z, x, y);
    const sombra = await loadTile(bloco.url);
    if (!sombra) return filtrado;
    return comporRelevo(filtrado, sombra, estilo, bloco);
  }

  request(z: number, x: number, y: number) {
    const k = this.key(z, x, y);
    if (this.imgs.has(k) || this.pending.has(k)) return;
    this.pending.add(k);
    this.fetchTile(z, x, y)
      .then((img) => {
        this.imgs.set(k, img);
        this.pending.delete(k);
      })
      .catch(() => {
        this.imgs.set(k, null);
        this.pending.delete(k);
      });
  }

  /**
   * Espera os downloads **em andamento** terminarem (ou o prazo acabar).
   *
   * É chamado antes do primeiro quadro da gravação: um bloco que ainda está na
   * rede quando o desenho pergunta por ele é congelado no nível anterior **até o
   * fim do vídeo** (`blocoDoQuadro`), e o mapa fica borrado ali para sempre.
   * Esperar dois ou três segundos no começo troca isso por uma imagem nítida.
   *
   * Devolve quantos ainda ficaram pendentes (0 = rede em dia).
   */
  async aguardarPendentes(prazoMs = 4000): Promise<number> {
    const fim = Date.now() + prazoMs;
    while (this.pending.size > 0 && Date.now() < fim) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.pending.size;
  }

  /** total de tiles realmente disponíveis para desenhar */
  get loadedCount(): number {
    let n = 0;
    for (const v of this.imgs.values()) if (v) n++;
    return n;
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function viewFrom(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
  maxZoom = 19,
): View {
  const clamped = Math.max(1, Math.min(maxZoom, zoom));
  const z = Math.max(0, Math.floor(clamped));
  const s = Math.pow(2, clamped - z);
  const c = project(center.lat, center.lng, z);
  return { z, s, ox: c.x - width / 2 / s, oy: c.y - height / 2 / s };
}

/**
 * A vista de um quadro: a matriz que leva do pixel do mundo para a tela (escala
 * e **giro**) e a caixa do mundo que a tela enxerga.
 *
 * Sem giro e com o centro na metade da altura, é exatamente o `viewFrom` de
 * sempre (o `ox`/`oy` dele sai da caixa devolvida aqui). Com a **terceira
 * pessoa**, ela muda duas coisas:
 *
 * - `altura`: onde o centro cai na altura da tela. Em 0,68 o personagem fica
 *   abaixo do meio, com o caminho à frente ocupando a parte de cima — é o que
 *   dá a sensação de câmera atrás do personagem, e não em cima dele;
 * - `angulo`: gira o mapa de verdade (os blocos, a rota, tudo). É assim que o
 *   caminho fica sempre "para cima" numa câmera de perseguição.
 *
 * Nada disso é chute de posição: a caixa devolvida é o **inverso** dos quatro
 * cantos da tela, então ela contém exatamente o que a tela mostra — e é ela que
 * pede os blocos de mapa e corta o traçado.
 */
export type Vista = {
  z: number;
  s: number;
  /** matriz: tela = (a·x + c·y + e, b·x + d·y + f) em pixels do mundo no zoom `z` */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export function vistaDe(input: {
  centro: LatLng;
  zoom: number;
  width: number;
  height: number;
  maxZoom?: number;
  /** 0..1: onde o centro cai na altura da tela (0,5 = centro) */
  altura?: number;
  /** graus: gira o mapa (o rumo do personagem para cima) */
  angulo?: number;
  /**
   * Compressão vertical da vista (1 = de cima; ver `CHASE_TILT`).
   *
   * A compressão é feita **em volta da âncora** (o ponto onde o personagem
   * está), então o personagem não se move na tela quando a inclinação entra —
   * o que muda é quanto do mundo aparece acima dele.
   */
  tilt?: number;
}): Vista {
  const { centro, width, height, maxZoom = 19 } = input;
  const altura = input.altura ?? 0.5;
  const rad = ((input.angulo ?? 0) * Math.PI) / 180;
  const clamped = Math.max(1, Math.min(maxZoom, input.zoom));
  const z = Math.max(0, Math.floor(clamped));
  const s = Math.pow(2, clamped - z);
  const P = project(centro.lat, centro.lng, z);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = s * cos;
  /*
   * A inclinação comprime a **linha vertical** da matriz (b e d), na altura da
   * âncora: o ponto onde o personagem está não sai do lugar e o que muda é o
   * quanto do mundo cabe acima dele — a parte de cima do quadro vira o fundo do
   * cenário, pequena e longe, e a de baixo fica o chão perto.
   */
  const tilt = Math.max(0.3, Math.min(1, input.tilt ?? 1));
  const ancora = height * altura;
  const b = s * sin * tilt;
  const c = -s * sin;
  const d = s * cos * tilt;
  const e = width / 2 - (a * P.x + c * P.y);
  const f = tilt * (ancora - (s * sin * P.x + s * cos * P.y)) + ancora * (1 - tilt);
  const det = a * d - b * c;
  const inverso = (sx: number, sy: number) => ({
    x: (d * (sx - e) - c * (sy - f)) / det,
    y: (a * (sy - f) - b * (sx - e)) / det,
  });
  const cantos = [inverso(0, 0), inverso(width, 0), inverso(0, height), inverso(width, height)];
  return {
    z,
    s,
    a,
    b,
    c,
    d,
    e,
    f,
    x0: Math.min(...cantos.map((p) => p.x)),
    y0: Math.min(...cantos.map((p) => p.y)),
    x1: Math.max(...cantos.map((p) => p.x)),
    y1: Math.max(...cantos.map((p) => p.y)),
  };
}

/**
 * Onde fica o mapa em miniatura e qual é o tamanho dele.
 *
 * Fica no canto superior esquerdo, **abaixo do título** (`abaixoDe` = a altura
 * em que o título terminou). O quadrado é proporcional ao menor lado do quadro,
 * então no 9:16 e no 16:9 ele ocupa a mesma fração da tela.
 *
 * É uma função pura porque o tamanho dele também decide **quais blocos baixar**
 * antes de gravar (`tilesForAnimation`): o aquecimento e o desenho têm de usar
 * exatamente a mesma caixa.
 */
export function minimapLayout(
  width: number,
  height: number,
  abaixoDe = 0,
): { x: number; y: number; w: number; h: number; raio: number } {
  const sf = Math.max(0.55, Math.min(1.6, Math.min(width, height) / 720));
  const pad = 26 * sf;
  const w = Math.round(Math.min(width - pad * 2, Math.min(width, height) * 0.36));
  const h = Math.round(w * 0.82);
  const y = Math.round(abaixoDe > 0 ? abaixoDe + 14 * sf : pad);
  return { x: Math.round(pad), y, w, h, raio: 14 * sf };
}

/**
 * A folga (em fração do menor lado) entre o personagem e a borda do quadro.
 *
 * O selo dele tem ~34 px de raio em 720 de largura: 6% do menor lado deixam o
 * selo inteiro dentro da moldura, com a seta.
 */
export const MARGEM_DO_PERSONAGEM = 0.06;

/**
 * O maior peso com que o quadro pode deslizar até a câmera sem deixar o
 * personagem fora dele.
 *
 * O quadro desliza entre o **personagem** (peso 0) e a **câmera** (peso 1); em
 * qualquer peso, a posição do personagem na tela é uma conta afim, porque a
 * vista é linear: `tela(s) = base − s·V`, onde `base` é onde ele cai com o peso
 * zero (o centro embaixo dele, a `altura` do quadro) e `V` é o deslocamento
 * dele quando o quadro vai inteiro até a câmera (medido **em pixels**, com a
 * matriz da vista — que já traz o zoom, o giro e a inclinação). Daí saem, eixo
 * por eixo, os pesos máximos que mantêm o personagem dentro da moldura.
 *
 * A conta é exata, e não uma estimativa: com peso zero o personagem está na
 * âncora por construção (`vistaDe` ancora a vista nele), e tudo o que muda até
 * o peso um é linear.
 *
 * Existe por causa do pedido: *"está até perdendo o personagem do trajeto
 * quando vai dar o zoom no ponto"*. O pino da parada pode estar a centenas de
 * metros da linha (o usuário arrasta o pino até a igreja), e o quadro ia até
 * ele inteiro — o personagem saía pela borda.
 */
export function pesoQueCabe(
  m: Vista,
  personagem: LatLng,
  camera: LatLng,
  altura: number,
  width: number,
  height: number,
): number {
  const P = project(personagem.lat, personagem.lng, m.z);
  const Q = project(camera.lat, camera.lng, m.z);
  const dx = Q.x - P.x;
  const dy = Q.y - P.y;
  const vx = m.a * dx + m.c * dy;
  const vy = m.b * dx + m.d * dy;
  const margem = MARGEM_DO_PERSONAGEM * Math.min(width, height);
  /* a âncora do personagem: x no meio do quadro, y na `altura` */
  const cabeX = Math.abs(vx) > 1e-6 ? (width / 2 - margem) / Math.abs(vx) : Infinity;
  const livre = (vy > 0 ? altura * height : height - altura * height) - margem;
  const cabeY = Math.abs(vy) > 1e-6 ? livre / Math.abs(vy) : Infinity;
  return Math.max(0, Math.min(1, cabeX, cabeY));
}

/** A projeção de um ponto do mundo (no zoom da vista) para a tela. */
export function projetorDaVista(v: Vista): (x: number, y: number) => { x: number; y: number } {
  return (x, y) => ({ x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f });
}

/** Folga (em pixels de tela) para a emenda dos blocos de mapa. */
export const SANGRIA_PX = 0.5;

/**
 * O retângulo em que um bloco de mapa é desenhado: o exato, com meio pixel de
 * folga em cada lado.
 *
 * Duas coisas dependem disto, e as duas foram medidas num banco de imagens com
 * blocos de cor chapada — contando os pixels do fundo do mapa que sobravam no
 * quadro:
 *
 * 1. **a fresta**: dois blocos desenhados no retângulo exato (o `x·256` até
 *    `(x+1)·256` do mundo) se encostam, e ainda sobra a linha da emenda por
 *    conta da cobertura de cada um no pixel da fronteira. O que ficava à mostra
 *    era o fundo do mapa — a "linha preta na emenda das imagens" que o usuário
 *    viu. Cada bloco cobrindo **meio pixel** além da sua borda fecha isso: o que
 *    um deixa de cobrir, o vizinho cobre.
 *
 * 2. **o degrau**: prender as bordas na grade de pixels da tela (`Math.round`)
 *    fechava a fresta, mas fazia a **imagem** do mapa andar aos pulos — presa
 *    por alguns quadros e pulando de 1 px de uma vez, enquanto a rota e o
 *    personagem andavam liso. Medido: com a câmera andando 0,2 px por quadro, a
 *    borda de um bloco andava 0,8 px e depois 0 px, em vez dos mesmos 0,2 px.
 *
 * A folga é pequena de propósito: meio pixel de sobreposição é o máximo que se
 * pode cobrir sem a junção aparecer — a imagem de um bloco cobre a do vizinho
 * nesse tanto, e o conteúdo das duas é contínuo.
 */
export function retanguloDoBloco(
  v: Vista,
  x: number,
  y: number,
  lado: number,
): { x: number; y: number; w: number; h: number } {
  const det = Math.abs(v.a * v.d - v.b * v.c);
  if (!(det > 0)) return { x, y, w: lado, h: lado };
  const fx = (SANGRIA_PX * (Math.abs(v.d) + Math.abs(v.c))) / det;
  const fy = (SANGRIA_PX * (Math.abs(v.a) + Math.abs(v.b))) / det;
  return { x: x - fx, y: y - fy, w: lado + 2 * fx, h: lado + 2 * fy };
}

/** Os blocos que uma vista precisa — a caixa dela, com a folga pedida. */
export function tilesDaVista(v: Vista, margin = 0): [number, number, number][] {
  const largura = (v.x1 - v.x0) * v.s;
  const altura = (v.y1 - v.y0) * v.s;
  return tilesInView({ z: v.z, s: v.s, ox: v.x0, oy: v.y0 }, largura, altura, margin);
}

export function targetView(input: {
  track: Track;
  t: number;
  camera: CameraConfig;
  width: number;
  height: number;
  maxZoom?: number;
}): View {
  const { track, t, camera, width, height, maxZoom = 19 } = input;
  if (camera.mode === "follow") {
    const { pos } = sampleTrack(track, t);
    return viewFrom(pos, zoomEfetivo(camera), width, height, maxZoom);
  }
  const b = boundsOf(track.pts);
  const zoom = fitZoom(b, width, height, 0.16);
  return viewFrom(
    { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 },
    zoom,
    width,
    height,
    maxZoom,
  );
}

/**
 * O bloco que cobre um bloco que **ainda não chegou**: o pai dele, esticado.
 *
 * O desenho pede o bloco do nível de zoom em vigor. Quando a câmera muda de
 * nível — o zoom da parada é o caso mais visível, são 2,2 níveis de uma vez — o
 * nível novo não está no mapa ainda, e o que ficava no lugar era **nada**: um
 * pedaço do fundo no meio do quadro até o bloco chegar. No arquivo do usuário
 * isso aparece como o mapa "pulando" na aproximação da parada.
 *
 * Com o pai, o buraco nunca existe: em vez de um quadro vazio, aparece a imagem
 * do nível anterior esticada (borrada por um instante, e logo substituída pela
 * exata). A sub-área do pai que cobre o filho é a mesma área do mundo, então o
 * retângulo de destino é o mesmo do filho — só o recorte de origem muda.
 *
 * Devolve `null` quando não há nenhum ancestral no mapa.
 */
export function blocoDeReserva(
  store: { get(z: number, x: number, y: number): TileImage | null },
  z: number,
  x: number,
  y: number,
  niveis = 3,
): { img: TileImage; sx: number; sy: number; sw: number; sh: number } | null {
  for (let k = 1; k <= niveis; k++) {
    const pz = z - k;
    if (pz < 0) return null;
    const m = 2 ** k;
    const px = Math.floor(x / m);
    const py = Math.floor(y / m);
    const img = store.get(pz, px, py);
    if (!img) continue;
    const largura = Math.max(1, Number(img.width) || TILE_SIZE) / m;
    const altura = Math.max(1, Number(img.height) || TILE_SIZE) / m;
    return {
      img,
      sx: (x - px * m) * largura,
      sy: (y - py * m) * altura,
      sw: largura,
      sh: altura,
    };
  }
  return null;
}

/**
 * O bloco que o quadro desenha — e, **na gravação**, sempre o mesmo.
 *
 * A gravação (tempo real, pelo `MediaRecorder`) leva os 60 segundos do vídeo em
 * tempo de relógio: um bloco que chega no meio dela entra numa imagem que já
 * estava na tela, e o mapa **troca de textura** de um quadro para o outro — é o
 * "continua travando" que o usuário viu no mp4, medido quadro a quadro (as
 * mudanças grandes do arquivo dele não são deslocamento: nenhuma faixa da imagem
 * anda junto com as outras, é troca de textura).
 *
 * Com a lista de congelados, o primeiro quadro que precisou do nível anterior
 * **fica** nele até o fim: o mapa pode estar mais borrado num pedaço, mas não
 * troca de imagem no meio do vídeo. Fora da gravação (e na exportação rápida, que
 * desenha quadros em sequência sem esperar o relógio) a lista vai nula e o
 * comportamento é o de sempre: o bloco exato entra assim que chega.
 */
export function blocoDoQuadro(
  store: { get(z: number, x: number, y: number): TileImage | null },
  z: number,
  x: number,
  y: number,
  congelados?: Set<string> | null,
): { img: TileImage } | { reserva: { img: TileImage; sx: number; sy: number; sw: number; sh: number } } | null {
  const chave = `${z}/${x}/${y}`;
  if (!congelados?.has(chave)) {
    const img = store.get(z, x, y);
    if (img) return { img };
  }
  const reserva = blocoDeReserva(store, z, x, y);
  // travou neste nível: o resto do vídeo sai daqui
  if (reserva && congelados) congelados.add(chave);
  return reserva ? { reserva } : null;
}

function tilesInView(
  view: View,
  width: number,
  height: number,
  margin = 0,
): [number, number, number][] {
  const n = Math.pow(2, view.z);
  const x0 = Math.floor(view.ox / TILE_SIZE) - margin;
  const x1 = Math.floor((view.ox + width / view.s) / TILE_SIZE) + margin;
  const y0 = Math.floor(view.oy / TILE_SIZE) - margin;
  const y1 = Math.floor((view.oy + height / view.s) / TILE_SIZE) + margin;
  const out: [number, number, number][] = [];
  for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) {
    for (let x = x0; x <= x1; x++) out.push([view.z, x, y]);
  }
  return out;
}

export type TileRef = { url: string; z: number; x: number; y: number };

/**
 * Todos os tiles necessários para a animação inteira.
 * No modo "seguir" percorre a rota inteira (não apenas amostras esparsas),
 * para que nenhum trecho do vídeo fique sem mapa.
 *
 * A câmera cinematográfica entra na conta: a abertura mostra a **região toda**
 * em zoom baixo (blocos que o percurso a pé não pediria), e a aproximação nas
 * paradas pede blocos de um nível acima. Sem isso o começo do vídeo sairia com
 * o mapa vazio, e as paradas com buracos em volta.
 */
export function tilesForAnimation(
  track: Track,
  camera: CameraConfig,
  width: number,
  height: number,
  basemap: BasemapId,
  cinematic?: CinematicConfig | null,
  /**
   * Onde fica o ponto de cada parada — a mesma função que o desenho usa.
   * Sem ela, o aquecimento baixa os blocos da **rota** e o vídeo chega na
   * parada com o mapa borrado, esperando os blocos do lugar.
   */
  foco?: FocusPoint | null,
): TileRef[] {
  const bm = BASEMAPS[basemap];
  const maxZoom = bm.maxZoom;
  const map = new Map<string, TileRef>();
  const chase = camera.mode === "follow" ? camera.chase ?? null : null;
  /**
   * Pede os blocos que uma vista precisa.
   *
   * O giro da terceira pessoa entra na conta: com o mapa rodado, a tela mostra
   * um retângulo **deitado** no mundo, e a caixa que o contém (a mesma que o
   * render usa) é maior que a tela. Sem isso, o vídeo sairia com buracos nas
   * diagonais.
   */
  const vista = (centro: LatLng, zoom: number, rumo: number, gira: boolean) =>
    vistaDe({
      centro,
      zoom,
      width,
      height,
      maxZoom,
      altura: chase ? CHASE_ALTURA : 0.5,
      angulo: chase?.gira && gira ? -rumo : 0,
      // com a inclinação o quadro olha mais longe: sem ela aqui, o vídeo sairia
      // com buracos no alto (blocos que o desenho pede e a conta não pediu)
      tilt: chase ? fatorDeTilt(camera) : 1,
    });

  /**
   * Quantos blocos desta vista ainda **não** estão no mapa.
   *
   * É o que permite perguntar "esta vista cabe?" **antes** de acrescentá-la. A
   * primeira versão copiava o mapa inteiro a cada vista para poder desfazer —
   * numa rota longa são centenas de vistas e uma cópia de mil blocos cada: a
   * conta ficou 12x mais lenta (a sugestão de zoom no painel passou de 70 ms
   * para 1 s).
   */
  const novosDaVista = (v: Vista) => {
    let n = 0;
    for (const [z, x, y] of tilesDaVista(v, 1)) if (!map.has(`${z}/${x}/${y}`)) n++;
    return n;
  };

  const despejar = (v: Vista) => {
    for (const [z, x, y] of tilesDaVista(v, 1)) {
      const k = `${z}/${x}/${y}`;
      if (!map.has(k)) map.set(k, { url: tileUrl(bm, z, x, y), z, x, y });
    }
  };

  const push = (centro: LatLng, zoom: number, rumo: number, gira: boolean) =>
    despejar(vista(centro, zoom, rumo, gira));

  const b = boundsOf(track.pts);
  const centro = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };

  if (camera.mode === "fit") {
    push(centro, fitZoom(b, width, height, 0.16), 0, false);
    return Array.from(map.values());
  }

  const cine = cinematic ?? camera.cinematic ?? null;
  // o enquadramento da abertura é o do "Rota toda", no meio do traçado
  if (cine?.opening) push(centro, fitZoom(b, width, height, 0.16), 0, false);

  const zoom = Math.min(zoomEfetivo(camera), maxZoom);
  /*
   * A **escada de zoom**.
   *
   * A câmera não salta do enquadramento geral para o zoom de acompanhamento: ela
   * pousa, passando por **cada nível inteiro** no caminho (13 → 14 → 15 → 16). O
   * mesmo acontece na aproximação de uma parada (até 2,2 níveis em ~1,6 s).
   *
   * O aquecimento antigo pedia só as duas pontas — o geral e o de
   * acompanhamento —, então os níveis do meio nunca eram baixados. Quando a
   * gravação atravessava um deles, o bloco chegava faltando e era congelado no
   * nível anterior **até o fim do vídeo**: foi assim que o usuário recebeu "210
   * blocos do mapa não estavam prontos", mesmo com o aquecimento dizendo que não
   * faltava nada.
   *
   * A conta é limitada de propósito: um punhado de vistas por nível (os níveis
   * baixos precisam de poucos blocos para cobrir a tela inteira), dentro do
   * teto dos servidores gratuitos.
   */
  const pushEscada = (
    centro: LatLng,
    de: number,
    ate: number,
    rumo: number,
    gira: boolean,
  ) => {
    const baixo = Math.floor(Math.min(de, ate));
    const alto = Math.ceil(Math.max(de, ate));
    for (let z = baixo + 1; z <= alto; z++) {
      const v = vista(centro, z, rumo, gira);
      if (map.size + novosDaVista(v) > TILE_BUDGET) return;
      despejar(v);
    }
  };
  // amostra por distância: um tile de folga cobre o atraso da câmera suavizada
  const stepMeters = 140;
  const byDistance = Math.round(track.total / stepMeters);
  const steps = Math.max(2, Math.min(500, byDistance));
  for (let i = 0; i <= steps; i++) {
    const s = sampleTrack(track, i / steps);
    push(s.pos, zoom, s.heading, true);
  }

  if (cine?.opening) {
    /*
     * O pouso do voo: do enquadramento geral (centro da rota) até o zoom de
     * acompanhamento, no começo do percurso. Cinco pontos bastam — o nível
     * baixo de um deles já cobre o vizinho.
     */
    const zGeral = fitZoom(b, width, height, 0.16);
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * 0.12; // os primeiros 12% do percurso
      const s = sampleTrack(track, t);
      const pos = i === 0 ? centro : s.pos;
      pushEscada(pos, zGeral, zoom, s.heading, true);
    }
  } else {
    // sem voo, ainda assim o zoom pode entrar por degraus: cobre o começo
    const s = sampleTrack(track, 0);
    pushEscada(s.pos, zoom - 1, zoom, s.heading, true);
  }

  if (cine?.stops && cine.stopTs.length > 0) {
    // no máximo oito paradas: numa rota com cinquenta, o ganho de zoom em
    // todas elas dobraria a conta dos servidores gratuitos sem que ninguém
    // reparasse nas do meio
    const validas = cine.stopTs.filter((ts) => Number.isFinite(ts));
    const escolhidas = validas.length <= LIMITE_VISTAS_DE_PARADA ? validas : spread(validas, LIMITE_VISTAS_DE_PARADA);
    for (const ts of escolhidas) {
      const s = sampleTrack(track, ts);
      /*
       * O teto manda mais que a parada: a vista extra é um **ganho** (o foco
       * chega mais perto), e não pode ser o motivo de a exportação ser recusada.
       * A pergunta é feita **antes** de acrescentar — e, se esta não couber, as
       * seguintes também não caberiam (o custo só cresce), então para aqui.
       *
       * O que sobra do teto depois da rota é o que define quantas paradas ganham
       * a aproximação: numa rota curta e num quadro largo, todas; numa rota longa
       * em retrato, as primeiras.
       */
      /*
       * A vista aquecida é **a que o desenho vai mostrar** no pico da
       * aproximação: o mesmo lugar (o pino pode estar fora da linha), o mesmo
       * teto de zoom (`boostQueCabe`) e o mesmo centro — o quadro desliza até o
       * ponto, mas só até onde o personagem continua na moldura
       * (`pesoQueCabe`).
       *
       * Foi esta conta que, com o ponto da **rota** e o ganho cheio, deixou o
       * vídeo borrado na parada: os blocos do lugar que aparece na tela não
       * tinham sido baixados — era o "mostra o video tambem travando".
       */
      const alvo = foco?.(ts) ?? s.pos;
      const boost = boostQueCabe(camera, width, height, haversine(s.pos, alvo), s.pos.lat);
      const zoomParada = Math.min(zoomEfetivo(camera) + boost, maxZoom);
      const angulo = chase?.gira ? -s.heading : 0;
      const alturaQ = chase ? CHASE_ALTURA : 0.5;
      const matriz = vistaDe({
        centro: s.pos,
        zoom: zoomParada,
        width,
        height,
        maxZoom,
        altura: alturaQ,
        angulo,
        tilt: chase ? fatorDeTilt(camera) : 1,
      });
      const peso = Math.min(1, pesoQueCabe(matriz, s.pos, alvo, alturaQ, width, height));
      const centro = {
        lat: s.pos.lat + (alvo.lat - s.pos.lat) * peso,
        lng: s.pos.lng + (alvo.lng - s.pos.lng) * peso,
      };
      const v = vista(centro, zoomParada, s.heading, true);
      if (map.size + novosDaVista(v) > TILE_BUDGET) break;
      despejar(v);
      /*
       * A aproximação passa por cada nível inteiro até o pico: sem eles, o meio
       * da aproximação pedia blocos que o aquecimento não tinha — e esses
       * ficavam congelados no nível anterior até o fim do vídeo.
       */
      pushEscada(centro, zoom, zoomParada, s.heading, true);
    }
  }
  return Array.from(map.values());
}

/** `n` itens igualmente espaçados de uma lista, mantendo as pontas. */
function spread<T>(lista: T[], n: number): T[] {
  if (lista.length <= n) return lista;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(lista[Math.round((i * (lista.length - 1)) / (n - 1))]);
  return out;
}

/**
 * Os servidores gratuitos (OSM, CyclOSM, OpenTopoMap) pedem uso moderado.
 * Acima deste limite sugerimos diminuir o zoom em vez de baixar milhares
 * de tiles de uma vez.
 */
export const TILE_BUDGET = 1400;

/**
 * Quantas paradas ganham uma vista própria (mais aproximada) no aquecimento.
 *
 * O ganho de zoom em cada parada custa blocos de um nível acima, e só as
 * primeiras paradas fazem diferença na conta: numa rota com cinquenta, aproximar
 * em todas dobraria o custo nos servidores gratuitos.
 */
export const LIMITE_VISTAS_DE_PARADA = 8;

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

type Camera = { lat: number; lng: number; zoom: number };

/**
 * Constante de tempo da virada do personagem (segundos de vídeo).
 *
 * Começou em 0,25 s e o usuário ainda viu "brusco" — pediu para suavizar mais.
 * Em 0,6 s a esquina é feita como quem realmente vira o corpo: o rumo começa a
 * mudar antes de o traçado mudar de direção e termina depois.
 */
const RUMO_TAU_S = 0.5;

/**
 * Teto da velocidade de giro (graus por segundo de vídeo).
 *
 * É uma **rede de segurança**, não o mecanismo: com o rumo já suavizado na
 * distância (ver `rumoSuave`), a virada acontece em rampa e o teto quase nunca
 * entra. Ele existe para o primeiro quadro (quando ainda não há rumo anterior) e
 * para um traçado com uma volta fechada, onde nenhum filtro esperto evita um
 * giro grande — e girar o mapa a 120°/s (o valor antigo) era justamente o
 * "pulo" que o usuário viu a cada curva.
 */
const RUMO_MAX_GRAUS_S = 90;

/**
 * Tamanho da janela do rumo, em **segundos de vídeo**.
 *
 * A suavização tem de ser medida no tempo de tela, não em metros: a mesma rota
 * vira 3 km/s de caminhada num vídeo de 7 s e 30 m/s num vídeo de 10 min, e uma
 * janela de 30 m daria uma virada suave num caso e um salto no outro.
 *
 * O número foi escolhido medindo: com 1,6 s, uma quina de 90° é feita em ~1,6 s
 * de vídeo e o giro mais rápido do quadro fica em ~1,9° (57°/s) com aceleração
 * de 0,11°/quadro². Menos que isso (0,5 s) e o teto de giro volta a entrar em
 * 14% dos quadros — era o "pulo"; mais que isso (2,6 s) e o personagem aponta
 * para a média de um trecho longo demais, atrasando a virada.
 */
const RUMO_JANELA_S = 1.6;

/** Meia-janela da suavização em metros, para um traçado e um percurso dados. */
export function janelaDoRumo(totalM: number, percursoS: number): number {
  const s = Number.isFinite(percursoS) && percursoS > 0 ? percursoS : 10;
  const m = Number.isFinite(totalM) && totalM > 0 ? totalM : 0;
  return Math.max(1, (m / s) * RUMO_JANELA_S);
}

/**
 * Constante de tempo da inclinação do corpo na curva (segundos de vídeo).
 *
 * Menor que a da virada: o corpo acompanha a curva de perto — o que se tira
 * aqui é o degrau, não a resposta.
 */
const INCLINACAO_TAU_S = 0.35;

/** Constante de tempo da câmera que acompanha o personagem (segundos). */
const CAM_TAU_FOLLOW = 0.24;
/** A câmera parada ("Rota toda") não precisa de tanta pressa. */
const CAM_TAU_FIT = 0.36;
/** O zoom anda um pouco mais devagar que a posição (evita o "respiro" na parada). */
const CAM_TAU_ZOOM = 0.2;

export class SceneRenderer {
  private cam: Camera | null = null;
  /** o rumo do quadro anterior (ver `suavizarRumo`) */
  private rumoSuave: number | null = null;
  /** a inclinação do corpo no quadro anterior (ver `suavizarInclinacao`) */
  private inclinacaoSuave: number | null = null;
  private instanteAnterior: number | null = null;
  private store: TileStore;
  /**
   * Blocos travados no nível anterior durante a gravação (ver `blocoDoQuadro`).
   * Nulo fora da gravação.
   */
  private congelados: Set<string> | null = null;
  /** pontos visíveis já projetados, reaproveitados entre os quadros */
  private px = new Float64Array(0);
  private py = new Float64Array(0);

  constructor(
    basemap: BasemapId,
    relevo = false,
  ) {
    this.store = new TileStore(basemap, relevo);
  }

  get tiles() {
    return this.store;
  }

  /**
   * O rumo suavizado que o último quadro usou (graus; `null` antes do primeiro).
   *
   * É o estado por trás da virada do personagem. Exposto porque medir isso
   * pelas chamadas de desenho mistura tudo o que gira no quadro — a seta, o
   * emoji e a **inclinação da curva** —, e um teste que soma os três não
   * consegue dizer qual deles mudou.
   */
  get rumoDoQuadro(): number | null {
    return this.rumoSuave;
  }

  /** A inclinação do corpo que o último quadro desenhou (graus). */
  get inclinacaoDoQuadro(): number | null {
    return this.inclinacaoSuave;
  }

  /** quantos tiles já estão prontos para desenhar */
  get loadedTiles(): number {
    return this.store.loadedCount;
  }

  setBasemap(basemap: BasemapId) {
    if (this.store.basemap === basemap) return;
    this.store = new TileStore(basemap, this.store.relevo);
  }

  /**
   * Liga/desliga o sombreado do relevo — e **descarta** o cache quando muda.
   *
   * Sem descartar, metade do vídeo sairia com relevo (os blocos já baixados
   * com ele) e metade sem. Numa rota com relevo ligado os blocos são outros, e
   * o aquecimento vai baixá-los antes de gravar.
   */
  setRelevo(ligado: boolean) {
    if (this.store.relevo === ligado) return;
    this.store = new TileStore(this.store.basemap, ligado);
  }

  /**
   * Durante a gravação, o mapa não troca de bloco: o que entrou no quadro fica.
   * `false` devolve o comportamento normal.
   */
  congelarBlocos(ligado = true) {
    this.congelados = ligado ? new Set() : null;
  }

  /** Quantos blocos saíram do nível anterior por não estarem prontos. */
  get blocosDeReserva(): number {
    return this.congelados?.size ?? 0;
  }

  reset() {
    this.cam = null;
    this.rumoSuave = null;
    this.inclinacaoSuave = null;
    this.instanteAnterior = null;
  }

  /**
   * O rumo do traçado, virado **suave**.
   *
   * O rumo entre dois pontos do arquivo muda de degrau em degrau; desenhado
   * cru, o personagem (e o mapa, na terceira pessoa) girava de uma vez a cada
   * degrau — é boa parte do "robótico" que o usuário viu. Aqui a virada é
   * distribuída em ~0,25 s de vídeo, e o tempo vem do próprio `elapsed`: a
   * prévia e o vídeo gravado continuam idênticos, e o resultado não depende da
   * taxa de quadros (30 ou 60 quadros/s dão a mesma virada).
   */
  /**
   * Quanto tempo passou desde o quadro anterior, em segundos de vídeo.
   *
   * O filtro do rumo e a suavização da câmera mediam o tempo **em quadros**:
   * com os mesmos números, o vídeo a 60 quadros/s virava suave e o de 30 ficava
   * com o dobro do atraso — e a prévia (que roda a ~60) não batia com a
   * gravação. Aqui o tempo é o do próprio `elapsed`, então o resultado é o
   * mesmo em qualquer taxa (com teto de 0,5 s: um quadro perdido não pode
   * virar um salto).
   */
  private avancarTempo(elapsed: number): number {
    const anterior = this.instanteAnterior;
    this.instanteAnterior = elapsed;
    if (anterior === null) return 0;
    return Math.max(0, Math.min(0.5, elapsed - anterior));
  }

  /**
   * A inclinação do corpo na curva, suavizada no tempo.
   *
   * `inclinacaoDaCurva` olha 30 m de traçado para trás e para frente: quando o
   * índice muda de ponto, o ângulo muda de degrau — e, desenhado cru, o corpo
   * entortava de uma vez a cada ponto (era o "brusco nas curvas" que o usuário
   * viu). Com o mesmo filtro do rumo, a curva é feita como quem realmente
   * inclina o corpo, e não como quem bate num batente.
   */
  private suavizarInclinacao(alvo: number, dt: number): number {
    if (this.inclinacaoSuave === null || dt <= 0) {
      this.inclinacaoSuave = alvo;
      return alvo;
    }
    const k = 1 - Math.exp(-dt / INCLINACAO_TAU_S);
    this.inclinacaoSuave += (alvo - this.inclinacaoSuave) * k;
    return this.inclinacaoSuave;
  }

  private suavizarRumo(heading: number, dt: number): number {
    if (this.rumoSuave === null || dt <= 0) {
      this.rumoSuave = heading;
      return heading;
    }
    const k = 1 - Math.exp(-dt / RUMO_TAU_S);
    let d = heading - this.rumoSuave;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    // o filtro dá o formato da virada; o teto impede o giro seco de um quadro
    const passo = d * k;
    const limite = RUMO_MAX_GRAUS_S * dt;
    this.rumoSuave += Math.max(-limite, Math.min(limite, passo));
    return this.rumoSuave;
  }

  /** pré-carrega as imagens usadas na animação (retorna promise que resolve ao final) */
  /**
   * Baixa, antes de gravar, **todos os blocos que a animação vai desenhar**.
   *
   * O `foco` é o mesmo que o desenho usa (`focoDasParadas`): sem ele, as vistas
   * das paradas eram baixadas no ponto da **rota** e o vídeo chegava no lugar da
   * parada — o pino arrastado para fora da linha — com os blocos faltando. Era
   * o mapa aparecendo aos pedaços durante a gravação, que é justamente o que o
   * usuário pediu para resolver ("entender a rota, baixar todo o mapa necessário
   * para depois criar o vídeo").
   */
  /** Os blocos únicos que a animação inteira vai desenhar. */
  private refsDaAnimacao(
    track: Track,
    camera: CameraConfig,
    width: number,
    height: number,
    foco?: FocusPoint | null,
  ): TileRef[] {
    const refs = tilesForAnimation(
      track,
      camera,
      width,
      height,
      this.store.basemap,
      camera.cinematic,
      foco,
    );
    const seen = new Set<string>();
    return refs.filter((r) => {
      const k = `${r.z}/${r.x}/${r.y}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** baixa uma lista de blocos, seis de cada vez (uso moderado dos servidores) */
  private async baixar(refs: TileRef[], onProgress: (p: number) => void): Promise<void> {
    let done = 0;
    const load = (ref: TileRef) =>
      this.store
        .fetchTile(ref.z, ref.x, ref.y)
        .then((img) => {
          if (img) this.store.put(ref.z, ref.x, ref.y, img);
        })
        .catch(() => undefined)
        .finally(() => {
          done++;
          onProgress(Math.min(0.97, done / Math.max(1, refs.length)));
        });
    const concurrency = 6;
    let cursor = 0;
    const workers = new Array(Math.min(concurrency, Math.max(1, refs.length)))
      .fill(0)
      .map(async () => {
        while (cursor < refs.length) {
          const ref = refs[cursor++];
          await load(ref);
        }
      });
    await Promise.all(workers).then(() => undefined);
  }

  async warmup(
    track: Track,
    camera: CameraConfig,
    width: number,
    height: number,
    onProgress: (p: number) => void,
    foco?: FocusPoint | null,
  ): Promise<void> {
    const unique = this.refsDaAnimacao(track, camera, width, height, foco);
    await this.baixar(unique, onProgress);

    // segunda passada: tiles que falharam por instabilidade de rede
    const missing = unique.filter((r) => !this.store.get(r.z, r.x, r.y));
    if (missing.length > 0 && missing.length < unique.length) {
      await new Promise((r) => setTimeout(r, 250));
      await this.baixar(
        missing.filter((r) => isFailedTile(r.url)),
        () => undefined,
      );
    }
    onProgress(1);
  }

  /**
   * Prepara o mapa **antes** de gravar e conta o que ficou faltando.
   *
   * O `warmup` já baixava tudo, mas um bloco que o servidor recusa (limite de
   * uso dos servidores gratuitos, instabilidade) ficava faltando em silêncio: o
   * usuário só descobria no fim da gravação, com o painel dizendo "233 blocos
   * saíram do nível anterior". Aí não há mais o que fazer — o vídeo já está
   * pronto e o mapa está borrado nele.
   *
   * Aqui a falha tem segunda e terceira chance, com espera crescente (os
   * servidores gratuitos recusam rajadas e aceitam de novo em instantes), e o
   * que sobrar é **contado antes do primeiro quadro** — o app pode avisar em vez
   * de descobrir depois.
   */
  async preparar(
    track: Track,
    camera: CameraConfig,
    width: number,
    height: number,
    onProgress: (p: number) => void,
    foco?: FocusPoint | null,
  ): Promise<{ total: number; faltando: number }> {
    const unique = this.refsDaAnimacao(track, camera, width, height, foco);
    const faltamAgora = () => unique.filter((r) => !this.store.get(r.z, r.x, r.y));

    await this.baixar(unique, onProgress);

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const faltam = faltamAgora();
      if (faltam.length === 0) break;
      // rede fora do ar não melhora esperando: desiste depois da 1ª rodada
      if (faltam.length === unique.length && tentativa > 0) break;
      await new Promise((r) => setTimeout(r, 300 * (tentativa + 1)));
      await this.baixar(faltam, () => undefined);
    }

    onProgress(1);
    const faltando = faltamAgora().length;
    return { total: unique.length, faltando };
  }

  /**
   * O mapa em miniatura: a rota inteira pequena no canto, com o que já foi
   * percorrido em destaque.
   *
   * Ele usa **os mesmos blocos do mapa** (no zoom em que a rota inteira cabe),
   * e não um desenho esquemático: o formato das ruas é o que faz o mini mapa ser
   * reconhecível como "o mapa do percurso". Esses blocos são baixados no
   * aquecimento (`tilesForAnimation`) e não mudam durante o vídeo — o único
   * movimento é a linha percorrida e o ponto do personagem.
   */
  /**
   * O perfil de elevação do traçado, calculado **uma vez** por traçado.
   *
   * O desenho roda 60 vezes por segundo: varrer 5.700 pontos a cada quadro
   * derrubaria a cadência que levou vinte rodadas para acertar. O perfil só
   * depende do traçado (não do instante), então o cache é por referência.
   */
  private perfil: { track: Track | null; dados: TrailProfile | null } = {
    track: null,
    dados: null,
  };

  private perfilDo(track: Track): TrailProfile | null {
    if (this.perfil.track !== track) {
      this.perfil = { track, dados: trailProfile(track) };
    }
    return this.perfil.dados;
  }

  /**
   * A rampa ponto a ponto, calculada **uma vez** por traçado.
   *
   * É a mesma série que pinta a rota por inclinação (`slopeSeries`): o número
   * que o HUD mostra numa rota sem horário tem de ser o da cor da linha embaixo
   * do personagem. E é caro — média móvel sobre o traçado inteiro —, então não
   * pode ser refeita a cada quadro.
   */
  private declives: { track: Track | null; series: number[] } = { track: null, series: [] };

  /**
   * Os destaques do percurso, calculados **uma vez** por (traçado, horas).
   *
   * `parciais` percorre o traçado inteiro para medir a cobertura das horas em
   * cada trecho; isso não pode acontecer 30 vezes por segundo.
   */
  private destaquesCache: {
    track: Track | null;
    times: number[] | null;
    pace: boolean;
    lista: Destaque[];
  } = { track: null, times: null, pace: false, lista: [] };

  private destaquesDo(
    track: Track,
    times: number[] | null,
    pace: boolean,
    perfil: TrailProfile | null,
  ): Destaque[] {
    const c = this.destaquesCache;
    if (c.track !== track || c.times !== times || c.pace !== pace) {
      this.destaquesCache = {
        track,
        times,
        pace,
        lista: destaques({ track, times, perfil, pace }),
      };
    }
    return this.destaquesCache.lista;
  }

  private declivesDo(track: Track): number[] {
    if (this.declives.track !== track) {
      this.declives = { track, series: slopeSeries(track.pts, cumDoDesenho(track)) };
    }
    return this.declives.series;
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    input: FrameState,
    sample: Sample,
    onDark: boolean,
    abaixoDe: number,
  ) {
    const { style, track } = input;
    const pts = track.pts;
    if (pts.length < 2) return;

    const bm = BASEMAPS[style.basemap];
    const sf = Math.max(0.55, Math.min(1.6, Math.min(width, height) / 720));
    const L = minimapLayout(width, height, abaixoDe);
    const b = boundsOf(pts);
    const centro = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };

    /*
     * Só o **contorno**: nada de blocos de mapa no fundo.
     *
     * A primeira versão baixava o mapa inteiro em miniatura e desenhava aqui
     * também — no vídeo do usuário o canto ficou pesado e poluído, e ele pediu o
     * oposto ("coloca só o contorno, não precisa do mapa no fundo"). O desenho
     * esquemático é mais legível justamente por não ter ruas atrás: o que
     * interessa é a forma do percurso e onde o personagem está nele.
     *
     * De quebra, o aquecimento não precisa mais pedir os blocos deste zoom.
     */
    ctx.save();
    roundRect(ctx, L.x, L.y, L.w, L.h, L.raio);
    ctx.fillStyle = onDark ? "rgba(9,12,20,0.62)" : "rgba(255,255,255,0.78)";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14 * sf;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.save();
    roundRect(ctx, L.x, L.y, L.w, L.h, L.raio);
    ctx.clip();

    /*
     * A vista é montada com o tamanho **da caixa** (e não do quadro): assim a
     * rota inteira cabe no canto, e a matriz já sai com a origem nele.
     */
    const zoom = Math.min(fitZoom(b, L.w, L.h, 0.1), bm.maxZoom);
    const vista = vistaDe({ centro, zoom, width: L.w, height: L.h, maxZoom: bm.maxZoom });

    /** pixel do quadro para um ponto da rota, já deslocado para dentro da caixa */
    const tela = (p: LatLng) => {
      const w = project(p.lat, p.lng, vista.z);
      return {
        x: L.x + vista.a * w.x + vista.c * w.y + vista.e,
        y: L.y + vista.b * w.x + vista.d * w.y + vista.f,
      };
    };

    // a rota inteira, apagada: é o "onde eu estou" que o minimapa responde
    const passo = Math.max(1, Math.ceil(pts.length / 320));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let primeiro = true;
    for (let i = 0; i < pts.length; i += passo) {
      const p = tela(pts[i]);
      if (primeiro) {
        ctx.moveTo(p.x, p.y);
        primeiro = false;
      } else ctx.lineTo(p.x, p.y);
    }
    const fim = tela(pts[pts.length - 1]);
    ctx.lineTo(fim.x, fim.y);
    ctx.strokeStyle = hexA(style.accent, onDark ? 0.4 : 0.32);
    ctx.lineWidth = Math.max(1.6, 2.4 * sf);
    ctx.stroke();

    // o percorrido, na cor do app
    const ate = Math.max(0, Math.min(pts.length - 1, sample.index));
    ctx.beginPath();
    ctx.moveTo(tela(pts[0]).x, tela(pts[0]).y);
    for (let i = 1; i <= ate; i++) {
      const p = tela(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
    const atual = tela(sample.pos);
    ctx.lineTo(atual.x, atual.y);
    ctx.strokeStyle = hexA(style.accent, 1);
    ctx.lineWidth = Math.max(2.2, 3.2 * sf);
    ctx.stroke();

    // partida e chegada
    const ponta = (p: LatLng, cor: string) => {
      const q = tela(p);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(2.6, 3.4 * sf), 0, Math.PI * 2);
      ctx.fillStyle = cor;
      ctx.fill();
    };
    ponta(pts[0], "#22c55e");
    ponta(pts[pts.length - 1], "#f87171");

    // o personagem
    ctx.beginPath();
    ctx.arc(atual.x, atual.y, Math.max(5, 6.4 * sf), 0, Math.PI * 2);
    ctx.fillStyle = onDark ? "rgba(9,12,20,0.85)" : "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(atual.x, atual.y, Math.max(5, 6.4 * sf), 0, Math.PI * 2);
    ctx.strokeStyle = hexA(style.accent, 1);
    ctx.lineWidth = Math.max(2, 2.6 * sf);
    ctx.stroke();

    ctx.restore();
    // moldura
    roundRect(ctx, L.x, L.y, L.w, L.h, L.raio);
    ctx.strokeStyle = hexA(style.accent, 0.6);
    ctx.lineWidth = 1.5 * sf;
    ctx.stroke();
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, input: FrameState) {
    const { track, t, camera, style } = input;
    if (track.pts.length === 0) return;

    const bm = BASEMAPS[style.basemap];
    const maxZoom = bm.maxZoom;

    const sample = sampleTrack(track, t);
    /*
     * O rumo que vale no quadro: o do traçado, mas **suavizado**.
     *
     * O rumo entre dois pontos do arquivo muda de degrau em degrau, e a cada
     * degrau o personagem (e o mapa, na terceira pessoa) virava de uma vez — o
     * "robótico" que o usuário viu tem muito disso. Com o filtro, a virada
     * acontece em ~0,25 s: o mesmo caminho, sem o tranco.
     */
    const dt = this.avancarTempo(input.elapsed);

    /*
     * --- o rumo do quadro ---
     *
     * Duas suavizações em série, e cada uma tira um degrau diferente:
     *
     * 1. **na distância** (`rumoSuave`): a direção do segmento atual é uma
     *    escada, e a cada quina do traçado ela salta de uma vez. A média das
     *    direções numa janela de ~0,5 s de vídeo para cada lado é contínua — o
     *    degrau simplesmente não existe mais;
     * 2. **no tempo** (`suavizarRumo`): a janela deslizante ainda tem quinas na
     *    derivada (a direção média muda mais depressa no meio da curva), e o
     *    filtro de tempo dá a inércia de quem realmente vira o corpo.
     *
     * Era aqui que estava o "a cada curva parece que está pulando a imagem": com
     * o alvo em degraus, o teto de giro entrava em 21% dos quadros de uma rota
     * em zigue-zague, e o mapa girava a 120°/s em rampa.
     */
    const tl = timelineOr(input.timeline, input.duration);
    const rumo = this.suavizarRumo(
      rumoSuave(track, t, janelaDoRumo(track.total, tl.percurso)),
      dt,
    );

    // --- câmera (alvo puro + suavização) ---
    /*
     * Para onde a câmera vai na ênfase de uma parada: **o lugar**, e não o ponto
     * da rota.
     *
     * O ponto tem endereço próprio quando o usuário escolheu um lugar para ele
     * (a parada pode ficar fora da linha — é o que o selo "⤷ 240 m" no mapa
     * avisa). Indo para o ponto da rota, o zoom da ênfase (2,2 níveis) jogava o
     * ícone **para fora do quadro** justamente no instante em que a parada é
     * anunciada: medido numa parada a 440 m da linha, em 1280x720, o ícone saía
     * 1.321 px acima do centro da tela. O pedido é "só um zoom e focar no ícone
     * do ponto" — então a câmera vai até o ícone.
     */
    const focoDaParada = focoDasParadas(input.stops, input.passages ?? undefined, track);

    /*
     * O alvo da câmera é avaliado alguns décimos de segundo **à frente** do
     * relógio do vídeo.
     *
     * A câmera suaviza o alvo (as constantes `CAM_TAU_*`), então o que aparece no
     * vídeo chega atrasado. Medido com o GPX do usuário (21,4 km, 8 paradas,
     * 30 quadros por segundo, 1080x1920: o pico do zoom **desenhado** comparado
     * com o ponto da parada):
     *
     * | avanço do alvo | pico do zoom desenhado |
     * |---|---|
     * | 0 s | 297 m **depois** do ponto |
     * | **0,1 s** | **0 m** |
     * | 0,15 s | 198 m antes |
     * | 0,3 s | 594 m antes |
     *
     * Com um décimo de segundo, o pico do zoom que o usuário vê cai **em cima do
     * ponto** — que é o pedido: "focar no ícone do ponto".
     */
    const AVANCO_S = 0.1;
    const tDoAlvo = tl.percurso > 0 ? Math.min(1, t + AVANCO_S / tl.percurso) : t;

    const target = cameraTarget({
      track,
      t: tDoAlvo,
      camera,
      width,
      height,
      maxZoom,
      elapsed: input.elapsed,
      duration: input.duration,
      routeSeconds: tl.percurso,
      stopPos: focoDaParada,
    });

    if (!this.cam) this.cam = { lat: target.lat, lng: target.lng, zoom: target.zoom };
    /*
     * Suavização da câmera medida em **tempo**, não em quadros.
     *
     * O número era 0,16 por quadro: isso é um atraso de ~0,19 s a 30 quadros/s e
     * de ~0,1 s a 60 — o mesmo vídeo saía diferente conforme o navegador. Agora
     * a constante de tempo vale em segundos de vídeo (um pouco mais longa que
     * antes, porque o movimento tinha tranco), e durante a abertura o alvo já é
     * uma animação pronta: ali a câmera vai junto, sem suavizar de novo.
     */
    const abrindo = target.opening < 1;
    const k = abrindo
      ? 1
      : 1 - Math.exp(-dt / (camera.mode === "follow" ? CAM_TAU_FOLLOW : CAM_TAU_FIT));
    const kZoom = abrindo ? 1 : 1 - Math.exp(-dt / CAM_TAU_ZOOM);
    this.cam.lat += (target.lat - this.cam.lat) * k;
    this.cam.lng += (target.lng - this.cam.lng) * k;
    this.cam.zoom += (target.zoom - this.cam.zoom) * kZoom;

    /*
     * A vista do quadro — com o enquadramento e o giro da **terceira pessoa**.
     *
     * `altura` desce o personagem na tela (a câmera fica atrás e acima dele) e
     * `angulo` gira o mapa de verdade (o caminho sempre "para cima"). Os dois
     * entram junto com a abertura: o voo panorâmico continua centrado e de
     * norte para cima, e o giro "pousa" com a câmera.
     */
    const chase = camera.mode === "follow" ? camera.chase ?? null : null;
    /**
     * A inclinação do quadro entra junto com o pouso do voo.
     *
     * Durante a abertura a câmera está no alto olhando a região de cima (uma
     * vista de mapa, sem horizonte); inclinar ali só estragaria o voo. Ela entra
     * no pouso, com a terceira pessoa, e daí não sai mais.
     */
    const tiltAlvo = chase ? fatorDeTilt(camera) : 1;
    const tilt = 1 + (tiltAlvo - 1) * (chase ? target.opening : 0);
    /**
     * Onde o quadro é ancorado.
     *
     * Na terceira pessoa o centro é a **posição do personagem**, e não a câmera
     * suavizada: era isso que estragava o enquadramento. A suavização é um
     * atraso de propósito — com ela no centro, o personagem voltava para o meio
     * da tela e a "câmera atrás" desaparecia. Ancorado nele, o personagem fica
     * **sempre** a 68% da altura, com a estrada à frente ocupando o resto do
     * quadro; o movimento contínuo vem da própria posição do personagem, que já
     * é uma amostra suave do traçado. O zoom continua suavizado.
     *
     * Durante o voo de abertura nada disso vale: a câmera segue o seu próprio
     * caminho (é ele que pousa) e o enquadramento entra junto com o pouso.
     *
     * **A ênfase da parada é a exceção**: ali o quadro desliza até o ponto, que
     * é o pedido do usuário ("só um zoom e focar no ícone do ponto"). O peso é a
     * própria força da aproximação (`target.boost`) e o deslocamento sai da
     * câmera já suavizada (`this.cam`, que está indo para o ponto) — então o
     * ícone entra na linha da câmera sem tranco, e o personagem volta para baixo
     * do quadro quando a ênfase acaba. Sem a ênfase o peso é zero e nada muda.
     */
    const posou = target.opening >= 1;
    const ancorarNoPersonagem = !!chase && posou;
    /** a altura em que o personagem cai no quadro (0,5 = centro) */
    const altura = 0.5 + (CHASE_ALTURA - 0.5) * (chase ? target.opening : 0);
    /** o giro que o mapa recebe neste quadro (0 = norte para cima) */
    const anguloMapa = chase?.gira ? -rumo * target.opening : 0;

    /*
     * A vista é montada em duas etapas: a **matriz** (zoom, giro e inclinação)
     * não depende do centro, e é ela que diz, em pixels, o quanto o personagem
     * andaria na tela se o quadro fosse inteiro até a câmera. Com isso o peso
     * do deslocamento é limitado de modo que ele **nunca saia da moldura** — a
     * câmera puxa o quadro na direção do ponto da parada até onde der, e não
     * até o fim quando o pino está longe da linha.
     */
    const matriz = vistaDe({
      centro: sample.pos,
      zoom: this.cam.zoom,
      width,
      height,
      maxZoom,
      altura,
      angulo: anguloMapa,
      tilt,
    });
    const pesoIdeal = ancorarNoPersonagem ? target.boost : 1;
    const seguir = posou
      ? Math.min(pesoIdeal, pesoQueCabe(matriz, sample.pos, this.cam, altura, width, height))
      : pesoIdeal;
    const centro = posou
      ? {
          lat: sample.pos.lat + (this.cam.lat - sample.pos.lat) * seguir,
          lng: sample.pos.lng + (this.cam.lng - sample.pos.lng) * seguir,
        }
      : this.cam;
    const vista = vistaDe({
      centro,
      zoom: this.cam.zoom,
      width,
      height,
      maxZoom,
      altura,
      angulo: anguloMapa,
      tilt,
    });
    const { z, s, x0, y0, x1, y1 } = vista;
    const projeta = projetorDaVista(vista);
    const toXY = (p: LatLng) => {
      const w = project(p.lat, p.lng, z);
      return projeta(w.x, w.y);
    };

    /** estilos escuros precisam de contraste claro nas linhas */
    const onDark = style.basemap === "dark" || style.basemap === "satellite";
    const scale = Math.min(width, height) / 720;
    const sf = Math.max(0.55, Math.min(1.6, scale));

    /**
     * Janela visível em coordenadas geográficas.
     *
     * Os cantos do canvas viram lat/lng pelo inverso da projeção (4 chamadas por
     * quadro) e daí sai a caixa usada para descartar o traçado fora de tela, com
     * folga para o traço grosso e o brilho não cortarem na borda.
     */
    const margemPx = 20 * sf;
    const larguraJanela = (x1 - x0) * s;
    const alturaJanela = (y1 - y0) * s;
    const cantoA = unproject(x0, y0, z);
    const cantoB = unproject(x1, y1, z);
    const dLat = cantoA.lat - cantoB.lat;
    const dLng = cantoB.lng - cantoA.lng;
    const janela: Bounds = {
      north: cantoA.lat + (margemPx * dLat) / alturaJanela,
      south: cantoB.lat - (margemPx * dLat) / alturaJanela,
      west: cantoA.lng - (margemPx * dLng) / larguraJanela,
      east: cantoB.lng + (margemPx * dLng) / larguraJanela,
    };


    // --- fundo + tiles ---
    ctx.save();
    ctx.fillStyle = bm.bg;
    ctx.fillRect(0, 0, width, height);
    /*
     * Os blocos são desenhados com a origem **no canto da vista**.
     *
     * As coordenadas do mundo no zoom do mapa são enormes (dezenas de milhões):
     * somadas na matriz, elas estouram a precisão do rasterizador — a borda de
     * dois blocos vizinhos cai fora do lugar e o fundo do mapa aparece como um
     * fio de 1 px. Medido numa tela 1080x1920 com a inclinação da terceira
     * pessoa: **uma linha inteira do quadro** (832 px de fundo à mostra numa
     * emenda). Tirando a origem da conta, os números ficam na casa dos milhares
     * e a emenda fecha.
     */
    const origemX = Math.floor(vista.x0 / TILE_SIZE) * TILE_SIZE;
    const origemY = Math.floor(vista.y0 / TILE_SIZE) * TILE_SIZE;
    ctx.setTransform(
      vista.a,
      vista.b,
      vista.c,
      vista.d,
      vista.e + vista.a * origemX + vista.c * origemY,
      vista.f + vista.b * origemX + vista.d * origemY,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const [tz, tx, ty] of tilesDaVista(vista)) {
      this.store.request(tz, tx, ty);
      const r = retanguloDoBloco(vista, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
      /*
       * O bloco deste nível, quando não chegou (a câmera acabou de mudar de
       * zoom), é coberto pelo do nível anterior esticado — o buraco no meio do
       * quadro era o "mapa pulando" na aproximação das paradas. Durante a
       * gravação quem já caiu no nível anterior fica nele (`blocoDoQuadro`):
       * trocar de imagem no meio do vídeo é o pulo que o usuário vê.
       */
      const escolha = blocoDoQuadro(this.store, tz, tx, ty, this.congelados);
      if (escolha && "img" in escolha) {
        ctx.drawImage(escolha.img as CanvasImageSource, r.x - origemX, r.y - origemY, r.w, r.h);
        continue;
      }
      const pai = escolha?.reserva ?? null;
      if (pai) {
        ctx.drawImage(
          pai.img as CanvasImageSource,
          pai.sx,
          pai.sy,
          pai.sw,
          pai.sh,
          r.x - origemX,
          r.y - origemY,
          r.w,
          r.h,
        );
      }
    }
    ctx.restore();

  /*
   * A cartela final é **medida** antes de qualquer desenho: o pino da chegada
   * precisa saber onde ela vai cair para sair de baixo. Antes ela era desenhada
   * por último (por cima) e cobria o pino B, o nome e a foto da chegada.
   *
   * E ela mesma sai da frente das duas pontas: a chegada costuma acontecer no
   * meio da tela, que é onde a cartela nasce (o usuário viu a cartela em cima do
   * ponto B). O raio cobre o pino, o nome e a foto do lugar — o pino é o que não
   * pode sumir atrás do painel.
   */
  /**
   * Raio do selo do pino na tela, com folga — o pino tem 17, e o bloco da
   * parada não deve encostar nele nem no miolo da foto.
   */
  const RAIO_DO_SELO = 40;
  const lugaresDasPontas: { x: number; y: number; r: number }[] = [];
  if (style.showEndpoints && track.pts.length > 1) {
    for (const p of [track.pts[0], track.pts[track.pts.length - 1]]) {
      const t = toXY(p);
      if (t.x > -60 && t.x < width + 60 && t.y > -60 && t.y < height + 60) {
        lugaresDasPontas.push({ x: t.x, y: t.y, r: 104 * sf });
      }
    }
  }
  const cartao = style.showSummary
    ? summaryBox(ctx, width, height, input, sf, lugaresDasPontas)
    : null;
  const retanguloDaCartela = (L: SummaryLayout) => ({
    x: L.boxX,
    y: L.boxY,
    w: L.boxW,
    h: L.boxH,
    forca: L.alpha,
  });

    /** cor por velocidade/inclinação, quando o app calculou */
    const colored =
      input.colored && input.colored.bands.length === track.pts.length ? input.colored : null;
    // só os trechos dentro da janela: o traçado inteiro seria projetado à toa
    const planejados = track.pts.length > 1 ? visibleRuns(track.pts, janela) : [];

    /**
     * Pontos visíveis projetados **uma única vez**.
     *
     * A linha colorida é desenhada em nove passadas; se cada uma projetasse os
     * seus pontos de novo, um percurso longo na vista da "Rota toda" faria
     * dezoito mil projeções por quadro. Com o quadro projetado em vetores
     * reaproveitados (sem alocar a cada quadro), as passadas só leem índices.
     */
    if (colored && planejados.length > 0) {
      if (this.px.length < track.pts.length) {
        this.px = new Float64Array(track.pts.length);
        this.py = new Float64Array(track.pts.length);
      }
      for (const [ini, fim] of planejados) {
        for (let i = ini; i <= fim; i++) {
          const p = toXY(track.pts[i]);
          this.px[i] = p.x;
          this.py[i] = p.y;
        }
      }
    }
    const projetado: PontoProjetado | null =
      colored && planejados.length > 0 ? { x: this.px, y: this.py } : null;

    // --- rota planejada ---
    if (style.showRoute && track.pts.length > 1) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // a sombra por baixo separa a linha do mapa nos dois casos
      pathOf(ctx, track.pts, toXY, planejados);
      ctx.strokeStyle = onDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)";
      ctx.lineWidth = 13 * sf;
      ctx.setLineDash([]);
      ctx.stroke();
      if (colored && projetado) {
        // o trecho que ainda não foi percorrido fica esmaecido
        strokeColored(ctx, projetado, planejados, colored, 4 * sf, 0.52);
      } else {
        ctx.strokeStyle = onDark ? "rgba(255,255,255,0.55)" : "rgba(15,23,42,0.5)";
        ctx.lineWidth = 4 * sf;
        ctx.setLineDash([10 * sf, 9 * sf]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- trecho percorrido ---
    if (style.showTraveled && track.pts.length > 1) {
      /*
       * O rastro vai até o **começo do segmento atual** e fecha no personagem
       * (`cur`, abaixo).
       *
       * Com `index + 1` ele ia até o fim do segmento: em trecho de cidade são
       * metros e ninguém vê, mas num traçado de poucos pontos — travessia — o
       * segmento tem milhares de km e o rastro pintava a rota inteira, inclusive
       * o que ainda falta, com a cor do percorrido.
       */
      const upto = Math.min(sample.index, track.pts.length - 1);
      /*
       * O trecho percorrido cresce com a animação, então leva o mesmo corte —
       * mas precisa de **uma âncora**, senão o traço não existe.
       *
       * `pathOf` só liga o personagem ao último ponto traçado; `visibleRuns`
       * devolve *segmentos*, e num traçado de poucos pontos (travessia) nenhum
       * segmento inteiro cai na tela. A lista vazia deixava o caminho só com o
       * `moveTo` no personagem: **o percurso não aparecia preenchido**. Numa rota
       * de cidade isso dura um quadro; numa travessia é o vídeo inteiro.
       */
      const vistos = visibleRuns(track.pts, janela, upto);
      const percorridos: IndexRange[] = vistos.length > 0 ? vistos : [[upto, upto]];
      const cur = toXY(sample.pos);
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      pathOf(ctx, track.pts, toXY, percorridos, cur);
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 11 * sf;
      ctx.setLineDash([]);
      ctx.stroke();
      if (colored && projetado) {
        // a cor do último trecho continua até o personagem
        // a cor do trecho que o personagem está percorrendo agora
        const ultimo = Math.min(Math.max(sample.index, 0), track.pts.length - 2);
        strokeColored(ctx, projetado, percorridos, colored, 6 * sf, 1, {
          x: cur.x,
          y: cur.y,
          band: colored.bands[ultimo],
        });
      } else {
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 6 * sf;
        ctx.shadowColor = style.accent;
        ctx.shadowBlur = 18 * sf;
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- marcas de km ---
    if (input.marks && input.marks.length > 0 && track.pts.length > 1) {
      drawKmMarks(ctx, track.pts, toXY, input.marks, sf, width, height);
    }

    /*
     * --- destaques do percurso ---
     *
     * A melhor parcial e a maior subida entram como um aviso curto. Ele é
     * **medido aqui** e desenhado depois das paradas: assim o bloco de uma
     * parada (que também é medido depois) sabe onde o aviso está e sai da
     * frente dele, em vez de os dois brigarem pelo mesmo pedaço de tela.
     */
    const destaquesDoQuadro = style.showHighlights
      ? this.destaquesDo(track, horasAlinhadas(input, track), !!style.pace, this.perfilDo(track))
      : [];
    const emCena = destaqueEmCena(destaquesDoQuadro, t, tl.percurso);
    const avisoNaTela = emCena
      ? posicionarDestaque(ctx, {
          destaque: emCena.destaque,
          alfa: emCena.alfa,
          sf,
          quadro: { width, height },
          style,
        })
      : null;

    // --- paradas do percurso ---
    if (style.showStops && input.stops.length > 0 && track.pts.length > 1) {
      /*
       * O que é desenhado **por cima** do bloco de uma parada: a cartela final e
       * os selos da partida/chegada. A chegada fica a poucos metros da última
       * parada, e o pino dela tapava metade do nome — o bloco da parada agora
       * foge deles também.
       */
      const selos = lugaresDasPontas.map((l) => ({
        x: l.x - RAIO_DO_SELO * sf,
        y: l.y - RAIO_DO_SELO * sf,
        w: 2 * RAIO_DO_SELO * sf,
        h: 2 * RAIO_DO_SELO * sf,
      }));
      const ondeEstaOpersonagem = toXY(sample.pos);
      drawStops(ctx, input, toXY, sf, {
        quadro: { width, height },
        proibidos: [
          ...(cartao ? [retanguloDaCartela(cartao)] : []),
          ...selos,
          ...(avisoNaTela ? [{ x: avisoNaTela.x, y: avisoNaTela.y, w: avisoNaTela.w, h: avisoNaTela.h }] : []),
        ],
        // o selo do personagem cobre o pino na passagem (ver `drawStops`)
        personagem: {
          x: ondeEstaOpersonagem.x,
          y: ondeEstaOpersonagem.y,
          r: raioDoPersonagem(input.character, sf) * 1.05,
        },
      });
    }

    // o aviso dos destaques, por cima de tudo o que está no mapa
    if (avisoNaTela) pintarDestaque(ctx, avisoNaTela, { accent: style.accent, onDark, sf });

    /*
     * --- o horizonte ---
     *
     * Com a inclinação, o alto do quadro é o fundo do cenário: ele ganha uma
     * névoa que vai do fundo do mapa (opaco) até nada, na altura da âncora. O
     * que está longe fica mais claro e some — é o que dá a leitura de
     * profundidade que a compressão sozinha não dá. Entra **antes** do
     * personagem e dos pinos: eles são o primeiro plano e não podem ficar
     * enevoados.
     */
    if (tilt < 1) {
      const forca = (1 - tilt) / (1 - CHASE_TILT);
      const linha = height * CHASE_ALTURA;
      const nevoa = ctx.createLinearGradient(0, 0, 0, linha);
      nevoa.addColorStop(0, hexA(bm.bg, 0.94 * forca));
      nevoa.addColorStop(0.5, hexA(bm.bg, 0.42 * forca));
      nevoa.addColorStop(1, hexA(bm.bg, 0));
      ctx.save();
      ctx.fillStyle = nevoa;
      ctx.fillRect(0, 0, width, linha);
      ctx.restore();
    }

    /*
     * --- o fantasma ---
     *
     * Desenhado **antes** do personagem: quem está na frente é sempre o de
     * verdade. A opacidade vem daqui (e não de dentro do `drawCharacter`)
     * porque ela cai nos últimos 3% do percurso.
     */
    if (style.ghost) {
      const fantasma = pontoFantasma(track, t, {
        zoom: this.cam.zoom,
        height,
        centro: sample.pos,
        percurso: tl.percurso,
      });
      if (fantasma) {
        ctx.save();
        /*
         * Na abertura (o voo sobre a região) o fantasma entra junto com a
         * câmera: no enquadramento largo ele estaria a quilômetros do
         * personagem e leria como um segundo personagem solto no mapa.
         */
        ctx.globalAlpha = fantasma.alpha * target.opening;
        drawCharacter(
          ctx,
          toXY(fantasma.pos),
          fantasma.rumo + anguloMapa,
          input,
          sf,
          // sem inclinação na curva: o estado do filtro é do personagem de
          // verdade, e um segundo chamador no mesmo quadro o estragaria. O
          // fantasma é uma cópia de leitura, não um corpo em curva.
          0,
          true,
        );
        ctx.restore();
      }
    }

    // --- personagem ---
    drawCharacter(
      ctx,
      toXY(sample.pos),
      rumo + anguloMapa,
      input,
      sf,
      // a inclinação do corpo também é suavizada (ver `suavizarInclinacao`)
      this.suavizarInclinacao(inclinacaoDaCurva(track, sample.index), dt),
    );

    /*
     * --- pontos de partida e chegada ---
     *
     * Desenhados **depois do personagem**: no primeiro quadro o personagem está
     * exatamente em cima da partida, e no último em cima da chegada — desenhados
     * antes, o pino, o nome e a foto ficavam escondidos atrás dele.
     *
     * A foto das duas usa a mesma janela em segundos das paradas, **medida das
     * pontas**: a da largada já está na tela no primeiro quadro e a da chegada
     * continua no último. Uma foto **menor** que a das paradas, porque as duas
     * ficam nos extremos do trajeto, onde o personagem e a cartela final
     * disputam o mesmo lugar.
     */
    if (style.showEndpoints && track.pts.length > 1) {
      const fotoDoLocal = (mark?: import("./endpoints").EndpointMark | null) =>
        mark?.photo ? (input.photos?.get(mark.photo) ?? null) : null;
      /*
       * A onda de impacto das duas pontas, no mesmo instante do pipoco: é o que
       * marca a largada e a chegada no chão da rota (a chegada com a mesma
       * "batida" das paradas).
       */
      const ondaDaPonta = (p: number | null, at: LatLng, cor: string) => {
        if (p === null || p >= 1) return;
        drawImpacto(ctx, toXY(at), cor, p, sf);
      };
      const pipocoA = pipocoDaPonta(input, "a");
      const pipocoB = pipocoDaPonta(input, "b");
      ondaDaPonta(pipocoA, track.pts[0], "#22c55e");
      ondaDaPonta(pipocoB, track.pts[track.pts.length - 1], "#f87171");

      const pinoA = toXY(track.pts[0]);
      const pinoB = toXY(track.pts[track.pts.length - 1]);
      /*
       * --- as duas pontas no mesmo lugar ---
       *
       * Numa volta (partida e chegada no mesmo ponto), os dois pinos caem um em
       * cima do outro, e só um nome pode aparecer. Quem manda é o **relógio**:
       * enquanto o pipoco da chegada não começou, quem está na frente é a
       * partida (ele pipocou na largada e o nome do lugar vale dali até o fim);
       * quando a chegada começa a pipocar, ela passa a ficar na frente e o nome
       * dela toma o lugar. É o que o usuário pediu: "o A em destaque no início
       * e depois o B por cima no final".
       */
      const raio = 17 * sf;
      const coincidem = Math.hypot(pinoA.x - pinoB.x, pinoA.y - pinoB.y) < raio * 3;
      const chegadaNaFrente = pipocoB !== null;
      const temNome = (m?: import("./endpoints").EndpointMark | null) =>
        hasMark(m ?? null) && !!m!.label.trim();
      /** qual das duas fica atrás (e portanto esconde o nome, quando a da frente tem um) */
      const atras: "a" | "b" | null = !coincidem
        ? null
        : chegadaNaFrente
          ? temNome(input.endpoints.b)
            ? "a"
            : null
          : temNome(input.endpoints.a)
            ? "b"
            : null;

      const desenharPonta = (ponta: "a" | "b") => {
        const fim = ponta === "b";
        const mark = fim ? input.endpoints.b : input.endpoints.a;
        drawPin(ctx, fim ? pinoB : pinoA, fim ? "B" : "A", fim ? "#f87171" : "#22c55e", sf, {
          mark,
          foto: fotoDoLocal(mark),
          fotoAlpha: photoWindowAlpha(
            fim ? routeEnd(tl) - input.elapsed + PHOTO_FADE_IN_S : input.elapsed - tl.voo + PHOTO_FADE_IN_S,
          ),
          esquiva: cartao ? retanguloDaCartela(cartao) : null,
          crescimento: fim ? crescimentoDoPino(input, "b") : crescimentoDoPino(input, "a"),
          quadro: { width, height },
          semNome: atras === ponta,
        });
      };

      // a que fica atrás é desenhada primeiro; fora da coincidência, a ordem é
      // a de sempre (partida e depois chegada)
      if (coincidem && chegadaNaFrente) {
        desenharPonta("a");
        desenharPonta("b");
      } else if (coincidem) {
        desenharPonta("b");
        desenharPonta("a");
      } else {
        desenharPonta("a");
        desenharPonta("b");
      }
    }

    const headerBottom = style.showTitle
      ? drawTitle(ctx, width, input, onDark, sf)
      : 0;

    /*
     * O mapa em miniatura, logo abaixo do título: a rota inteira pequena, com o
     * pedaço percorrido em destaque. Fica antes dos outros enfeites de propósito
     * — no canto de cima à esquerda ele não disputa espaço com o HUD (direita)
     * nem com a legenda (embaixo).
     */
    if (style.showMinimap) this.drawMinimap(ctx, width, height, input, sample, onDark, headerBottom);

    /*
     * O aviso de **dia novo**, no alto e no centro: à esquerda ficam o título e
     * o minimapa, à direita o HUD — o meio é o único lugar livre do cabeçalho.
     * Ele é sobre o dia que **começa** (o dia 1 não avisa: o vídeo já começa
     * nele), e dura poucos segundos de vídeo, como o destaque do percurso.
     */
    if (style.showDays !== false) {
      const emCena = diaNaTela(input.days, t, tl.percurso);
      if (emCena) {
        drawDayChip(ctx, emCena.dia, emCena.alfa, {
          width,
          topo: headerBottom + 10 * sf,
          sf,
          accent: style.accent,
          onDark,
        });
      }
    }

    // --- overlays ---
    if (style.showProgress) drawProgress(ctx, width, height, input, sf);
    if (style.showHud) {
      /*
       * Numa rota **sem horário** não existe velocidade nem ritmo — e o HUD
       * ficava com um traço e a palavra "sem arquivo" durante o vídeo inteiro.
       * Aí ele passa a falar do que a rota tem: a inclinação do trecho (a mesma
       * da cor da linha) ou, sem elevação, o que ainda falta.
       */
      const declive = slopeAt(this.declivesDo(track), cumDoDesenho(track), t);
      drawHud(ctx, width, input, sample, sf, onDark, headerBottom, declive);
    }
    /*
     * O perfil de elevação, no rodapé, **antes** da legenda e da cartela: a
     * cartela é quem manda no fim do vídeo e, quando ela entra, a faixa sai de
     * cena (ver `drawProfile`).
     */
    if (style.showProfile) {
      const perfil = this.perfilDo(track);
      if (perfil) {
        drawProfile(ctx, width, height, {
          perfil,
          frac: t,
          totalM: track.total,
          accent: style.accent,
          sf,
          onDark,
          progressoAbaixo: !!style.showProgress,
          apagando: cartao ? cartao.alpha : 0,
          // durante o voo de abertura o vídeo é paisagem: a faixa ainda não diz nada
          entrando: tl.voo > 0 ? (input.elapsed - tl.voo) / 0.5 : 1,
        });
      }
    }
    /**
     * A faixa do perfil está na tela? É o que faz a legenda e o crédito do mapa
     * subirem — os dois moram no rodapé e foram desenhados **depois** dela.
     */
    const faixaDoPerfil = style.showProfile ? this.perfilDo(track) : null;
    if (colored && style.showRoute) {
      /*
       * A legenda da rota colorida mora no **mesmo canto** da faixa do perfil, e
       * é desenhada depois dela: sem subir, ela cobre o começo do gráfico e o
       * rótulo da altitude máxima (o usuário viu "o gráfico está atrás da
       * legenda"). A altura da faixa entra na conta, como já acontece com a
       * barra de progresso.
       */
      drawLegend(
        ctx,
        width,
        height,
        colored,
        sf,
        style.showProgress,
        faixaDoPerfil ? profileLayout(width, height, sf, !!style.showProgress).h + 10 * sf : 0,
      );
    }
    if (cartao) drawSummary(ctx, width, height, cartao, onDark, sf);

    /*
     * Atribuição obrigatória dos mapas gratuitos.
     *
     * Ela sobe quando há algo no rodapé: a barra de progresso e, agora, a faixa
     * do perfil. Antes ela ficava por cima do canto direito do gráfico — o
     * crédito ilegível e a linha do relevo cortada.
     */
    /*
     * Com o relevo ligado entram **duas** licenças no crédito: a do mapa e a do
     * sombreado. Um crédito só deixaria a fonte do terreno sem citar.
     */
    const credito =
      this.store.relevo && relevoDoMapa(style.basemap) !== null
        ? `${bm.attribution} · Esri Hillshade`
        : bm.attribution;
    drawAttribution(
      ctx,
      width,
      height,
      credito,
      style.showProgress,
      sf,
      /*
       * `+ 30·sf` é a folga do cabeçalho da faixa: o crédito tem de ficar
       * **acima** do painel inteiro, e não só acima dos últimos 6 px dele (na
       * primeira conta ele caía dentro do painel, em cima do "D+").
       */
      faixaDoPerfil ? profileLayout(width, height, sf, !!style.showProgress).h + 30 * sf : 0,
    );
  }
}

/** Crédito do mapa — exigido pelas licenças (OSM/ODbL, OpenTopoMap, Esri). */
function drawAttribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  liftedByProgress: boolean,
  sf: number,
  /** quanto subir além da barra de progresso (a faixa do perfil, quando há) */
  liftExtra = 0,
) {
  const pad = 10 * sf;
  const fs = Math.round(Math.max(9, 11 * sf));
  ctx.save();
  ctx.font = `500 ${fs}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const w = ctx.measureText(text).width;
  const y = height - pad - (liftedByProgress ? 34 * sf : 0) - liftExtra;
  const x = width - pad;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, x - w - 9 * sf, y - fs - 5 * sf, w + 12 * sf, fs + 9 * sf, 5 * sf);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillText(text, x - 3 * sf, y);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Desenhos                                                            */
/* ------------------------------------------------------------------ */

/** Quanto tempo (em segundos de vídeo) a foto da parada fica na tela. */
const PHOTO_HOLD_S = 2.6;

/**
 * Quanto **antes** da passagem a foto da parada começa a entrar, em segundos de
 * vídeo.
 *
 * A foto só aparecia depois da passagem. Numa parada perto do fim isso é tarde
 * demais: o personagem já andou e o bloco — foto, nome e o pino — quase sai
 * pela borda do quadro. Antes da passagem a parada está **na frente** do
 * personagem, no alto da tela, que é onde o olho está olhando.
 *
 * O limite de 20% do percurso é o mesmo cuidado do nome: num vídeo de 6 s não
 * dá para a foto nascer muito antes.
 */
const FOTO_ANTES_S = 1.2;
const FOTO_ANTES_FRACAO = 0.2;
const PHOTO_FADE_IN_S = 0.4;
const PHOTO_FADE_OUT_S = 0.7;

/**
 * Quanto a foto está visível, `desde` segundos depois do seu momento.
 *
 * A janela é medida em **segundos de vídeo**, e não em metros como o "pipoco"
 * do pino: em metros ela ficaria ilegível justamente nas rotas longas — 1,3 km
 * de foto numa travessia de 435 km são 0,04 s. Em segundos, a foto aparece do
 * mesmo jeito em qualquer rota, e a pré-visualização e a gravação continuam
 * idênticas, porque as duas usam o mesmo instante `t`.
 */
function photoWindowAlpha(desde: number, esperaExtra = 0): number {
  if (!(desde >= 0)) return 0;
  const entra = Math.min(1, desde / PHOTO_FADE_IN_S);
  const sai =
    1 -
    Math.min(
      1,
      Math.max(
        0,
        (desde - (PHOTO_HOLD_S + esperaExtra - PHOTO_FADE_OUT_S)) / PHOTO_FADE_OUT_S,
      ),
    );
  return Math.min(entra, sai);
}

const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/**
 * O andar do personagem.
 *
 * O emoji é um desenho parado — quem anda é o selo em volta dele. Três coisas
 * juntas dão o passo: o corpo **sobe e desce** (baixo na pisada, alto no meio
 * do passo), o peso **troca de lado** e o selo **estica** no alto e **achata**
 * na batida. Antes disto o personagem deslizava pelo traçado como um pino
 * parado, e o usuário descreveu exatamente isso: "o personagem ficou muito
 * robótico ao caminhar pelo traçado".
 *
 * Quem anda sobre rodas não tem passo — carro que pula parece defeito — e quem
 * paira sobe e desce devagar. Quem decide é o `gaitOf`, por personagem.
 *
 * A medida é o tempo do **percurso**, não o do vídeo: assim o personagem fica
 * parado no voo de abertura e na cartela (não sai andando sozinho no fim), e a
 * passada sai idêntica na prévia e no vídeo gravado — é o mesmo `elapsed`, a
 * mesma conta.
 *
 * Tudo é fração do selo (não pixels), então o passo tem o mesmo tamanho em
 * qualquer resolução e em qualquer tamanho de personagem.
 */
export function andar(
  input: FrameState,
  c: Character,
): { sobe: number; lado: number; estica: number } {
  const { gait, hz } = gaitOf(c);
  if (gait === "roda") return { sobe: 0, lado: 0, estica: 0 };
  const tl = timelineOr(input.timeline, input.duration);
  const seg = Math.max(0, Math.min(tl.percurso, input.elapsed - tl.voo));
  /*
   * Sai andando e chega parando: o balanço entra e sai suave nas pontas (sem
   * isso o personagem já aparecia em movimento durante o voo de abertura).
   */
  const entra = Math.min(1, seg / 0.5);
  const sai = Math.min(1, (tl.percurso - seg) / 0.5);
  const ganho = Math.max(0, Math.min(entra, sai));
  if (ganho === 0) return { sobe: 0, lado: 0, estica: 0 };
  const fase = hz * seg; // passos dados desde a largada
  const onda = Math.sin(fase * Math.PI * 2);
  if (gait === "flutua") return { sobe: -0.05 * ganho, lado: 0, estica: 0.015 * onda * ganho };
  /*
   * **Sem pulo.** O corpo não sobe e desce — o usuário pediu ("o personagem não
   * precisa ficar pulando"), e ele tinha razão: um selo de 62 px subindo 20 px
   * a cada passo parece um ícone quicando, não alguém andando.
   *
   * E o balanço que sobrou foi **reduzido** (5% → 3% do selo, menos de 2 px):
   * com o rumo ainda curtinho, o vaivém lateral chamava mais atenção que o
   * andar. Aqui ele é só o peso trocando de pé — quem dá o movimento é o rumo
   * suavizado e a inclinação na curva.
   */
  return { sobe: 0, lado: 0.03 * onda * ganho, estica: 0.014 * onda * ganho };
}

/** O rumo (graus) de `a` para `b` passando por `b` até `c`, em (-180, 180]. */
function giroEntre(a: LatLng, b: LatLng, c: LatLng): number {
  const antes = bearing(a, b);
  const depois = bearing(b, c);
  if (!Number.isFinite(antes) || !Number.isFinite(depois)) return 0;
  let d = depois - antes;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Quanto o personagem se inclina na curva (graus).
 *
 * Reta = 0. Numa curva o corpo acompanha o giro — é o que separa "andando" de
 * "sendo arrastado". O rumo é medido ~30 m **antes e depois** (em metros de
 * caminho, não em quantidade de pontos, para valer também em arquivo ralo) e
 * entra com um quarto do valor, no máximo 10° — inclinação de corrida, não de
 * moto em curva.
 */
export function inclinacaoDaCurva(track: Track, i: number): number {
  const pts = track.pts;
  if (pts.length < 3) return 0;
  const janelaM = 30;
  let a = Math.max(0, Math.min(i, pts.length - 1));
  while (a > 0 && haversine(pts[a], pts[i]) < janelaM) a--;
  let b = Math.max(0, Math.min(i, pts.length - 1));
  while (b < pts.length - 1 && haversine(pts[i], pts[b]) < janelaM) b++;
  if (a === i || b === i) return 0;
  return Math.max(-8, Math.min(8, giroEntre(pts[a], pts[i], pts[b]) * 0.22));
}

/**
 * O raio do selo do personagem, em pixels da tela.
 *
 * Fica numa função porque **duas** partes precisam do mesmo número: quem
 * desenha o personagem e quem posiciona os blocos das paradas, que têm de sair
 * de cima dele (o selo é desenhado depois e cobria o nome da parada justamente
 * no instante da passagem — o pior momento para escondê-lo).
 */
export function raioDoPersonagem(character: Character, sf: number): number {
  return Math.round(Math.max(38, Math.min(86, 62 * sf)) * (character.size ?? 1));
}

/** Fração da altura da tela em que o fantasma anda à frente do personagem. */
export const GHOST_FRACAO = 0.16;

/** Opacidade do fantasma (o personagem de verdade é opaco). */
export const GHOST_ALPHA = 0.34;

/**
 * Onde fica o **fantasma** que anda à frente do personagem.
 *
 * É o mesmo personagem, translúcido, um pedaço à frente na rota: em vez de uma
 * seta ou de um ponto de luz, quem mostra "o caminho vem por aqui" é a própria
 * figura que o vídeo já usa. A distância é medida **na tela** (16% da altura,
 * `GHOST_FRACAO`), convertida para metros no zoom do quadro — assim ele fica à
 * mesma distância visual no zoom 12 e no 18, em vez de sumir num caso e sair
 * pela borda no outro.
 *
 * Some nos últimos 3% do percurso: chegando perto da linha de chegada, um
 * fantasma à frente "chegaria antes" e a leitura vira erro.
 *
 * Devolve `null` quando não há para onde ir (perto do fim) ou quando o traçado
 * não tem comprimento.
 */
export function pontoFantasma(
  track: Track,
  t: number,
  /** pixels de altura do quadro, o zoom da vista e o centro (para a escala) */
  vista: { zoom: number; height: number; centro: LatLng; percurso?: number },
): { pos: LatLng; t: number; index: number; rumo: number; alpha: number } | null {
  if (track.pts.length < 2 || !(track.total > 0)) return null;
  const cos = Math.cos((vista.centro.lat * Math.PI) / 180);
  const mPorPx = (METROS_NO_EQUADOR * cos) / Math.pow(2, vista.zoom);
  if (!Number.isFinite(mPorPx) || mPorPx <= 0) return null;

  const metros = GHOST_FRACAO * vista.height * mPorPx;
  const tg = t + metros / track.total;
  if (tg >= 1) return null;

  // os últimos 3% do percurso são a rampa de saída do fantasma
  const saida = tg > 0.97 ? Math.max(0, (1 - tg) / 0.03) : 1;
  if (saida <= 0) return null;

  const amostra = sampleTrack(track, tg);
  const janela = janelaDoRumo(track.total, vista.percurso && vista.percurso > 0 ? vista.percurso : 16);
  return {
    pos: amostra.pos,
    t: tg,
    index: amostra.index,
    rumo: rumoSuave(track, tg, janela),
    alpha: GHOST_ALPHA * saida,
  };
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  /**
   * O rumo **na tela** (o do traçado já virando suave, mais o giro do mapa na
   * terceira pessoa): é ele que aponta a seta e gira o emoji.
   */
  rumo: number,
  input: FrameState,
  sf: number,
  /**
   * A inclinação do corpo na curva, em graus — **já suavizada** por quem
   * desenha (`suavizarInclinacao`). Ela vem de fora e não é calculada aqui
   * porque o cálculo puro (`inclinacaoDaCurva`) muda de degrau em degrau quando
   * o traçado muda de ponto, e era isso que ficava brusco nas curvas.
   */
  inclina: number,
  /**
   * `fantasma` desenha a cópia translúcida à frente: sem halo, sem anel de
   * pulso e sem seta — o que sobra é a figura, que é o que precisa ser lida.
   */
  fantasma = false,
) {
  const { character, style, rotate, elapsed } = input;
  const badge = raioDoPersonagem(character, sf);
  const respira = 1 + 0.05 * Math.sin(elapsed * 4);
  const { sobe, lado, estica } = andar(input, character);

  ctx.save();
  ctx.translate(at.x + lado * badge, at.y + sobe * badge);
  if (inclina !== 0) ctx.rotate((inclina * Math.PI) / 180);
  if (estica !== 0) ctx.scale(1 - estica * 0.6, 1 + estica);

  if (!fantasma) {
    // halo
    const halo = ctx.createRadialGradient(0, 0, badge * 0.25, 0, 0, badge * 1.5);
    halo.addColorStop(0, hexA(style.accent, 0.45));
    halo.addColorStop(1, hexA(style.accent, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, badge * 1.5 * respira, 0, Math.PI * 2);
    ctx.fill();

    /*
     * Anel de pulso: batia sozinho no relógio do vídeo (um "pisca-pisca" de
     * painel); agora abre e fecha **no passo**, então o anel conta a mesma
     * história que o corpo — um passo, uma batida.
     */
    ctx.strokeStyle = hexA(style.accent, 0.55);
    ctx.lineWidth = 2 * sf;
    ctx.beginPath();
    ctx.arc(0, 0, badge * (0.86 + 0.12 * respira + 0.06 * sobe), 0, Math.PI * 2);
    ctx.stroke();

    // seta de direção
    const arrowAngle = ((rumo - 90) * Math.PI) / 180;
    ctx.save();
    ctx.rotate(arrowAngle);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(badge * 0.92, 0);
    ctx.lineTo(badge * 0.6, -badge * 0.26);
    ctx.lineTo(badge * 0.6, badge * 0.26);
    ctx.closePath();
    ctx.fillStyle = style.accent;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2 * sf;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // badge
  ctx.beginPath();
  ctx.arc(0, 0, badge * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15,18,28,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 14 * sf;
  ctx.shadowOffsetY = 3 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3 * sf;
  ctx.strokeStyle = style.accent;
  ctx.stroke();

  /*
   * O avatar, quando existe, toma o lugar do emoji **dentro do selo**: é a
   * mesma moldura, a mesma seta e o mesmo pulso — o que muda é quem aparece
   * ali. Recortado em círculo e com o quadrado central da foto (o mesmo
   * `coverSquare` dos pinos), para uma foto 3:4 não sair achatada.
   */
  const avatar = style.avatar ? (input.photos?.get(style.avatar) ?? null) : null;
  if (avatar) {
    const r = badge * 0.56;
    const c = coverSquare(
      Number(avatar.width) || r,
      Number(avatar.height) || r,
    );
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      avatar as CanvasImageSource,
      c.sx,
      c.sy,
      c.size,
      c.size,
      -r,
      -r,
      r * 2,
      r * 2,
    );
    ctx.restore();
    // um aro fino por dentro separa a foto do aro do acento
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = Math.max(1, 1.6 * sf);
    ctx.stroke();
  } else {
    /*
     * O emoji ocupa o selo de verdade: era desenhado com 0,6 do selo, e a figura
     * ficava pequena dentro de um aro grande — o conjunto parecia ícone de
     * painel, não personagem.
     */
    ctx.rotate(rotate ? ((rumo + (character.baseAngle ?? 0)) * Math.PI) / 180 : 0);
    ctx.font = `${Math.round(badge * 0.78)}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(character.emoji, 0, badge * 0.03);
  }

  ctx.restore();
}
/**
 * O pino redondo de um ponto no mapa — o mesmo desenho para as paradas e para
 * a partida/chegada.
 *
 * Antes cada um tinha o seu, e o A/B saiu achatado e escuro em comparação: sem
 * a sombra e sem o brilho do aro que as paradas têm. Uma função só mantém os
 * dois iguais (e é o que o usuário pediu: "poderiam ficar igual os pontos de
 * parada").
 *
 * Desenha na origem — quem chama já transladou para o ponto.
 */
function drawPinBadge(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  sf: number,
  /** o que vai **dentro** do selo (foto, emoji ou letra) */
  conteudo?: () => void,
) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(9,12,20,0.94)";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 12 * sf;
  ctx.shadowOffsetY = 3 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetY = 0;

  // o miolo entra antes do aro: assim o aro (e o brilho) ficam por cima da foto
  conteudo?.();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = 2.6 * sf;
  ctx.strokeStyle = color;
  ctx.stroke();

  // brilho do aro (a "luz" que dá volume ao pino)
  ctx.beginPath();
  ctx.arc(0, 0, r - 2.6 * sf, Math.PI * 0.92, Math.PI * 1.85);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.6 * sf;
  ctx.stroke();
}

/**
 * O pino encosta na cartela?
 *
 * Interseção de retângulos — **não** basta olhar a vertical: um pino que está
 * abaixo da cartela não é alcançado por ela (e, olhando só a vertical, ele
 * subia 314 px para "escapar" de uma cartela que estava acima dele).
 */
export function overlapsCard(
  at: { x: number; y: number },
  r: number,
  card: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    at.x + r > card.x &&
    at.x - r < card.x + card.w &&
    at.y + r > card.y &&
    at.y - r < card.y + card.h
  );
}

/**
 * Foto dentro do selo do pino.
 *
 * É o que impede o pino de ficar **oco**: a foto grande (a que aparece quando o
 * personagem passa) é desenhada **acima** do pino, não dentro dele — então
 * esconder o emoji "para a foto ocupar o lugar" deixava o selo vazio durante o
 * trajeto inteiro.
 */
function drawPhotoInsidePin(
  ctx: CanvasRenderingContext2D,
  img: PhotoImage,
  r: number,
  sf: number,
) {
  const raio = Math.max(1, r - 2.6 * sf);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, raio, 0, Math.PI * 2);
  ctx.clip();
  const { sx, sy, size } = coverSquare(img.width, img.height);
  ctx.drawImage(
    img as CanvasImageSource,
    sx,
    sy,
    size,
    size,
    -raio,
    -raio,
    raio * 2,
    raio * 2,
  );
  ctx.restore();
}

/** Segundos de vídeo que o pino da ponta leva para crescer ("pipoco"). */
export const PINO_CRESCE_S = 0.7;

/**
 * O quanto do "pipoco" da ponta já aconteceu (0 = ainda não cresceu, 1 = pronto).
 *
 * `null` = ainda não é a vez desta ponta (o pipoco dela nem começou).
 *
 * A **partida** pipoca a partir do pouso do voo (o pino nasce enquanto o
 * personagem arranca) e a **chegada** pipoca **até** o instante em que o
 * personagem chega, de modo que ela está inteira no quadro da chegada.
 */
export function pipocoDaPonta(input: FrameState, ponta: "a" | "b"): number | null {
  const tl = timelineOr(input.timeline, input.duration);
  if (ponta === "a") {
    const desde = input.elapsed - tl.voo;
    return desde < 0 ? null : Math.max(0, Math.min(1, desde / PINO_CRESCE_S));
  }
  const falta = routeEnd(tl) - input.elapsed;
  if (falta > PINO_CRESCE_S) return null;
  return Math.max(0, Math.min(1, 1 - Math.max(0, falta) / PINO_CRESCE_S));
}

/**
 * O tamanho do pino de uma ponta (1 = tamanho cheio).
 *
 * É o **mesmo pipoco das paradas**, que é o que o usuário pediu ("o ponto B não
 * está com o efeito de aumentar e diminuir, igual o A"): antes da vez, o pino
 * fica em 0,7, do tamanho do pino "fantasma" de uma parada que ainda não foi
 * alcançada; na hora, ele encolhe e volta **passando do tamanho cheio** (a
 * sobra do `easeOutBack`, que é o "aumenta e diminui").
 *
 * O que ele viu antes era 0,7 → 1 (30% de crescimento, `easeOutBack` achatado
 * contra o 1): um efeito que existia no código e não existia na tela.
 */
export function crescimentoDoPino(input: FrameState, ponta: "a" | "b"): number {
  const p = pipocoDaPonta(input, ponta);
  if (p === null) return 0.7;
  return Math.max(0.15, easeOutBack(p));
}

/**
 * Onda de impacto de um pino que acabou de pipocar — a mesma das paradas.
 *
 * Desenhada no chão (a âncora), não no pino: ela cresce a partir do ponto da
 * rota e some quando o pino chega ao tamanho cheio.
 */
function drawImpacto(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  color: string,
  p: number,
  sf: number,
) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, (15 + 54 * p) * sf, 0, Math.PI * 2);
  ctx.strokeStyle = hexA(color, (1 - p) * 0.6);
  ctx.lineWidth = (3.4 * (1 - p) + 0.4) * sf;
  ctx.stroke();
}

/** Quanto um pino precisa subir para não ficar debaixo da cartela final. */
export function liftToClear(
  bottomY: number,
  topY: number,
  forca: number,
  margem: number,
): number {
  if (!(forca > 0)) return 0;
  const sobra = bottomY - (topY - margem);
  return sobra > 0 ? sobra * Math.min(1, forca) : 0;
}

/**
 * De que lado do pino o bloco (foto + nome) cabe melhor.
 *
 * Acima é onde ele nasce — é o desenho de sempre. Só desce quando não há chão
 * acima; e, quando não há de nenhum lado, fica no lado com mais espaço (o pino
 * no alto da tela pendura o bloco para baixo, e vice-versa).
 */
export function ladoDoBloco(
  y: number,
  altura: number,
  alturaDoQuadro: number,
  margem: number,
): "acima" | "abaixo" {
  if (y - altura >= margem) return "acima";
  if (y + altura <= alturaDoQuadro - margem) return "abaixo";
  return y > alturaDoQuadro / 2 ? "acima" : "abaixo";
}

/**
 * Onde o bloco do nome fica na horizontal (o centro, já limitado ao quadro).
 *
 * O desenho era centrado no pino; encostado na borda, metade do nome saía pela
 * moldura. Aqui ele desliza o mínimo para caber: o pino continua embaixo (a seta
 * aponta para ele) e o nome aparece inteiro.
 */
export function centroDoBloco(
  x: number,
  larguraNaTela: number,
  larguraDoQuadro: number,
  margem: number,
): number {
  const metade = larguraNaTela / 2;
  const min = margem + metade;
  const max = larguraDoQuadro - margem - metade;
  if (min > max) return larguraDoQuadro / 2; // o bloco é maior que o quadro
  return Math.max(min, Math.min(max, x));
}

/** Um retângulo qualquer na tela (a cartela final, o aviso do topo). */
type RetanguloNaTela = { x: number; y: number; w: number; h: number };

/**
 * O aviso de um destaque (melhor parcial, maior subida), já medido.
 *
 * Fica separado do desenho porque a medida acontece **antes** dos blocos das
 * paradas: eles precisam saber o retângulo do aviso para não desenhar em cima.
 */
type DestaqueNaTela = {
  destaque: Destaque;
  /** 0..1: o quanto ele já entrou */
  alfa: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontes: { titulo: string; valor: string; unidade: string; detalhe: string };
};

/**
 * Mede o aviso e escolhe o lugar dele no quadro.
 *
 * O lugar é **fixo**: centralizado no alto, logo abaixo do título (e abaixo do
 * minimapa, quando ele está ligado). A primeira versão ancorava o aviso no
 * ponto do mapa onde o feito aconteceu — e no instante em que ele fica inteiro
 * o personagem está exatamente ali, então o aviso caía **em cima do
 * personagem**. Como aviso, ele é um letreiro: o lugar não muda, o que muda é
 * quando ele entra.
 */
function posicionarDestaque(
  ctx: CanvasRenderingContext2D,
  o: {
    destaque: Destaque;
    alfa: number;
    sf: number;
    quadro: { width: number; height: number };
    style: SceneStyle;
  },
): DestaqueNaTela {
  const { sf } = o;
  const pad = 14 * sf;
  const fontes = {
    titulo: `800 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`,
    valor: `800 ${Math.round(27 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`,
    unidade: `700 ${Math.round(12 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`,
    detalhe: `600 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`,
  };
  const largura = (texto: string, fonte: string) => {
    ctx.font = fonte;
    return ctx.measureText(texto).width;
  };
  const estrela = largura("★", fontes.titulo) + 6 * sf;
  const w =
    Math.max(
      estrela + largura(o.destaque.titulo.toUpperCase(), fontes.titulo),
      largura(o.destaque.valor, fontes.valor) + 7 * sf + largura(o.destaque.unidade, fontes.unidade),
      largura(o.destaque.detalhe, fontes.detalhe),
    ) +
    pad * 2;
  const h = 86 * sf;

  /*
   * O alto do quadro: abaixo da caixa do título (40 + 26 + margens) e, com o
   * minimapa ligado, abaixo dele também. À direita, o anel do HUD manda — o
   * aviso encosta na metade esquerda do que sobra, em vez de entrar na coluna
   * dele.
   */
  const topo = (o.style.showTitle ? 132 : 26) * sf + (o.style.showMinimap ? 250 * sf : 0);
  const direita = o.quadro.width - (o.style.showHud ? 208 * sf : 0) - 12 * sf;
  const centro = Math.max(w / 2 + 16 * sf, Math.min(direita - w / 2, o.quadro.width / 2));

  return { destaque: o.destaque, alfa: o.alfa, x: centro - w / 2, y: topo, w, h, fontes };
}

/** O desenho do aviso: etiqueta, número grande e a linha de baixo. */
/**
 * O aviso de dia novo: uma pílula no alto do quadro — "DIA 2 · 41,2 km".
 *
 * A distância do dia entra junto porque é a pergunta que o aviso levanta: "já
 * foram 41 km, e agora começa outro dia".
 */
function drawDayChip(
  ctx: CanvasRenderingContext2D,
  dia: Dia,
  alfa: number,
  o: { width: number; topo: number; sf: number; accent: string; onDark: boolean },
) {
  if (alfa <= 0.01) return;
  const { width, topo, sf, accent, onDark } = o;
  const titulo = `DIA ${dia.n}`;
  const distancia = formatDistance(dia.metros);

  const fTitulo = `800 ${Math.round(13 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fDist = `600 ${Math.round(12.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, alfa));
  ctx.textBaseline = "middle";

  ctx.font = fTitulo;
  const wTitulo = ctx.measureText(titulo).width;
  ctx.font = fDist;
  const wDist = ctx.measureText(distancia).width;

  const padX = 15 * sf;
  const gap = 10 * sf;
  const h = 30 * sf;
  const w = padX * 2 + wTitulo + gap + wDist;
  const x = (width - w) / 2;

  roundRect(ctx, x, topo, w, h, h / 2);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.86)" : "rgba(255,255,255,0.94)";
  ctx.fill();
  ctx.lineWidth = 1.5 * sf;
  ctx.strokeStyle = hexA(accent, 0.6);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = fTitulo;
  ctx.fillStyle = accent;
  ctx.fillText(titulo, x + padX, topo + h / 2 + 0.5 * sf);
  ctx.font = fDist;
  ctx.fillStyle = onDark ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.8)";
  ctx.fillText(distancia, x + padX + wTitulo + gap, topo + h / 2 + 0.5 * sf);

  ctx.restore();
}

function pintarDestaque(
  ctx: CanvasRenderingContext2D,
  t: DestaqueNaTela,
  o: { accent: string; onDark: boolean; sf: number },
) {
  if (t.alfa <= 0.01) return;
  const { sf, accent, onDark } = o;
  const pad = 14 * sf;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, t.alfa));

  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18 * sf;
  roundRect(ctx, t.x, t.y, t.w, t.h, 14 * sf);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.86)" : "rgba(255,255,255,0.94)";
  ctx.fill();
  ctx.shadowBlur = 0;
  // o aro na cor do app: o aviso é do vídeo, não um aviso do navegador
  ctx.lineWidth = 1.5 * sf;
  ctx.strokeStyle = hexA(accent, 0.55);
  ctx.stroke();

  const x = t.x + pad;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.font = t.fontes.titulo;
  ctx.fillStyle = accent;
  ctx.fillText("★", x, t.y + 21 * sf);
  const estrela = ctx.measureText("★").width + 6 * sf;
  ctx.fillText(t.destaque.titulo.toUpperCase(), x + estrela, t.y + 21 * sf);

  ctx.font = t.fontes.valor;
  ctx.fillStyle = onDark ? "#ffffff" : "#0f172a";
  ctx.fillText(t.destaque.valor, x, t.y + 55 * sf);
  const wValor = ctx.measureText(t.destaque.valor).width;
  ctx.font = t.fontes.unidade;
  ctx.fillStyle = onDark ? "rgba(255,255,255,0.6)" : "rgba(15,23,42,0.55)";
  ctx.fillText(t.destaque.unidade, x + wValor + 7 * sf, t.y + 55 * sf);

  ctx.font = t.fontes.detalhe;
  ctx.fillStyle = onDark ? "rgba(255,255,255,0.68)" : "rgba(15,23,42,0.62)";
  ctx.fillText(t.destaque.detalhe, x, t.y + 76 * sf);

  ctx.restore();
}

/**
 * Onde cai o bloco de uma parada (a foto e o nome) — em pixels da tela.
 *
 * O bloco era desenhado no espaço do pino, sempre acima dele. Com a câmera que
 * acompanha, o pino de uma parada **perto do fim do trajeto** fica na parte de
 * baixo do quadro — e o bloco saía pela moldura: o usuário só via o aviso do
 * topo ("no ponto de parada perto do final, ele aparece como toast, como ele
 * ficou em baixo da tela").
 *
 * Aqui ele é posicionado como o dos pinos A/B: acima, ou abaixo quando acima
 * não cabe; desliza para dentro do quadro na horizontal; e foge do que estiver
 * cobrindo aquele ponto — a cartela final e os selos da partida/chegada, que
 * são desenhados **por cima** (e a chegada fica a poucos metros da última
 * parada, o que tapava metade do nome). O quadro manda em tudo: se não houver
 * como fugir, o bloco fica onde couber inteiro.
 *
 * Devolve o **topo** (`y`), o **centro** (`x`) e de que lado ficou.
 */
export function lugarDoBloco(
  pino: { x: number; y: number },
  largura: number,
  altura: number,
  raio: number,
  respiro: number,
  quadro: { width: number; height: number },
  margem: number,
  proibidos: RetanguloNaTela[] = [],
): { x: number; y: number; acima: boolean } {
  const metade = largura / 2;
  const min = margem + metade;
  const max = quadro.width - margem - metade;
  // o pino continua no eixo do bloco; o bloco é que desliza para caber
  const x = min > max ? quadro.width / 2 : Math.max(min, Math.min(max, pino.x));

  const acimaY = pino.y - raio - respiro - altura;
  const abaixoY = pino.y + raio + respiro;
  const fora = (y: number) => y < margem || y + altura > quadro.height - margem;
  const colide = (y: number) =>
    proibidos.some(
      (b) => x + metade > b.x && x - metade < b.x + b.w && y + altura > b.y && y < b.y + b.h,
    );

  // primeiro: dentro do quadro (não adianta fugir da cartela e sair da
  // moldura). Depois: fora do que cobre. No empate, o lado de sempre é o de cima.
  const candidatos = [
    { acima: true, y: acimaY, dentro: !fora(acimaY) },
    { acima: false, y: abaixoY, dentro: !fora(abaixoY) },
  ];
  const dentro = candidatos.filter((c) => c.dentro);
  const livres = dentro.filter((c) => !colide(c.y));
  const escolhido = livres[0] ?? dentro[0] ?? candidatos[0];
  let acima = escolhido.acima;
  let y = escolhido.y;

  // coberto dos dois lados (a cartela no meio da tela): sobe para cima do que
  // cobre, se sobrar espaço no quadro
  if (colide(y)) {
    const cobrem = proibidos.filter(
      (b) => x + metade > b.x && x - metade < b.x + b.w && y + altura > b.y && y < b.y + b.h,
    );
    const teto = Math.min(...cobrem.map((b) => b.y)) - altura - respiro;
    if (teto >= margem) {
      acima = true;
      y = teto;
    }
  }

  // o quadro manda: o bloco nunca fica fora dele
  y = Math.max(margem, Math.min(quadro.height - margem - altura, y));
  return { x, y, acima };
}

/** As opções do pino de uma ponta (são muitas: vão por nome). */
type OpcoesDoPino = {
  mark?: import("./endpoints").EndpointMark | null;
  foto?: PhotoImage | null;
  fotoAlpha?: number;
  /** retângulo que o pino não pode invadir (a cartela final, no fim do vídeo) */
  esquiva?: { x: number; y: number; w: number; h: number; forca: number } | null;
  /** 1 = tamanho cheio; menos = o pino ainda está nascendo ("pipoco") */
  crescimento?: number;
  /** o quadro do vídeo: o nome e a foto não podem sair dele */
  quadro?: { width: number; height: number };
  /** não desenha o nome (a outra ponta está na frente, no mesmo lugar) */
  semNome?: boolean;
};

/**
 * O bloco de cima (ou de baixo) de um pino de ponta: a foto e o nome.
 *
 * O nome era centrado no pino; quando a partida ou a chegada encostava na borda
 * do quadro — o que a câmera que acompanha faz o tempo todo —, a etiqueta saía
 * pela moldura (o usuário viu e cobrou: "o nome do ponto A e B fica fora da
 * moldura"). Aqui o bloco **escolhe o lado** com espaço (acima, e abaixo quando
 * não cabe) e **desliza na horizontal** para caber inteiro, com a seta apontando
 * para o pino mesmo deslocada.
 *
 * Tudo isto é medido no **espaço da tela**: a etiqueta é desenhada dentro do
 * `scale` do pipoco, então o limite do quadro é convertido para o espaço local
 * dividindo pelo crescimento.
 */
function drawBlocoDoPino(
  ctx: CanvasRenderingContext2D,
  pino: { x: number; y: number },
  escala: number,
  r: number,
  color: string,
  sf: number,
  nome: string,
  foto: PhotoImage | null,
  fotoAlpha: number,
  quadro: { width: number; height: number },
) {
  const margem = 8 * sf;
  const bh = 19 * sf;
  const gap = 6 * sf;
  const lado = 56 * sf;
  const temFoto = !!foto && fotoAlpha > 0.01;

  // altura que o bloco ocupa a partir do centro do pino (raio + conteúdo)
  const conteudo = (nome ? bh + gap : 0) + (temFoto ? lado + gap : 0);
  const altura = (r + conteudo) * escala;
  const acima = ladoDoBloco(pino.y, altura, quadro.height, margem) === "acima";

  // largura do bloco (o maior dos dois) e o quanto ele pode deslizar
  ctx.font = `700 ${Math.round(11.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const bw = nome ? ctx.measureText(nome).width + 16 * sf : 0;
  const largura = Math.max(bw, temFoto ? lado : 0);
  const centroX = centroDoBloco(pino.x, largura * escala, quadro.width, margem);
  const dx = (centroX - pino.x) / escala;

  ctx.save();
  // o bloco inteiro desliza junto (nome e foto continuam alinhados)
  ctx.translate(dx, 0);

  if (acima) {
    if (temFoto) {
      ctx.save();
      ctx.globalAlpha = fotoAlpha;
      const yTopo = -(r + gap + (nome ? bh + gap : 0) + lado);
      drawStopCircle(ctx, foto as never, 0, yTopo + lado, lado, color, sf);
      ctx.restore();
    }
    // o topo da etiqueta fica **acima do pino** (r + gap) e a foto acima dela —
    // era `-(r + gap)`, e o nome caía por cima do próprio pino
    if (nome) desenharEtiqueta(ctx, nome, 0, -(r + gap + bh), bw, bh, color, sf, true, -dx);
  } else {
    if (nome) desenharEtiqueta(ctx, nome, 0, r + gap, bw, bh, color, sf, false, -dx);
    if (temFoto) {
      ctx.save();
      ctx.globalAlpha = fotoAlpha;
      const yTopo = r + gap + (nome ? bh + gap : 0);
      drawStopCircle(ctx, foto as never, 0, yTopo + lado, lado, color, sf);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * A etiqueta do nome (o retângulo arredondado) com a seta apontando para o pino.
 *
 * `topo` é o y do **topo** da caixa no espaço local do pino; `acima` diz de que
 * lado o bloco está (a seta aponta para o lado do pino). `setaX` é onde a seta
 * cai dentro da caixa — a etiqueta pode ter deslizado na horizontal, e a seta
 * continua apontando para o pino em vez de para o centro do retângulo.
 */
function desenharEtiqueta(
  ctx: CanvasRenderingContext2D,
  texto: string,
  cx: number,
  topo: number,
  bw: number,
  bh: number,
  color: string,
  sf: number,
  acima: boolean,
  setaX: number,
) {
  const x = cx - bw / 2;
  roundRect(ctx, x, topo, bw, bh, 7 * sf);
  ctx.fillStyle = "rgba(9,12,20,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 8 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = hexA(color, 0.85);
  ctx.lineWidth = 1.4 * sf;
  ctx.stroke();

  // seta: encostada na caixa, apontando para o pino (que fica do outro lado)
  const dentro = Math.max(x + 6 * sf, Math.min(x + bw - 6 * sf, setaX));
  const base = acima ? topo + bh : topo;
  const ponta = acima ? base + 4 * sf : base - 4 * sf;
  ctx.beginPath();
  ctx.moveTo(dentro - 4 * sf, base);
  ctx.lineTo(dentro + 4 * sf, base);
  ctx.lineTo(dentro, ponta);
  ctx.closePath();
  ctx.fillStyle = "rgba(9,12,20,0.92)";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, cx, topo + bh / 2 + 0.5 * sf);
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  fallback: string,
  color: string,
  sf: number,
  opcoes: OpcoesDoPino = {},
) {
  const {
    mark = null,
    foto = null,
    fotoAlpha = 0,
    esquiva = null,
    crescimento = 1,
    quadro = null,
    semNome = false,
  } = opcoes;
  const marked = hasMark(mark);
  // mesmo tamanho do pino das paradas — a ideia é que os dois sejam o mesmo pino
  const r = 17 * sf;

  ctx.save();
  ctx.translate(at.x, at.y);

  /*
   * A cartela final cobre o meio da tela no fim do vídeo — e a chegada está
   * justamente ali. Sem isto, o pino, o nome e a foto da chegada ficavam
   * atravessados pela cartela.
   *
   * Só sobe quem a cartela **alcança**: a interseção é de retângulos, e não só
   * vertical. (Olhando só a vertical, um pino que estava **abaixo** da cartela
   * subia 314 px para "escapar" dela.) E sobe junto com a entrada da cartela,
   * sem pulo seco.
   */
  const alcancado = !!esquiva && overlapsCard(at, r, esquiva);
  const subida = alcancado
    ? liftToClear(at.y + r, esquiva!.y, esquiva!.forca, 10 * sf)
    : 0;
  if (subida > 0) ctx.translate(0, -subida);
  /*
   * O "pipoco" da ponta: o pino (com a foto, o nome e tudo) cresce até o
   * tamanho cheio. É o mesmo efeito das paradas — o pino delas fica em 0,7 até
   * o personagem passar e aí cresce —, e é o que o usuário pediu para a
   * chegada ("igual o A quando inicia").
   */
  if (crescimento !== 1) ctx.scale(crescimento, crescimento);

  drawPinBadge(ctx, r, color, sf);

  /*
   * O miolo do pino **nunca fica vazio**: a foto do lugar (quando existe),
   * senão o emoji, senão a letra A/B na cor do lugar.
   *
   * A regra antiga ("a foto ocupa o lugar do emoji") deixava o pino oco o
   * trajeto inteiro, porque a foto grande aparece acima do pino — e só nos
   * segundos da largada/chegada.
   */
  const conteudo = () => {
    if (foto) {
      drawPhotoInsidePin(ctx, foto, r, sf);
      return;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (marked && mark!.emoji.trim()) {
      ctx.font = `${Math.round(r * 1.05)}px ${EMOJI_FONT}`;
      ctx.fillText(mark!.emoji.trim(), 0, r * 0.06);
      return;
    }
    ctx.font = `800 ${Math.round(r * 1.1)}px "Inter","Segoe UI",system-ui,sans-serif`;
    // a letra ganha a cor do lugar (verde na partida, vermelho na chegada):
    // era branca sobre um pino escuro, e o usuário viu o par como "escuro"
    ctx.fillStyle = color;
    ctx.fillText(fallback, 0, r * 0.06);
  };
  drawPinBadge(ctx, r, color, sf, conteudo);

  /*
   * O nome e a foto do lugar — **dentro do quadro**.
   *
   * Quando o pino está fora da tela, o bloco nem é desenhado: ele já não
   * apareceria, e trazê-lo para dentro da moldura deixaria um nome solto, sem
   * pino nenhum embaixo para a seta apontar. Meio pino na borda (o caso comum,
   * com a câmera que acompanha) tem o nome puxado para dentro — que é o que o
   * usuário pediu.
   *
   * O critério é o **centro** do pino: com ele dentro, o bloco cabe de um dos
   * lados por construção (`ladoDoBloco` só escolhe um lado que caiba). Com o
   * centro fora, o pino está mais da metade para fora e o bloco sairia pendurado
   * na borda — foi o que a varredura de formatos pegou (uma etiqueta 4 px abaixo
   * do rodapé, de um pino que estava quase todo fora).
   */
  const nome = marked && !semNome ? mark!.label.trim() : "";
  const centroFora =
    !quadro || at.x < 0 || at.x > quadro.width || at.y < 0 || at.y > quadro.height;
  if ((nome || foto) && quadro && !centroFora) {
    drawBlocoDoPino(
      ctx,
      { x: at.x, y: at.y - subida },
      crescimento,
      r,
      color,
      sf,
      nome,
      foto && fotoAlpha > 0.01 ? foto : null,
      fotoAlpha,
      quadro,
    );
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Paradas do percurso                                                 */
/* ------------------------------------------------------------------ */

/** Quantas paradas o personagem já alcançou. */
export function countStopsPassed(stops: Poi[], t: number): number {
  let n = 0;
  for (const s of stops) if (t >= s.t) n++;
  return n;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Desenha as paradas. Antes de o personagem chegar, ficam discretas (fantasma);
 * no momento em que ele passa, "pipocam" com onda de impacto e etiqueta.
 * A animação é medida em METROS percorridos, então o resultado é idêntico
 * na pré-visualização e no vídeo gravado.
 */
/**
 * Quanto a etiqueta da parada leva para aparecer — em **segundos de vídeo**.
 *
 * Era medida em metros (como o pino), e a diferença aparece quando o vídeo anda
 * poucos metros por segundo: uma parada perto do fim tinha a etiqueta nascendo
 * depois do fim do vídeo. Em segundos ela entra igual em qualquer percurso — o
 * usuário avisou que não vai usar só o trajeto de 21 km.
 */
const ROTULO_ENTRA_S = 0.35;

/**
 * Quanto **antes** da passagem o nome da parada começa a entrar, em segundos de
 * vídeo.
 *
 * O nome entrava só depois de o personagem passar pela parada — e aí é tarde:
 * na terceira pessoa o pino de uma parada recém-passada já ficou atrás do
 * personagem e sai da tela em menos de um segundo. Foi o que o usuário viu: "o
 * ponto que está perto do fim demora aparecer e, quando aparece, já está
 * saindo da tela".
 *
 * Antes da passagem é o único momento em que a parada está **na frente** do
 * personagem, no alto do quadro, com tempo de leitura. O pino continua
 * "pipocando" na passagem (a onda de impacto e o crescimento), que é o instante
 * de chegada — o nome só chega mais cedo.
 *
 * O limite de 22% do percurso existe para o vídeo curto: numa gravação de 6 s,
 * 2 s de antecedência acenderia todas as paradas quase juntas.
 */
const ROTULO_ANTES_S = 2;
const ROTULO_ANTES_FRACAO = 0.22;

function drawStops(
  ctx: CanvasRenderingContext2D,
  input: FrameState,
  toXY: (p: LatLng) => { x: number; y: number },
  sf: number,
  opcoes: {
    /** o quadro do vídeo: o bloco do nome não pode sair dele */
    quadro: { width: number; height: number };
    /** o que está desenhado por cima (a cartela final): o bloco foge disso */
    proibidos?: RetanguloNaTela[];
    /**
     * Onde o personagem está, em pixels — e o raio do selo.
     *
     * O selo é desenhado **depois** das paradas, e no instante da passagem ele
     * fica exatamente em cima do pino: o nome da parada aparecia cortado, só
     * com a borda de fora ("Po…"). O bloco desvia dele como desvia da cartela.
     */
    personagem?: { x: number; y: number; r: number };
  },
) {
  const { track, t, stops, style } = input;
  // a janela da foto da parada é medida em segundos de **percurso**
  const tl = timelineOr(input.timeline, input.duration);
  const popMeters = Math.max(28, Math.min(190, track.total * 0.014));

  /** o que o bloco do nome não pode cobrir: a cartela, os selos A/B e o personagem */
  const proibidos: RetanguloNaTela[] = [...(opcoes.proibidos ?? [])];
  if (opcoes.personagem) {
    const { x, y, r } = opcoes.personagem;
    proibidos.push({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
  }

  for (const stop of stops) {
    /*
     * Quando a rota passa por esta parada — uma vez, ou mais (ida e volta).
     *
     * `ultima` é a passagem guardada pela âncora (onde o pino fica): a parada é
     * um lugar só no mapa, então o pino é desenhado uma vez. O que acontece a
     * cada passagem é o "pipoco", a foto e a etiqueta.
     */
    const passagens = input.passages?.[stop.id] ?? [stop.t];
    const primeira = passagens[0] ?? stop.t;
    const ultima = passagens.reduce<number | null>((acc, ts) => (t >= ts ? ts : acc), null);
    // passagem que está pipocando agora (a mais recente dentro da janela em metros)
    let ativa: number | null = null;
    for (const ts of passagens) {
      const d = (t - ts) * track.total;
      if (d >= 0 && d <= popMeters) ativa = ts;
    }

    const s = sampleTrack(track, stop.t);
    const at = toXY(s.pos); // âncora sobre a rota (gatilho)
    const off = stop.pos ? haversine(stop.pos, s.pos) : 0;
    const geo = toXY(poiLatLng(stop, track));

    // parada colada na rota: empurra o pino para o lado para não cobrir a linha
    let px = geo.x;
    let py = geo.y;
    if (off < 12) {
      const rad = (s.heading * Math.PI) / 180;
      const lift = 36 * sf;
      px = at.x + Math.cos(rad) * lift;
      py = at.y + Math.sin(rad) * lift;
    }

    const upcoming = ultima === null;
    // para o pino: 0 antes da primeira passagem, animação durante o pipoco, 1 depois
    const p =
      ultima === null
        ? 0
        : ativa === null
          ? 1
          : Math.min(1, ((t - ativa) * track.total) / popMeters);
    ctx.save();

    // linha de chamada: liga a rota ao ponto de interesse
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(px, py);
    ctx.setLineDash(upcoming ? [3 * sf, 3 * sf] : [6 * sf, 4 * sf]);
    ctx.strokeStyle = hexA(stop.color, upcoming ? 0.35 : 0.85);
    ctx.lineWidth = 2 * sf;
    ctx.stroke();
    ctx.setLineDash([]);

    // marca no chão (na rota)
    ctx.beginPath();
    ctx.arc(at.x, at.y, (upcoming ? 4.2 : 4.4) * sf, 0, Math.PI * 2);
    ctx.fillStyle = upcoming ? hexA(stop.color, 0.55) : stop.color;
    ctx.fill();

    // selo com a distância até a rota, quando a parada está fora dela
    if (off >= 25) {
      const mx = (at.x + px) / 2;
      const my = (at.y + py) / 2;
      const txt = `${off >= 1000 ? `${(off / 1000).toFixed(1)} km` : `${Math.round(off)} m`}`;
      ctx.font = `700 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
      const tw = ctx.measureText(txt).width;
      roundRect(ctx, mx - tw / 2 - 6 * sf, my - 8 * sf, tw + 12 * sf, 16 * sf, 8 * sf);
      ctx.fillStyle = "rgba(9,12,20,0.88)";
      ctx.fill();
      ctx.strokeStyle = hexA(stop.color, upcoming ? 0.4 : 0.9);
      ctx.lineWidth = 1.2 * sf;
      ctx.stroke();
      ctx.fillStyle = upcoming ? hexA(stop.color, 0.75) : stop.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, mx, my + 0.5 * sf);
    }

    // onda de impacto no instante em que é alcançada
    if (!upcoming && p < 1) drawImpacto(ctx, { x: px, y: py }, stop.color, p, sf);

    /*
     * O halo da parada que ainda vem.
     *
     * É o que faz o ponto ser **visto** no mapa: sem ele, o pino de 0,7 com 55%
     * de opacidade sumia no meio das ruas — o usuário reclamou de não enxergar
     * os pontos. O halo só existe antes da passagem (depois o pino já está
     * inteiro, com a cor da parada); assim ele também indica qual é a próxima.
     */
    if (upcoming) {
      ctx.beginPath();
      ctx.arc(px, py, 26 * sf, 0, Math.PI * 2);
      ctx.fillStyle = hexA(stop.color, 0.16);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 26 * sf, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(stop.color, 0.62);
      ctx.lineWidth = 2.2 * sf;
      ctx.stroke();
    }

    const escala = upcoming ? 0.85 : Math.max(0.15, easeOutBack(p));
    const alfaPino = upcoming ? 0.8 : Math.min(1, 0.3 + p * 1.2);

    /*
     * O pino, no "pipoco" da passagem (o pino das paradas fica em 0,7 até o
     * personagem passar e aí cresce) — e o bloco do nome e da foto à parte,
     * em **pixels da tela**, para poder escolher o lado e desviar da cartela.
     */
    ctx.save();
    ctx.globalAlpha = alfaPino;
    ctx.translate(px, py);
    ctx.scale(escala, escala);

    const r = 17 * sf;
    // mesma regra dos pinos A/B: com foto, o miolo mostra a foto (o trajeto
    // inteiro); sem foto, o emoji. Assim os dois continuam idênticos
    const fotoDoPino = stop.photo ? (input.photos?.get(stop.photo) ?? null) : null;
    const miolo = () => {
      if (fotoDoPino) {
        drawPhotoInsidePin(ctx, fotoDoPino, r, sf);
        return;
      }
      ctx.font = `${Math.round(r * 1.08)}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(stop.emoji, 0, r * 0.05);
    };
    drawPinBadge(ctx, r, stop.color, sf, miolo);
    ctx.restore();

    /*
     * Foto da parada (polaroide) e etiqueta com o nome.
     *
     * A foto entra junto com o "pipoco" do pino e sai depois de um tempo —
     * medida em **segundos de vídeo**, e não em metros como o pino. Em metros
     * ela ficaria ilegível justamente nas rotas longas: 1,3 km de foto numa
     * travessia de 435 km são 0,04 s de vídeo. Em segundos, a foto aparece do
     * mesmo jeito em qualquer rota — e a pré-visualização e a gravação
     * continuam idênticas, porque as duas usam o mesmo `t`.
     */
    /*
     * A foto da parada e a etiqueta com o nome.
     *
     * A foto entra junto com o "pipoco" do pino e sai depois de um tempo —
     * medida em **segundos de vídeo**, e não em metros como o pino. Em metros
     * ela ficaria ilegível justamente nas rotas longas: 1,3 km de foto numa
     * travessia de 435 km são 0,04 s de vídeo. Em segundos, a foto aparece do
     * mesmo jeito em qualquer rota — e a pré-visualização e a gravação
     * continuam idênticas, porque as duas usam o mesmo `t`.
     *
     * A etiqueta também é medida em segundos de vídeo, e não mais em metros: em
     * metros ela dependeria de quantos metros o vídeo anda por segundo — numa
     * caminhada de 2 km e numa travessia de 60 km a mesma parada tem de acender
     * pelo mesmo tempo. Numa parada perto do fim, em metros ela nascia depois de
     * o vídeo acabar.
     */
    const foto = stop.photo ? (input.photos?.get(stop.photo) ?? null) : null;
    /*
     * A janela da foto abre **antes** da passagem (ver `FOTO_ANTES_S`).
     *
     * O deslocamento é aplicado à âncora — a passagem mais recente, ou a
     * próxima quando ela ainda não chegou —, então a foto entra, fica cheia no
     * instante da passagem e sai `PHOTO_HOLD_S` depois, sem pulo de posição.
     * Como as duas âncoras são consideradas, a foto acende em **cada**
     * passagem (ida e volta), e não só na primeira.
     */
    const antecedenciaFoto = Math.min(FOTO_ANTES_S, tl.percurso * FOTO_ANTES_FRACAO);
    /*
     * O `esperaExtra` devolve à foto o tempo que ela **ganhou** na frente: sem
     * ele, antecipar a entrada encurtaria a saída, e a foto passaria menos
     * tempo na tela depois da passagem do que passava antes.
     */
    const janelaDaFoto = (ancora: number) =>
      photoWindowAlpha((t - ancora) * tl.percurso + antecedenciaFoto, antecedenciaFoto);
    let proxima: number | null = null;
    for (const ts of passagens) {
      if (ts > t && (proxima === null || ts < proxima)) proxima = ts;
    }
    const fotoAlpha = foto
      ? Math.max(
          ultima === null ? 0 : janelaDaFoto(ultima),
          proxima === null ? 0 : janelaDaFoto(proxima),
        )
      : 0;
    /*
     * O nome entra **antes** da passagem (ver `ROTULO_ANTES_S`): é quando a
     * parada ainda está na frente do personagem, no alto do quadro. Depois de
     * passar, o pino vai para trás e sai da tela — o nome que nascia só ali
     * aparecia para ninguém.
     */
    const antecedencia = Math.min(ROTULO_ANTES_S, tl.percurso * ROTULO_ANTES_FRACAO);
    const entrouEm = primeira - antecedencia / Math.max(1e-6, tl.percurso);
    const rotuloAlpha = !style.showStopLabels
      ? 0
      : Math.min(1, Math.max(0, (t - entrouEm) * tl.percurso) / ROTULO_ENTRA_S);

    /*
     * Com o pino fora da tela o bloco nem é desenhado: ele já não apareceria, e
     * puxá-lo para dentro da moldura deixaria um nome solto, apontando para
     * nada (é o mesmo critério dos pinos A/B).
     */
    const centroFora = px < 0 || px > opcoes.quadro.width || py < 0 || py > opcoes.quadro.height;
    if (!centroFora && (fotoAlpha > 0.01 || rotuloAlpha > 0.02)) {
      // no retorno, o km é o do momento (16,8 km), não o da primeira passagem
      const km = ((ultima ?? stop.t) * track.total) / 1000;
      const kmTxt = `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
      desenharBlocoDaParada(ctx, {
        pino: { x: px, y: py },
        raio: 17 * sf,
        color: stop.color,
        sf,
        nome: stop.label.trim() || "Parada",
        sub: off >= 25 ? `⤷ ${kmTxt}` : kmTxt,
        foto,
        fotoAlpha,
        alfaPino,
        rotuloAlpha,
        quadro: opcoes.quadro,
        proibidos,
      });
    }
    ctx.restore();
  }
}

/**
 * O bloco de uma parada: a foto, o nome e o km — em **pixels da tela**.
 *
 * Fica fora do `scale` do "pipoco" de propósito: assim o bloco é medido e
 * posicionado no quadro de verdade (`lugarDoBloco`), e não no espaço do pino,
 * que a cada quadro está num tamanho e num lugar diferente.
 *
 * A seta só é desenhada enquanto o bloco está encostado no pino: quando ele
 * sobe para fugir da cartela, uma seta solta apontaria para o nada.
 */
function desenharBlocoDaParada(
  ctx: CanvasRenderingContext2D,
  o: {
    /** posição do pino, em pixels da tela */
    pino: { x: number; y: number };
    /** raio do pino, em pixels */
    raio: number;
    color: string;
    sf: number;
    nome: string;
    sub: string;
    foto: PhotoImage | null;
    fotoAlpha: number;
    /** alfa do pino (o bloco acompanha a entrada dele) */
    alfaPino: number;
    /** 0..1: o quanto a etiqueta já entrou */
    rotuloAlpha: number;
    quadro: { width: number; height: number };
    proibidos: RetanguloNaTela[];
  },
) {
  const margem = 10 * o.sf;
  const respiro = 8 * o.sf;
  const gap = 6 * o.sf;
  const ladoFoto = 78 * o.sf;
  const bh = 33 * o.sf;
  const temFoto = !!o.foto && o.fotoAlpha > 0.01;
  const temNome = o.rotuloAlpha > 0.02;

  const fNome = `700 ${Math.round(13.5 * o.sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fSub = `600 ${Math.round(10.5 * o.sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.font = fNome;
  const nw = ctx.measureText(o.nome).width;
  ctx.font = fSub;
  const sw = ctx.measureText(o.sub).width;
  const bw = Math.max(nw, sw) + 20 * o.sf;

  // o conteúdo, de cima para baixo, sem contar o pino
  const conteudo = (temNome ? bh + (temFoto ? gap : 0) : 0) + (temFoto ? ladoFoto : 0);
  const largura = Math.max(temNome ? bw : 0, temFoto ? ladoFoto : 0);
  const lugar = lugarDoBloco(
    o.pino,
    largura,
    conteudo,
    o.raio,
    respiro,
    o.quadro,
    margem,
    o.proibidos,
  );

  // encostado no pino? então o bloco ainda aponta para ele: o nome desce um
  // bico na direção do pino (com foto no meio, a seta aponta para a foto — é o
  // desenho de sempre). Longe do pino (fugindo da cartela), a seta sai de cena.
  const borda = lugar.acima ? lugar.y + conteudo : lugar.y;
  const alvo = lugar.acima ? o.pino.y - o.raio - respiro : o.pino.y + o.raio + respiro;
  const encostado = Math.abs(borda - alvo) < 0.5;

  ctx.save();
  ctx.translate(lugar.x, lugar.y);

  // dentro do bloco: a foto encosta no pino e o nome fica do lado de fora — é o
  // desenho de sempre (o nome subia para dar lugar à foto), e o espelho dele
  // quando o bloco desce
  const porFoto = (topo: number) => {
    if (!temFoto) return;
    ctx.save();
    ctx.globalAlpha = o.alfaPino * o.fotoAlpha;
    drawStopCircle(ctx, o.foto as never, 0, topo + ladoFoto, ladoFoto, o.color, o.sf);
    ctx.restore();
  };
  const porNome = (topo: number) => {
    if (!temNome) return;
    ctx.save();
    ctx.globalAlpha = o.alfaPino * o.rotuloAlpha;
    desenharEtiquetaDaParada(
      ctx,
      o.nome,
      o.sub,
      topo,
      bw,
      bh,
      o.color,
      o.sf,
      lugar.acima,
      encostado ? o.pino.x - lugar.x : 0,
      encostado,
    );
    ctx.restore();
  };

  if (lugar.acima) {
    porFoto(temNome ? bh + gap : 0);
    porNome(0);
  } else {
    porFoto(0);
    porNome(temFoto ? ladoFoto + gap : 0);
  }

  ctx.restore();
}

/**
 * A etiqueta de uma parada: o nome em cima, o km embaixo.
 *
 * `topo` é o y do topo da caixa; `acima` diz de que lado da caixa o pino está
 * (a seta aponta para lá) e `setaX` onde a seta cai dentro dela — a etiqueta
 * pode ter deslizado na horizontal, e a seta continua apontando para o pino.
 */
function desenharEtiquetaDaParada(
  ctx: CanvasRenderingContext2D,
  nome: string,
  sub: string,
  topo: number,
  bw: number,
  bh: number,
  color: string,
  sf: number,
  acima: boolean,
  setaX: number,
  comSeta: boolean,
) {
  roundRect(ctx, -bw / 2, topo, bw, bh, 9 * sf);
  ctx.fillStyle = "rgba(9,12,20,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = hexA(color, 0.85);
  ctx.lineWidth = 1.6 * sf;
  ctx.stroke();

  if (comSeta) {
    const dentro = Math.max(-bw / 2 + 6 * sf, Math.min(bw / 2 - 6 * sf, setaX));
    const base = acima ? topo + bh : topo;
    const ponta = acima ? base + 5 * sf : base - 5 * sf;
    ctx.beginPath();
    ctx.moveTo(dentro - 5 * sf, base);
    ctx.lineTo(dentro + 5 * sf, base);
    ctx.lineTo(dentro, ponta);
    ctx.closePath();
    ctx.fillStyle = "rgba(9,12,20,0.92)";
    ctx.fill();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(13.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.fillText(nome, 0, topo + 15 * sf);
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.fillText(sub, 0, topo + 27 * sf);
}

/**
 * Foto da parada em **círculo**, com o anel na cor da parada.
 *
 * A primeira versão era uma polaroide: quadrado branco com moldura e uma leve
 * rotação. Ficou estranho no vídeo — o branco chamava mais atenção do que a
 * própria foto, e o quadrado parecia um papel colado no mapa. O círculo dialoga
 * com o pino (que já é redondo) e com o avatar da cartela, que também é
 * redondo: os três são a mesma ideia desenhada do mesmo jeito.
 *
 * O que sobrou da polaroide é o que funcionava: o recorte **quadrado e
 * centralizado** (`coverSquare`), então uma foto deitada perde as pontas
 * laterais em vez de sair achatada num oval.
 *
 * O anel tem duas camadas — um contorno escuro fino por fora e a cor da parada
 * por cima. Sem o contorno, a foto sumiria no mapa claro; com ele, aparece nos
 * dois estilos de mapa.
 */
function drawStopCircle(
  ctx: CanvasRenderingContext2D,
  img: { width: number; height: number } & CanvasImageSource,
  cx: number,
  bottomY: number,
  lado: number,
  color: string,
  sf: number,
) {
  const raio = lado / 2;
  const anel = 3 * sf;
  const cy = bottomY - raio;

  ctx.save();
  ctx.translate(cx, cy);

  // aro claro (segura a foto em qualquer mapa)
  ctx.beginPath();
  ctx.arc(0, 0, raio + anel, 0, Math.PI * 2);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12 * sf;
  ctx.shadowOffsetY = 3 * sf;
  ctx.fillStyle = "rgba(9,12,20,0.9)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetY = 0;

  // a foto, recortada no círculo
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, raio, 0, Math.PI * 2);
  ctx.clip();
  const { sx, sy, size } = coverSquare(img.width, img.height);
  ctx.drawImage(
    img as CanvasImageSource,
    sx,
    sy,
    size,
    size,
    -raio,
    -raio,
    lado,
    lado,
  );
  ctx.restore();

  // o anel, na cor da parada — a mesma do pino e da etiqueta
  ctx.beginPath();
  ctx.arc(0, 0, raio + anel / 2, 0, Math.PI * 2);
  ctx.lineWidth = anel;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.restore();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  input: FrameState,
  onDark: boolean,
  sf: number,
) {
  const { style, track, character, t, endpoints } = input;
  const pad = 26 * sf;
  const title = style.title.trim();
  const km = track.total / 1000;
  const kmTxt = formatDistance(km * 1000);
  const aName = endpoints.a?.label.trim();
  const bName = endpoints.b?.label.trim();
  const journey =
    aName && bName ? `${aName} → ${bName}` : aName ? `De ${aName}` : bName ? `Até ${bName}` : "";
  const sub =
    style.subtitle.trim() ||
    (journey
      ? `${journey} · ${kmTxt}`
      : `${kmTxt} · ${character.name.toLowerCase()}`);
  if (!title && !sub) return 0;

  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `800 ${Math.round(30 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const tw = title ? ctx.measureText(title).width : 0;
  ctx.font = `600 ${Math.round(17 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const sw = sub ? ctx.measureText(sub).width : 0;
  const boxW = Math.max(tw, sw) + pad * 1.6;
  const boxH = (title ? 40 * sf : 0) + (sub ? 26 * sf : 0) + pad * 0.9;
  const boxX = pad;
  const boxY = pad;

  const grad = ctx.createLinearGradient(0, boxY, 0, boxY + boxH + 40 * sf);
  grad.addColorStop(0, onDark ? "rgba(3,7,18,0.75)" : "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, boxH + 60 * sf);

  roundRect(ctx, boxX, boxY, boxW, boxH, 16 * sf);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.72)" : "rgba(255,255,255,0.82)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = hexA(style.accent, 0.55);
  ctx.lineWidth = 1.5 * sf;
  ctx.stroke();

  let y = boxY + pad * 0.45;
  if (title) {
    ctx.font = `800 ${Math.round(30 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle = onDark ? "#ffffff" : "#0f172a";
    ctx.textAlign = "left";
    ctx.fillText(title, boxX + pad * 0.8, y);
    y += 40 * sf;
  }
  if (sub) {
    ctx.font = `600 ${Math.round(17 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle = hexA(style.accent, 1);
    ctx.textAlign = "left";
    ctx.fillText(sub, boxX + pad * 0.8, y);
  }

  /*
   * O canto superior direito tem **um** selo: o contador de paradas, quando
   * ligado.
   *
   * A **distância saiu daqui**. Ela já aparece na faixa sob o anel do HUD — com
   * o relógio junto, quando há relógio —, e o mesmo número nos dois cantos,
   * ainda por cima com formatos diferentes ("6.00 km" aqui, "6,00 km" ali),
   * parecia defeito. Um lugar só para cada número.
   *
   * O contador conta **passagens**, não paradas: numa ida e volta, passar de
   * novo pela mesma parada conta de novo. Quando não há repetição (o caso
   * comum), passa a ser a mesma coisa de antes — e o texto continua "paradas".
   */
  const contagem = countPassed(input.stops, input.passages, t);
  const stopsTotal = style.showStopCounter ? contagem.total : 0;
  if (stopsTotal > 0) {
    const stopsPassed = contagem.passed;
    const stopTxt = `${stopsPassed}/${stopsTotal} ${contagem.extras > 0 ? "passagens" : "paradas"}`;
    const badgeFont = `700 ${Math.round(15 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    ctx.font = badgeFont;
    const dh = 28 * sf;
    const dy = pad;
    const stopW = ctx.measureText(stopTxt).width + 34 * sf;
    const sx = width - pad - stopW;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    roundRect(ctx, sx, dy, stopW, dh, dh / 2);
    ctx.fillStyle = "rgba(9,12,20,0.72)";
    ctx.fill();
    ctx.strokeStyle = hexA(stopsPassed === stopsTotal ? "#4ade80" : style.accent, 0.5);
    ctx.lineWidth = 1.5 * sf;
    ctx.stroke();

    ctx.font = `${Math.round(13 * sf)}px ${EMOJI_FONT}`;
    ctx.fillText("📍", sx + 15 * sf, dy + dh / 2 + 1);
    ctx.font = badgeFont;
    ctx.fillStyle = stopsPassed === stopsTotal ? "#4ade80" : "#ffffff";
    ctx.fillText(stopTxt, sx + 22 * sf + (stopW - 26 * sf) / 2, dy + dh / 2 + 1);
  }

  void track;
  ctx.restore();
  return boxY + boxH;
}

/**
 * Quantos segundos a cartela fica na tela, e em quanto tempo ela entra.
 *
 * Contados a partir do fim do vídeo: o personagem chega junto com a cartela
 * ficando legível, e ela continua até o último quadro.
 */
const SUMMARY_FADE_S = 0.6; // a cartela entra em meio segundo

/**
 * Cartela final: distância, elevação e tempo do percurso.
 *
 * Só desenha o que o arquivo trouxe (a montagem das tiras é do `stats.ts`),
 * então uma rota desenhada à mão mostra um número, e uma pedalada importada
 * mostra a fileira inteira.
 */
/**
 * Cartela final: os números digitados no painel e a linha de baixo.
 *
 * Nada é medido aqui — o que aparece é o que foi escrito (a montagem é do
 * `endCard`, no stats.ts). A única decisão deste desenho é **caber**: os
 * textos vêm de um campo livre, então o corpo da letra encolhe antes de o
 * excesso virar "…", e o texto nunca vaza da tela em retrato.
 */
/**
 * Foto do projeto em círculo, com um aro claro em volta.
 *
 * O recorte é quadrado e centralizado (o mesmo `coverSquare` da polaroide da
 * parada), então uma foto deitada não vira um oval achatado: perde as laterais
 * e mantém o assunto no meio.
 */
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: { width: number; height: number } & CanvasImageSource,
  cx: number,
  cy: number,
  raio: number,
  onDark: boolean,
  sf: number,
) {
  ctx.save();
  // aro
  ctx.beginPath();
  ctx.arc(cx, cy, raio + 3 * sf, 0, Math.PI * 2);
  ctx.fillStyle = onDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.clip();
  const { sx, sy, size } = coverSquare(img.width, img.height);
  ctx.drawImage(
    img as CanvasImageSource,
    sx,
    sy,
    size,
    size,
    cx - raio,
    cy - raio,
    raio * 2,
    raio * 2,
  );
  ctx.restore();
}

/**
 * Onde a cartela final fica e quanto ela está visível.
 *
 * A medida é separada do desenho por um motivo prático: o pino da chegada
 * precisa saber **onde a cartela vai cair** para sair de baixo dela. Antes, a
 * cartela era desenhada por último e simplesmente cobria o pino B, o nome e a
 * foto da chegada.
 */
export type SummaryLayout = {
  /** quanto da cartela está visível (a entrada é suave) */
  alpha: number;
  pad: number;
  gap: number;
  valorFs: number;
  labelFs: number;
  noteFs: number;
  colunas: { label: string; value: string; w: number }[];
  nota: string | null;
  totalW: number;
  avatar: PhotoImage | null;
  ladoAvatar: number;
  alturaAvatar: number;
  /** logo da marca, já medido (0×0 quando não há) */
  logo: PhotoImage | null;
  /** quanto o logo ocupa da altura, acima dos números */
  alturaLogo: number;
  logoX: number;
  logoY: number;
  logoW: number;
  logoH: number;
  /** placa clara atrás do logo */
  logoChip: boolean;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
};

export function summaryBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: FrameState,
  sf: number,
  /**
   * Lugares que a cartela **não pode cobrir** (normalmente os pinos A e B).
   *
   * A cartela é centrada na tela e a chegada acontece no meio dela: o usuário
   * via a cartela em cima do ponto B (\"ajuste a cartela para não ficar em cima
   * do ponto B na chegada\"). Aqui ela sai do caminho — sobe ou desce o
   * mínimo necessário, ficando com a tela toda de folga se couber.
   */
  evitar?: { x: number; y: number; r: number }[] | null,
): SummaryLayout | null {
  const card = input.summary;
  if (!card || (card.tiles.length === 0 && !card.note)) return null;

  /*
   * A cartela entra quando o **percurso termina** — não a uma fatia do fim do
   * vídeo. Antes ela começava em 79% do trajeto (4,2 s antes do fim) e cobria o
   * fim do percurso: o usuário viu isso como "cartela aparecendo muito antes".
   */
  const tl = timelineOr(input.timeline, input.duration);
  const inicio = routeEnd(tl);
  if (input.elapsed < inicio) return null;
  const alpha =
    SUMMARY_FADE_S > 0
      ? Math.min(1, Math.max(0, (input.elapsed - inicio) / SUMMARY_FADE_S))
      : 1;

  const pad = 34 * sf;
  const gap = 34 * sf;
  const maxW = width * 0.92;

  const fValor = (px: number) =>
    `800 ${Math.round(px)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fLabel = (px: number) =>
    `600 ${Math.round(px)}px "Inter","Segoe UI",system-ui,sans-serif`;

  /** Corta com "…" o que não couber na largura dada, medindo de verdade. */
  const cortar = (texto: string, max: number, fonte: string) => {
    ctx.font = fonte;
    if (ctx.measureText(texto).width <= max) return texto;
    let fim = texto.length;
    while (fim > 1 && ctx.measureText(`${texto.slice(0, fim - 1)}…`).width > max) fim--;
    return `${texto.slice(0, Math.max(1, fim - 1)).trimEnd()}…`;
  };

  /** Com este corpo de letra, cabe na tela? */
  const medirCom = (vFs: number, nFs: number) => {
    const labelFs = Math.round(vFs * 0.27);
    ctx.font = fValor(vFs);
    const valores = card.tiles.map((t) => ctx.measureText(t.value).width);
    ctx.font = fLabel(labelFs);
    const labels = card.tiles.map((t, i) =>
      Math.max(valores[i], ctx.measureText(t.label.toUpperCase()).width),
    );
    const tiras = labels.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1);
    ctx.font = fLabel(nFs);
    const nota = card.note ? ctx.measureText(card.note).width : 0;
    return { labelFs, precisa: Math.max(tiras, nota) + pad * 2 };
  };

  // 1) encolhe o corpo da letra até caber (ou até o piso)
  let valorFs = Math.round(46 * sf);
  const piso = Math.round(valorFs * 0.55);
  let noteFs = Math.round(15 * sf);
  let medida = medirCom(valorFs, noteFs);
  while (medida.precisa > maxW && valorFs > piso) {
    valorFs = Math.max(piso, valorFs - 2);
    noteFs = Math.max(Math.round(11 * sf), Math.round(valorFs * 0.33));
    medida = medirCom(valorFs, noteFs);
  }
  const labelFs = medida.labelFs;

  // 2) o que ainda não couber vira "…"
  const larguraTira = Math.max(
    60 * sf,
    (maxW - pad * 2 - gap * Math.max(0, card.tiles.length - 1)) /
      Math.max(1, card.tiles.length),
  );
  const tiras = card.tiles.map((t) => ({
    label: t.label.toUpperCase(),
    value: cortar(t.value, larguraTira, fValor(valorFs)),
  }));
  const nota = card.note ? cortar(card.note, maxW - pad * 2, fLabel(noteFs)) : null;

  // 3) mede o que será desenhado de fato, para a caixa abraçar o conteúdo
  ctx.font = fValor(valorFs);
  const larguraValor = tiras.map((t) => ctx.measureText(t.value).width);
  ctx.font = fLabel(labelFs);
  const larguraLabel = tiras.map((t) => ctx.measureText(t.label).width);
  const colunas = tiras.map((t, i) => ({
    ...t,
    w: Math.max(larguraValor[i], larguraLabel[i]),
  }));
  const totalW = colunas.reduce((a, c) => a + c.w, 0) + gap * Math.max(0, colunas.length - 1);
  ctx.font = fLabel(noteFs);
  const notaW = nota ? ctx.measureText(nota).width : 0;

  /*
   * Foto do projeto no alto da cartela, em círculo.
   *
   * O tamanho dela entra na conta da altura da caixa: sem isso o avatar
   * empurraria os números para fora do painel.
   */
  const avatar =
    input.cardPhoto && input.photos ? input.photos.get(input.cardPhoto) : null;
  const ladoAvatar = Math.round(78 * sf);
  const alturaAvatar = avatar ? ladoAvatar + 14 * sf : 0;

  /*
   * Logo da marca.
   *
   * Medido **antes** da largura da caixa: sozinho no alto, ele é o conteúdo
   * mais largo da cartela e a caixa precisa caber nele. Ao lado do avatar, é
   * ele que se ajusta ao espaço que sobra (e nunca encosta no círculo).
   */
  const logo =
    input.style.logo && input.photos ? input.photos.get(input.style.logo) : null;
  const larguraMinimaLogo = logo && !avatar ? 96 * sf : 0;

  const boxW = Math.min(maxW, Math.max(totalW, notaW, larguraMinimaLogo) + pad * 2);
  const alturaLogoMax = avatar ? 40 * sf : 54 * sf;
  const larguraLogoMax = avatar
    ? Math.max(0, boxW / 2 - ladoAvatar / 2 - 24 * sf - pad * 0.8)
    : boxW - pad * 2;
  const logoTam = logo ? medidaDoLogo(logo, alturaLogoMax, larguraLogoMax) : null;
  const alturaLogo = logoTam && !avatar ? logoTam.h + 14 * sf : 0;

  const altura =
    alturaAvatar +
    alturaLogo +
    (colunas.length > 0 ? valorFs * 1.15 + labelFs * 1.35 : 0) +
    (nota ? noteFs * 1.5 : 0) +
    pad * 1.6;
  const boxX = (width - boxW) / 2;
  const margem = 18 * sf;
  let boxY = Math.max(margem, Math.min(height - altura - margem, (height - altura) / 2));

  /*
   * Sai da frente dos pinos das pontas: para cada lugar que a caixa alcançaria,
   * escolhe o lado (acima ou abaixo) que exige o menor deslocamento — e só
   * desloca se a caixa couber inteira naquele lado. Onde não couber, fica como
   * está e o pino é quem se desvia (ver `liftToClear`).
   */
  for (const ob of evitar ?? []) {
    const topoObs = ob.y - ob.r;
    const baseObs = ob.y + ob.r;
    if (boxY + altura <= topoObs || boxY >= baseObs) continue;
    const acima = topoObs - margem - altura;
    const abaixo = baseObs + margem;
    const cabeAcima = acima >= margem;
    const cabeAbaixo = abaixo + altura <= height - margem;
    if (cabeAcima && cabeAbaixo) {
      // empate resolve para **baixo**: em cima ficam o HUD e o aviso do lugar,
      // e a cartela cobriria justamente os números que ela está repetindo
      boxY = Math.abs(abaixo - boxY) <= Math.abs(acima - boxY) ? abaixo : acima;
    } else if (cabeAcima) {
      boxY = acima;
    } else if (cabeAbaixo) {
      boxY = abaixo;
    }
  }

  /*
   * Onde o logo cai: na linha do avatar (centrado com ele) ou, sem avatar, no
   * alto do painel, centralizado.
   */
  const logoH = logoTam?.h ?? 0;
  const logoW = logoTam?.w ?? 0;
  const logoX = avatar ? boxX + pad * 0.8 : boxX + (boxW - logoW) / 2;
  const logoY = avatar ? boxY + pad * 0.55 + (ladoAvatar - logoH) / 2 : boxY + pad * 0.55;

  return {
    alpha,
    pad,
    gap,
    valorFs,
    labelFs,
    noteFs,
    colunas,
    nota,
    totalW,
    avatar,
    ladoAvatar,
    alturaAvatar,
    alturaLogo,
    logo,
    logoX,
    logoY,
    logoW,
    logoH,
    logoChip: !!input.style.logoChip,
    boxX,
    boxY,
    boxW,
    boxH: altura,
  };
}

/**
 * O tamanho do logo na cartela, mantendo a proporção da imagem.
 *
 * Cabe em `maxH` de altura e `maxW` de largura, o que estourar primeiro manda.
 * Devolve 0×0 quando não há espaço (cartela estreita demais) — e aí o logo
 * simplesmente não é desenhado, em vez de sair esmagado.
 */
export function medidaDoLogo(
  img: { width: number; height: number },
  maxH: number,
  maxW: number,
): { w: number; h: number } {
  if (!(maxH > 0) || !(maxW > 0)) return { w: 0, h: 0 };
  const w0 = Number(img.width) || 0;
  const h0 = Number(img.height) || 0;
  if (!(w0 > 0) || !(h0 > 0)) return { w: 0, h: 0 };
  const razao = w0 / h0;
  let h = Math.min(maxH, maxW / razao);
  let w = h * razao;
  if (w > maxW) {
    w = maxW;
    h = w / razao;
  }
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/** Desenha a cartela já medida por `summaryBox`. */
function drawSummary(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  L: SummaryLayout,
  onDark: boolean,
  sf: number,
) {
  const {
    alpha,
    pad,
    gap,
    valorFs,
    labelFs,
    noteFs,
    colunas,
    nota,
    totalW,
    avatar,
    ladoAvatar,
    alturaAvatar,
    alturaLogo,
    logo,
    logoX,
    logoY,
    logoW,
    logoH,
    logoChip,
    boxX,
    boxY,
    boxW,
    boxH: altura,
  } = L;
  const claro = !onDark;
  const fValor = (px: number) =>
    `800 ${Math.round(px)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fLabel = (px: number) =>
    `600 ${Math.round(px)}px "Inter","Segoe UI",system-ui,sans-serif`;

  ctx.save();
  ctx.globalAlpha = alpha;

  // escurece a cena para o texto não brigar com o mapa
  ctx.fillStyle = onDark ? "rgba(3,7,18,0.45)" : "rgba(15,23,42,0.32)";
  ctx.fillRect(0, 0, width, height);

  roundRect(ctx, boxX, boxY, boxW, altura, 20 * sf);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.82)" : "rgba(255,255,255,0.88)";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 26 * sf;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2 * sf;
  ctx.strokeStyle = onDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";
  ctx.stroke();

  if (avatar) {
    drawAvatar(
      ctx,
      avatar,
      boxX + boxW / 2,
      boxY + pad * 0.55 + ladoAvatar / 2,
      ladoAvatar / 2,
      onDark,
      sf,
    );
  }

  /*
   * O logo da marca. A placa clara é opcional: logo escuro (ou de fundo
   * transparente escuro) some no painel escuro da cartela, e a placa resolve
   * isso sem ninguém ter de editar a imagem.
   */
  if (logo && logoW > 0 && logoH > 0) {
    if (logoChip) {
      roundRect(ctx, logoX - 8 * sf, logoY - 6 * sf, logoW + 16 * sf, logoH + 12 * sf, 8 * sf);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
    }
    ctx.drawImage(logo as CanvasImageSource, logoX, logoY, logoW, logoH);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let base = boxY + pad * 0.8 + alturaAvatar + alturaLogo + valorFs * 0.85;

  if (colunas.length > 0) {
    let x = boxX + (boxW - totalW) / 2;
    for (const c of colunas) {
      ctx.font = fValor(valorFs);
      ctx.fillStyle = claro ? "#0f172a" : "#ffffff";
      ctx.fillText(c.value, x + c.w / 2, base);

      ctx.font = fLabel(labelFs);
      ctx.fillStyle = claro ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.6)";
      ctx.fillText(c.label, x + c.w / 2, base + labelFs * 1.5);
      x += c.w + gap;
    }
    base += labelFs * 1.35;
  }

  if (nota) {
    ctx.font = fLabel(noteFs);
    ctx.fillStyle = claro ? "rgba(15,23,42,0.62)" : "rgba(255,255,255,0.68)";
    ctx.fillText(nota, boxX + boxW / 2, base + noteFs * 1.6);
  }

  ctx.restore();
}

/**
 * Relógio do HUD: qual tempo mostrar, e de onde ele vem.
 *
 * A ordem é a do dado mais fiel para o menos:
 * 1. **hora do arquivo** (GPX de GPS): o tempo real da pedalada;
 * 2. **tempo escrito na cartela**: o número que o usuário pôs ali, contado até
 *    o fim do vídeo;
 * 3. **nenhum**: o HUD fica sem relógio.
 *
 * A terceira linha existe porque a reserva antiga era o tempo do vídeo, e isso
 * confundia: o HUD parecia mostrar o tempo da pedalada e mostrava a duração do
 * clipe — que a barra de progresso já representa.
 */
/**
 * Horas do arquivo, **mas só se estiverem alinhadas ao traçado desenhado**.
 *
 * O traçado de desenho é uma redução do arquivo (teto de 12.000 pontos), e um
 * GPX de 50.000 pontos vira 10.001. Se as horas viessem do arquivo inteiro, os
 * índices apontariam para pontos que não estão na tela — medido antes da
 * correção: o relógio lia `1:23:20` na metade de uma pedalada de 13:53:19, cinco
 * vezes menos do que devia. Como o renderizador não tem como adivinhar de qual
 * traçado o vetor veio, ele confere o tamanho: em vez de um número errado,
 * mostra "sem arquivo".
 *
 * O app manda o vetor do traçado desenhado (mesmos pontos, com as mesmas horas).
 */
function horasAlinhadas(input: FrameState, track: Track): number[] | null {
  const times = input.times;
  if (!times || times.length !== track.pts.length) return null;
  return times;
}

function hudClock(
  track: Track,
  t: number,
  duration: number,
  times: number[] | null,
  cardSeconds: number | null,
): { segundos: number | null; fonte: "arquivo" | "cartela" | null } {
  if (times) {
    /*
     * O relógio tem de andar no **mesmo** caminho que o personagem. Com o `cum`
     * medido, o índice certo para o mesmo `t` era outro (as duas distâncias
     * divergem até 39× num segmento) e o relógio do HUD acelerava e travava
     * junto com o mapa.
     */
    const real = elapsedAt(track.pts, cumDoDesenho(track), t, times);
    if (real !== null) return { segundos: real, fonte: "arquivo" };
  }
  if (cardSeconds && cardSeconds > 0) {
    return { segundos: Math.max(0, Math.min(1, t)) * cardSeconds, fonte: "cartela" };
  }
  void duration;
  return { segundos: null, fonte: null };
}

/**
 * HUD em anel, abaixo do título.
 *
 * O anel é o andamento do percurso (o arco cresce no sentido horário) e o
 * centro é a velocidade. Fica **abaixo do cabeçalho** porque o título pinta uma
 * faixa de ponta a ponta no topo do vídeo — no canto de cima o anel brigava com
 * ela.
 *
 * Sobre a velocidade, a mesma honestidade de antes: com hora no arquivo é a
 * velocidade daquele instante; sem hora, mas com tempo na cartela, é a média
 * (distância ÷ tempo escrito) e o rótulo diz `média`; sem um nem outro, um
 * traço.
 */
function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  input: FrameState,
  sample: { distance: number },
  sf: number,
  onDark: boolean,
  headerBottom: number,
  /**
   * Inclinação do trecho no instante atual, em % (positiva = subida).
   *
   * Só é usada quando **não há relógio nenhum** para mostrar — rota sem
   * horário e sem tempo escrito na cartela. É a leitura da prévia de percurso.
   */
  declive: number | null = null,
) {
  const { track, t, style, duration, cardSeconds } = input;
  const times = horasAlinhadas(input, track);
  if (track.pts.length === 0) return;

  const relogio = hudClock(track, t, duration, times, cardSeconds);
  const comArquivo = relogio.fonte === "arquivo";
  const media = !comArquivo && relogio.fonte === "cartela";

  const medida = comArquivo ? speedAt(track.pts, track.cum, t, times!) : null;
  const velocidade = comArquivo
    ? Math.max(0, medida ?? 0)
    : media
      ? (track.total / (cardSeconds as number)) * 3.6
      : null;

  /*
   * Ritmo (min/km) para corrida e caminhada: é o número que quem vai a pé olha,
   * e é a **média do percurso** — tempo total ÷ distância. O tempo sai da mesma
   * fonte honesta do relógio, só que no **fim** do percurso (`t = 1`): hora do
   * arquivo ou o tempo escrito na cartela; sem os dois, um traço.
   */
  const totalPerc = style.pace ? hudClock(track, 1, duration, times, cardSeconds) : null;
  const ritmoSeg = totalPerc ? averagePace(totalPerc.segundos, track.total) : null;

  const claro = !onDark;
  const pad = 22 * sf;
  const r = 54 * sf;
  const anel = 9 * sf;
  const cx = width - pad - r - anel / 2;
  // abaixo do cabeçalho; se não houver título, mantém a margem do topo
  const topo = Math.max(headerBottom, 0) + pad * 0.6;
  const cy = topo + r + anel / 2;

  const fUni = `700 ${Math.round(13 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fNota = `600 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fInfo = `700 ${Math.round(13 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;

  ctx.save();

  // fundo do anel (disco translúcido) para o número não brigar com o mapa
  ctx.beginPath();
  ctx.arc(cx, cy, r + anel / 2, 0, Math.PI * 2);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.62)" : "rgba(255,255,255,0.78)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 16 * sf;
  ctx.fill();
  ctx.shadowBlur = 0;

  // trilha do anel
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = anel;
  ctx.strokeStyle = claro ? "rgba(15,23,42,0.14)" : "rgba(255,255,255,0.2)";
  ctx.stroke();

  // arco do andamento: começa no topo e cresce no sentido horário
  const progresso = Math.max(0, Math.min(1, t));
  if (progresso > 0.001) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progresso);
    ctx.lineWidth = anel;
    ctx.lineCap = "round";
    ctx.strokeStyle = style.accent;
    ctx.shadowColor = style.accent;
    ctx.shadowBlur = 12 * sf;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /*
   * Sem relógio nenhum (arquivo sem horário e cartela sem tempo), o anel deixa
   * de mostrar um traço e a palavra "sem arquivo" — que, num vídeo de prévia de
   * percurso, é o vídeo inteiro dizendo que falta dado.
   *
   * 1. Com elevação: a **inclinação do trecho**, a mesma que colore a linha;
   * 2. sem elevação: **quanto falta**, que existe em qualquer traçado.
   */
  const semRelogio = relogio.fonte === null;
  const previa = semRelogio
    ? declive !== null
      ? { valor: Math.abs(declive).toFixed(1).replace(".", ","), unidade: "%" as const, nota: notaDoDeclive(declive) }
      : {
          valor: (
            Math.max(0, track.total - sample.distance) / 1000
          ).toFixed(1).replace(".", ","),
          unidade: "km" as const,
          nota: "restantes",
        }
    : null;

  // o número do centro: velocidade (km/h) ou ritmo (min/km)
  const txtVel = previa
    ? previa.valor
    : style.pace
      ? ritmoSeg === null
        ? "—"
        : formatPace(ritmoSeg)
      : velocidade === null
        ? "—"
        : velocidade.toFixed(velocidade < 10 ? 1 : 0);
  // `12:30` ocupa mais que `18`: a fonte se ajusta para não bater no aro
  const fVel = `800 ${Math.round((txtVel.length > 4 ? 25 : 30) * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  /*
   * O rótulo de cima diz **o que** é o número. `média` vale quando o número é
   * média (ritmo sempre é; velocidade quando vem da cartela). Quando não há
   * base, o rótulo diz por quê — e "percurso curto" é diferente de "sem
   * arquivo": um é falta de dado, o outro é dado de menos.
   */
  const nota = previa
    ? previa.nota
    : style.pace
      ? !totalPerc || totalPerc.segundos === null
        ? "sem arquivo"
        : ritmoSeg === null
          ? "percurso curto"
          : "média"
      : media
        ? "média"
        : velocidade === null
          ? "sem arquivo"
          : null;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = fVel;
  ctx.fillStyle = claro ? "#0f172a" : "#ffffff";
  ctx.fillText(txtVel, cx, cy + 4 * sf);
  ctx.font = fUni;
  ctx.fillStyle = claro ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.62)";
  ctx.fillText(previa ? previa.unidade : style.pace ? "min/km" : "km/h", cx, cy + 22 * sf);
  if (nota) {
    ctx.font = fNota;
    ctx.fillStyle = claro ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.45)";
    ctx.fillText(nota, cx, cy - 26 * sf);
  }

  // faixa abaixo do anel: distância percorrida · relógio (quando há relógio)
  const linha = formatDistance(sample.distance);
  const relogioTxt = relogio.segundos === null ? null : formatClock(relogio.segundos);
  const texto = relogioTxt ? `${linha}  ·  ${relogioTxt}` : linha;

  ctx.font = fInfo;
  const wTexto = ctx.measureText(texto).width;
  const larguraFaixa = wTexto + 22 * sf;
  const yFaixa = cy + r + anel / 2 + 8 * sf;
  roundRect(ctx, cx - larguraFaixa / 2, yFaixa, larguraFaixa, 24 * sf, 12 * sf);
  ctx.fillStyle = onDark ? "rgba(9,12,20,0.62)" : "rgba(255,255,255,0.78)";
  ctx.fill();
  ctx.fillStyle = claro ? "#0f172a" : "#ffffff";
  ctx.fillText(texto, cx, yFaixa + 16 * sf);

  ctx.restore();
}

/**
 * Como se lê uma inclinação no anel do HUD: `subindo`, `descendo` ou `plano`.
 *
 * O número vai **sem sinal** (a palavra já diz o sentido), e o plano tem faixa
 * própria porque 0,2% é plano na vida real e na cor da linha também (o corte
 * neutro da escala é ±1%).
 */
function notaDoDeclive(pct: number): string {
  if (Math.abs(pct) < 0.5) return "plano";
  return pct > 0 ? "subindo" : "descendo";
}

/**
 * A faixa do perfil de elevação.
 *
 * Desenho: um painel translúcido no rodapé com a linha do relevo. O trecho
 * **já percorrido** vem preenchido na cor do app; o que falta fica só na linha.
 * Em cima dela, o marcador da altitude atual (um ponto com o número), a maior
 * subida marcada com uma faixa e a inclinação média dela — é a leitura que quem
 * vai encarar a prova quer ter antes de sair.
 */
function drawProfile(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  o: {
    perfil: TrailProfile;
    /** progresso do percurso, 0..1 */
    frac: number;
    /** distância total, em metros (para a inclinação da subida) */
    totalM: number;
    accent: string;
    sf: number;
    onDark: boolean;
    /** a barra de progresso ocupa o pé do quadro? */
    progressoAbaixo: boolean;
    /** 0..1: o quanto a cartela final está cobrindo o rodapé */
    apagando: number;
    /** 0..1: o quanto a faixa já entrou (0 durante o voo de abertura) */
    entrando: number;
  },
) {
  const { perfil, sf, accent } = o;
  const alfa = Math.min(1, Math.max(0, o.entrando)) * (1 - Math.min(1, Math.max(0, o.apagando)));
  if (alfa < 0.02) return;
  if (perfil.pontos.length < 2) return;

  const L = profileLayout(width, height, sf, o.progressoAbaixo);
  const claro = !o.onDark;
  const frac = Math.min(1, Math.max(0, Number.isFinite(o.frac) ? o.frac : 0));

  /*
   * Duas zonas, para os rótulos nunca brigarem com a linha:
   *
   * - uma **linha de cabeçalho** no alto do painel, com a altitude máxima à
   *   esquerda e o D+ (com a maior subida) à direita;
   * - o **gráfico** abaixo dela. O marcador do instante atual desenha o seu
   *   número perto do ponto, e escolhe o lado conforme o espaço — acima quando
   *   o ponto está baixo, abaixo quando está no alto.
   *
   * A primeira versão punha os três rótulos na mesma faixa e, num perfil com
   * pico à direita, o "568 m" do marcador caía em cima do "D+ 1.279 m".
   */
  const dentro = 10 * sf;
  const x0 = L.x + dentro;
  const x1 = L.x + L.w - dentro;
  const largura = Math.max(8, x1 - x0);
  const linhaDoCabecalho = L.y + 9 * sf;
  const yTopo = L.y + 20 * sf;
  const yBase = L.y + L.h - 9 * sf;
  const altura = Math.max(8, yBase - yTopo);

  const alturaDe = (ele: number) => {
    const faixa = Math.max(1, perfil.max - perfil.min);
    const f = (ele - perfil.min) / faixa;
    return yBase - Math.min(1, Math.max(0, f)) * altura;
  };
  const xDe = (f: number) => x0 + Math.min(1, Math.max(0, f)) * largura;

  ctx.save();
  ctx.globalAlpha = alfa;

  // painel
  roundRect(ctx, L.x, L.y, L.w, L.h, L.raio);
  ctx.fillStyle = o.onDark ? "rgba(9,12,20,0.74)" : "rgba(255,255,255,0.86)";
  ctx.shadowColor = "rgba(0,0,0,0.32)";
  ctx.shadowBlur = 14 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = o.onDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)";
  ctx.lineWidth = 1 * sf;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, L.x, L.y, L.w, L.h, L.raio);
  ctx.clip();

  // a faixa da maior subida, atrás de tudo
  const subida = perfil.maiorSubida;
  const inclinacao = inclinacaoDaSubida(perfil, o.totalM);
  if (subida) {
    const a = xDe(subida.ini);
    const b = xDe(subida.fim);
    if (b - a > 2) {
      ctx.fillStyle = hexA(accent, 0.14);
      ctx.fillRect(a, L.y, b - a, L.h);
    }
  }

  /** o caminho da linha do relevo, inteiro ou só até `ate` (0..1) */
  const caminho = (ate: number) => {
    ctx.beginPath();
    let aberto = false;
    for (const p of perfil.pontos) {
      if (p.frac > ate) break;
      const x = xDe(p.frac);
      const y = alturaDe(p.ele);
      if (!aberto) {
        ctx.moveTo(x, y);
        aberto = true;
      } else ctx.lineTo(x, y);
    }
    return aberto;
  };

  // a linha inteira, apagada: é o "o que ainda vem"
  if (caminho(1)) {
    ctx.strokeStyle = o.onDark ? "rgba(255,255,255,0.38)" : "rgba(15,23,42,0.32)";
    ctx.lineWidth = 1.6 * sf;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // o já percorrido, preenchido na cor do app
  if (frac > 0.0005 && caminho(frac)) {
    const atual = elevacaoEm(perfil, frac);
    ctx.lineTo(xDe(frac), yBase);
    ctx.lineTo(x0, yBase);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, yTopo, 0, yBase);
    grad.addColorStop(0, hexA(accent, 0.55));
    grad.addColorStop(1, hexA(accent, 0.08));
    ctx.fillStyle = grad;
    ctx.fill();

    // e a linha de cima, sólida (o preenchimento sozinho some no mapa claro)
    if (caminho(frac)) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2 * sf;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    void atual;
  }

  // o marcador do instante atual: ponto + altitude
  const eleAgora = elevacaoEm(perfil, frac);
  if (eleAgora !== null) {
    const mx = xDe(frac);
    const my = alturaDe(eleAgora);
    ctx.beginPath();
    ctx.arc(mx, my, 4.2 * sf, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10 * sf;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.arc(mx, my, 1.8 * sf, 0, Math.PI * 2);
    ctx.fillStyle = o.onDark ? "rgba(9,12,20,0.9)" : "#ffffff";
    ctx.fill();

    /*
     * O número, ao lado do ponto: **acima** quando há espaço, abaixo quando o
     * ponto está no alto do gráfico (senão o texto sobe para dentro do
     * cabeçalho). E desliza para dentro quando o ponto está na ponta.
     */
    const txt = `${Math.round(eleAgora)} m`;
    ctx.font = `700 ${Math.round(11 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    ctx.textAlign = "center";
    const meia = ctx.measureText(txt).width / 2;
    const tx = Math.min(x1 - meia, Math.max(x0 + meia, mx));
    const cabeAcima = my - yTopo > 16 * sf;
    ctx.textBaseline = cabeAcima ? "bottom" : "top";
    const ty = cabeAcima ? my - 8 * sf : my + 8 * sf;
    ctx.fillStyle = claro ? "#0f172a" : "#ffffff";
    ctx.fillText(txt, tx, ty);
  }
  ctx.restore();

  /*
   * Os rótulos das pontas: a altitude máxima (no alto da linha) e a inclinação
   * da maior subida. Ficam **fora** do recorte para não serem cortados quando a
   * linha encosta na borda do painel.
   */
  ctx.font = `700 ${Math.round(10 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = o.onDark ? "rgba(255,255,255,0.62)" : "rgba(15,23,42,0.55)";
  ctx.fillText(`${Math.round(perfil.max)} m`, L.x + dentro, linhaDoCabecalho);

  ctx.textAlign = "right";
  const dmais = `D+ ${Math.round(perfil.ganho)} m`;
  let rotulo = dmais;
  if (subida && inclinacao !== null && Number.isFinite(inclinacao)) {
    rotulo = `${dmais}  ·  subida ${inclinacao.toFixed(1).replace(".", ",")}%`;
  }
  ctx.fillStyle = o.onDark ? "rgba(255,255,255,0.78)" : "rgba(15,23,42,0.72)";
  ctx.fillText(rotulo, L.x + L.w - dentro, linhaDoCabecalho);

  ctx.restore();
}

function drawProgress(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: FrameState,
  sf: number,
) {
  const { t, style, track } = input;
  const pad = 30 * sf;
  const barH = 8 * sf;
  const y = height - pad - barH;
  const w = width - pad * 2;

  const grad = ctx.createLinearGradient(0, height - pad * 3.4, 0, height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, height - pad * 3.4, width, pad * 3.4);

  ctx.save();
  roundRect(ctx, pad, y, w, barH, barH / 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  const fw = Math.max(barH, w * t);
  roundRect(ctx, pad, y, fw, barH, barH / 2);
  ctx.fillStyle = style.accent;
  ctx.shadowColor = style.accent;
  ctx.shadowBlur = 12 * sf;
  ctx.fill();
  ctx.restore();

  /*
   * Paradas marcadas na própria linha do tempo do vídeo — **uma marca por
   * passagem**. Numa ida e volta, a parada da metade aparece duas vezes na
   * barra: a marca da ida acende na ida, a da volta acende na volta.
   */
  if (style.showStops && input.stops.length > 0) {
    for (const stop of input.stops) {
      const passagens = input.passages?.[stop.id] ?? [stop.t];
      for (const ts of passagens) {
        const sx = pad + w * ts;
        const cy = y + barH / 2;
        const passed = t >= ts;
        const r = (passed ? 9 : 7) * sf;

        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(9,12,20,0.95)";
        if (passed) {
          ctx.shadowColor = stop.color;
          ctx.shadowBlur = 10 * sf;
        }
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 1.8 * sf;
        ctx.strokeStyle = passed ? stop.color : "rgba(255,255,255,0.35)";
        ctx.stroke();

        ctx.globalAlpha = passed ? 1 : 0.55;
        ctx.font = `${Math.round(r * 1.15)}px ${EMOJI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(stop.emoji, sx, cy + 0.5 * sf);
        ctx.restore();
      }
    }
  }

  ctx.font = `700 ${Math.round(13 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const totalKm = track.total / 1000;
  ctx.fillText(
    `${(t * totalKm).toFixed(totalKm < 10 ? 2 : 1)} de ${totalKm.toFixed(totalKm < 10 ? 2 : 1)} km`,
    pad,
    y - 8 * sf,
  );
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(t * 100)}%`, pad + w, y - 8 * sf);
}

/* ------------------------------------------------------------------ */
/* Traçado colorido e marcas de km                                     */
/* ------------------------------------------------------------------ */

/** Pontos visíveis já projetados na tela, em vetores reaproveitados. */
type PontoProjetado = { x: Float64Array; y: Float64Array };

/** Monta o caminho de uma lista de trechos (terminando opcionalmente em `ate`). */
function pathOf(
  ctx: CanvasRenderingContext2D,
  pts: LatLng[],
  toXY: (p: LatLng) => { x: number; y: number },
  runs: IndexRange[],
  ate?: { x: number; y: number },
) {
  ctx.beginPath();
  let aberto = false;
  for (const [ini, fim] of runs) {
    const a = toXY(pts[ini]);
    ctx.moveTo(a.x, a.y);
    aberto = true;
    for (let i = ini + 1; i <= fim; i++) {
      const { x, y } = toXY(pts[i]);
      ctx.lineTo(x, y);
    }
  }
  if (ate) {
    if (aberto) ctx.lineTo(ate.x, ate.y);
    else ctx.moveTo(ate.x, ate.y);
  }
}

/**
 * Desenha o traçado colorido — **uma passada por faixa de cor**.
 *
 * O caminho de cada faixa é montado com os segmentos que caíram nela e vai
 * para a tela num único `stroke()`. São nove traços (oito faixas + o cinza dos
 * pontos sem dado) no lugar de um por segmento — a diferença entre um vídeo
 * que grava e um que engasga.
 */
function strokeColored(
  ctx: CanvasRenderingContext2D,
  proj: PontoProjetado,
  runs: IndexRange[],
  colored: ColoredRoute,
  width: number,
  alpha: number,
  tail?: { x: number; y: number; band: number },
) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  for (let faixa = -1; faixa < colored.colors.length; faixa++) {
    ctx.beginPath();
    let caneta = false;
    for (const [ini, fim] of runs) {
      caneta = false;
      for (let i = ini; i < fim; i++) {
        const b = colored.bands[i];
        const bate = faixa < 0 ? !Number.isFinite(b) : b === faixa;
        if (!bate) {
          caneta = false;
          continue;
        }
        if (!caneta) {
          ctx.moveTo(proj.x[i], proj.y[i]);
          caneta = true;
        }
        ctx.lineTo(proj.x[i + 1], proj.y[i + 1]);
      }
    }
    if (tail) {
      const tb = Number.isFinite(tail.band) ? tail.band : -1;
      if (tb === faixa && runs.length > 0) {
        const fim = runs[runs.length - 1][1];
        ctx.moveTo(proj.x[fim], proj.y[fim]);
        ctx.lineTo(tail.x, tail.y);
      }
    }
    ctx.strokeStyle = faixa < 0 ? NEUTRAL_COLOR : colored.colors[faixa];
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Marcas de km: um ponto no traçado e, quando cabe, o número ao lado.
 *
 * O texto só sai nas marcas redondas (ou quando o passo já é largo): numa rota
 * longa, um número por km seria uma fileira de etiquetas cobrindo o mapa.
 */
function drawKmMarks(
  ctx: CanvasRenderingContext2D,
  pts: LatLng[],
  toXY: (p: LatLng) => { x: number; y: number },
  marks: KmMark[],
  sf: number,
  width: number,
  height: number,
) {
  const fs = Math.round(Math.max(9, 10.5 * sf));
  for (const m of marks) {
    const p = pts[m.index];
    if (!p) continue;
    const { x, y } = toXY(p);
    if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue;

    const r = (m.major ? 5.4 : 4.2) * sf;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(9,12,20,0.92)";
    ctx.fill();
    ctx.lineWidth = 1.7 * sf;
    ctx.strokeStyle = m.major ? "#ffffff" : "rgba(255,255,255,0.72)";
    ctx.stroke();

    if (!m.label) continue;
    const txt = `${m.km} km`;
    ctx.font = `700 ${fs}px "Inter","Segoe UI",system-ui,sans-serif`;
    const tw = ctx.measureText(txt).width;
    const bw = tw + 10 * sf;
    const bh = 16 * sf;
    const bx = x + r + 4 * sf;
    const by = y - bh / 2;
    roundRect(ctx, bx, by, bw, bh, 8 * sf);
    ctx.fillStyle = "rgba(9,12,20,0.86)";
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, bx + bw / 2, y + 0.5 * sf);
  }
}

/**
 * Legenda do traçado colorido.
 *
 * Sem ela a cor não significa nada: a faixa não diz se é 12 ou 40 km/h. Fica no
 * canto de baixo, acima da barra de progresso, com os dois extremos escritos e
 * a faixa neutra explicada quando existe.
 */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colored: ColoredRoute,
  sf: number,
  lifted: boolean,
  /** quanto subir além da barra de progresso (a faixa do perfil, quando há) */
  liftExtra = 0,
) {
  const pad = 30 * sf;
  const chipW = 22 * sf;
  const gap = 2 * sf;
  const chips = colored.colors.length;
  const innerW = chips * chipW + (chips - 1) * gap;
  const placW = innerW + 16 * sf;
  const placH = 44 * sf;
  const px = pad;
  const py = height - pad - (lifted ? 34 * sf : 0) - liftExtra - placH - 8 * sf;
  if (px + placW > width) return;

  ctx.save();
  roundRect(ctx, px, py, placW, placH, 9 * sf);
  ctx.fillStyle = "rgba(9,12,20,0.72)";
  ctx.fill();

  ctx.font = `700 ${Math.round(10 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${colored.title} ${colored.unit}`, px + 8 * sf, py + 14 * sf);

  // o cinza não é uma faixa da escala: precisa ser dito, senão parece defeito
  if (colored.bands.some((b) => !Number.isFinite(b))) {
    const rotulo = "sem dado";
    ctx.font = `600 ${Math.round(9.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    const lw = ctx.measureText(rotulo).width;
    const cx = px + placW - 8 * sf - lw - 13 * sf;
    roundRect(ctx, cx, py + 6 * sf, 9 * sf, 9 * sf, 2.5 * sf);
    ctx.fillStyle = NEUTRAL_COLOR;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(rotulo, cx + 13 * sf, py + 14 * sf);
  }

  for (let i = 0; i < chips; i++) {
    const x = px + 8 * sf + i * (chipW + gap);
    roundRect(ctx, x, py + 19 * sf, chipW, 9 * sf, 2.5 * sf);
    ctx.fillStyle = colored.colors[i];
    ctx.fill();
  }

  ctx.font = `700 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fy = py + placH - 6 * sf;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "left";
  ctx.fillText(colored.lowLabel, px + 8 * sf, fy);
  ctx.textAlign = "right";
  ctx.fillText(colored.highLabel, px + placW - 8 * sf, fy);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export { buildTrack };
