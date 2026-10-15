import { gaitOf, type Character } from "./characters";
import { poiLatLng, type Poi } from "./pois";
import { hasMark, type Endpoints } from "./endpoints";
import {
  BASEMAPS,
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
  cameraTarget,
  CHASE_ALTURA,
  STOP_BOOST,
  zoomEfetivo,
  type ChaseConfig,
  type CinematicConfig,
} from "./camera";
import { routeEnd, routeProgress, timelineOr, type Timeline } from "./timeline";
import { NEUTRAL_COLOR, type ColoredRoute } from "./coloring";
import type { KmMark } from "./km-marks";
import { countPassed } from "./passages";
import { coverSquare, type PhotoImage, type PhotoLookup } from "./photos";
import {
  TILE_SIZE,
  bearing,
  boundsOf,
  buildTrack,
  fitZoom,
  formatDistance,
  haversine,
  project,
  sampleTrack,
  unproject,
  visibleRuns,
  type Bounds,
  type IndexRange,
  type LatLng,
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
  showRoute: boolean;
  showTraveled: boolean;
  showEndpoints: boolean;
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

  constructor(public basemap: BasemapId) {}

  key(z: number, x: number, y: number) {
    return `${this.basemap}/${z}/${x}/${y}`;
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

  /** baixa + aplica o filtro do estilo uma única vez */
  async fetchTile(z: number, x: number, y: number): Promise<TileImage | null> {
    const bm = BASEMAPS[this.basemap];
    const raw = await loadTile(tileUrl(bm, z, x, y));
    if (!raw) return null;
    return filterTile(raw, bm.filter);
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
  const b = s * sin;
  const c = -s * sin;
  const d = s * cos;
  const e = width / 2 - (a * P.x + c * P.y);
  const f = height * altura - (b * P.x + d * P.y);
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

/** A projeção de um ponto do mundo (no zoom da vista) para a tela. */
export function projetorDaVista(v: Vista): (x: number, y: number) => { x: number; y: number } {
  return (x, y) => ({ x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f });
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
  const push = (centro: LatLng, zoom: number, rumo: number, gira: boolean) => {
    const v = vistaDe({
      centro,
      zoom,
      width,
      height,
      maxZoom,
      altura: chase ? CHASE_ALTURA : 0.5,
      angulo: chase?.gira && gira ? -rumo : 0,
    });
    for (const [z, x, y] of tilesDaVista(v, 1)) {
      const k = `${z}/${x}/${y}`;
      if (!map.has(k)) map.set(k, { url: tileUrl(bm, z, x, y), z, x, y });
    }
  };

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
  // amostra por distância: um tile de folga cobre o atraso da câmera suavizada
  const stepMeters = 140;
  const byDistance = Math.round(track.total / stepMeters);
  const steps = Math.max(2, Math.min(500, byDistance));
  for (let i = 0; i <= steps; i++) {
    const s = sampleTrack(track, i / steps);
    push(s.pos, zoom, s.heading, true);
  }

  if (cine?.stops && cine.stopTs.length > 0) {
    // no máximo oito paradas: numa rota com cinquenta, o ganho de zoom em
    // todas elas dobraria a conta dos servidores gratuitos sem que ninguém
    // reparasse nas do meio
    const validas = cine.stopTs.filter((ts) => Number.isFinite(ts));
    const escolhidas = validas.length <= 8 ? validas : spread(validas, 8);
    const zoomParada = Math.min(zoomEfetivo(camera) + STOP_BOOST, maxZoom);
    for (const ts of escolhidas) {
      const s = sampleTrack(track, ts);
      push(s.pos, zoomParada, s.heading, true);
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
const RUMO_TAU_S = 0.6;

/**
 * Teto da velocidade de giro (graus por segundo de vídeo).
 *
 * O filtro sozinho responde rápido demais quando o rumo dá um salto grande (num
 * zigue-zague do arquivo, o primeiro quadro levaria ~1/6 da virada inteira).
 * Com o teto, nenhuma virada é mais rápida que ~1,2 volta por segundo: um
 * giro de 90° leva no mínimo 0,75 s, sempre.
 */
const RUMO_MAX_GRAUS_S = 120;

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
  private instanteAnterior: number | null = null;
  private store: TileStore;
  /** pontos visíveis já projetados, reaproveitados entre os quadros */
  private px = new Float64Array(0);
  private py = new Float64Array(0);

  constructor(basemap: BasemapId) {
    this.store = new TileStore(basemap);
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

  /** quantos tiles já estão prontos para desenhar */
  get loadedTiles(): number {
    return this.store.loadedCount;
  }

  setBasemap(basemap: BasemapId) {
    if (this.store.basemap === basemap) return;
    this.store = new TileStore(basemap);
  }

  reset() {
    this.cam = null;
    this.rumoSuave = null;
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
  async warmup(
    track: Track,
    camera: CameraConfig,
    width: number,
    height: number,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const refs = tilesForAnimation(track, camera, width, height, this.store.basemap);
    const seen = new Set<string>();
    const unique = refs.filter((r) => {
      const k = `${r.z}/${r.x}/${r.y}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let done = 0;
    const missing: TileRef[] = [];
    // fetchTile baixa E aplica o filtro do estilo (Escuro/Clean)
    const load = (ref: TileRef) =>
      this.store
        .fetchTile(ref.z, ref.x, ref.y)
        .then((img) => {
          if (img) this.store.put(ref.z, ref.x, ref.y, img);
          else missing.push(ref);
        })
        .catch(() => missing.push(ref))
        .finally(() => {
          done++;
          onProgress(Math.min(0.97, done / Math.max(1, unique.length)));
        });
    const run = (list: TileRef[]) => {
      // servidores gratuitos: mantemos a concorrência baixa por educação
      const concurrency = 6;
      let cursor = 0;
      const workers = new Array(Math.min(concurrency, Math.max(1, list.length)))
        .fill(0)
        .map(async () => {
          while (cursor < list.length) {
            const ref = list[cursor++];
            await load(ref);
          }
        });
      return Promise.all(workers).then(() => undefined);
    };

    await run(unique);

    // segunda passada: tiles que falharam por instabilidade de rede
    if (missing.length > 0 && missing.length < unique.length) {
      await new Promise((r) => setTimeout(r, 250));
      const retry = missing.filter((r) => isFailedTile(r.url));
      missing.length = 0;
      if (retry.length) await run(retry);
    }
    onProgress(1);
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
    const rumo = this.suavizarRumo(sample.heading, dt);

    // --- câmera (alvo puro + suavização) ---
    const tl = timelineOr(input.timeline, input.duration);
    const target = cameraTarget({
      track,
      t,
      camera,
      width,
      height,
      maxZoom,
      elapsed: input.elapsed,
      duration: input.duration,
      routeSeconds: tl.percurso,
      stopPos: (ts) => sampleTrack(track, ts).pos,
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
     */
    const ancorarNoPersonagem = !!chase && target.opening >= 1;
    const centro = ancorarNoPersonagem ? sample.pos : this.cam;
    /** o giro que o mapa recebe neste quadro (0 = norte para cima) */
    const anguloMapa = chase?.gira ? -rumo * target.opening : 0;
    const vista = vistaDe({
      centro,
      zoom: this.cam.zoom,
      width,
      height,
      maxZoom,
      altura: 0.5 + (CHASE_ALTURA - 0.5) * (chase ? target.opening : 0),
      angulo: anguloMapa,
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
    ctx.setTransform(vista.a, vista.b, vista.c, vista.d, vista.e, vista.f);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const [tz, tx, ty] of tilesDaVista(vista)) {
      this.store.request(tz, tx, ty);
      const img = this.store.get(tz, tx, ty);
      if (img) {
        ctx.drawImage(img as CanvasImageSource, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    ctx.restore();

  /*
   * A cartela final é **medida** antes de qualquer desenho: o pino da chegada
   * precisa saber onde ela vai cair para sair de baixo. Antes ela era desenhada
   * por último (por cima) e cobria o pino B, o nome e a foto da chegada.
   */
  const cartao = style.showSummary
    ? summaryBox(ctx, width, height, input, sf)
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
      const upto = Math.min(sample.index + 1, track.pts.length - 1);
      // o trecho percorrido também cresce com a animação, então leva o mesmo corte
      const percorridos = visibleRuns(track.pts, janela, upto);
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
        const ultimo = Math.min(Math.max(upto - 1, 0), track.pts.length - 2);
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

    // --- paradas do percurso ---
    if (style.showStops && input.stops.length > 0 && track.pts.length > 1) {
      drawStops(ctx, input, toXY, sf);
    }

    // --- personagem ---
    drawCharacter(ctx, toXY(sample.pos), rumo + anguloMapa, input, sf, sample.index);

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
      ondaDaPonta(pipocoDaPonta(input, "a"), track.pts[0], "#22c55e");
      ondaDaPonta(pipocoDaPonta(input, "b"), track.pts[track.pts.length - 1], "#f87171");
      drawPin(
        ctx,
        toXY(track.pts[0]),
        "A",
        "#22c55e",
        sf,
        input.endpoints.a,
        fotoDoLocal(input.endpoints.a),
        photoWindowAlpha(input.elapsed - tl.voo + PHOTO_FADE_IN_S),
        cartao ? retanguloDaCartela(cartao) : null,
        crescimentoDoPino(input, "a"),
      );
      drawPin(
        ctx,
        toXY(track.pts[track.pts.length - 1]),
        "B",
        "#f87171",
        sf,
        input.endpoints.b,
        fotoDoLocal(input.endpoints.b),
        photoWindowAlpha(routeEnd(tl) - input.elapsed + PHOTO_FADE_IN_S),
        cartao ? retanguloDaCartela(cartao) : null,
        crescimentoDoPino(input, "b"),
      );
    }

    const headerBottom = style.showTitle
      ? drawTitle(ctx, width, input, sample, onDark, sf)
      : 0;

    if (style.showStops && track.pts.length > 1) {
      drawEventToast(ctx, width, input, sf, headerBottom);
    }

    // --- overlays ---
    if (style.showProgress) drawProgress(ctx, width, height, input, sf);
    if (style.showHud) drawHud(ctx, width, input, sample, sf, onDark, headerBottom);
    if (colored && style.showRoute) {
      drawLegend(ctx, width, height, colored, sf, style.showProgress);
    }
    if (cartao) drawSummary(ctx, width, height, cartao, onDark, sf);

    // atribuição obrigatória dos mapas gratuitos
    drawAttribution(ctx, width, height, bm.attribution, style.showProgress, sf);
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
) {
  const pad = 10 * sf;
  const fs = Math.round(Math.max(9, 11 * sf));
  ctx.save();
  ctx.font = `500 ${fs}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const w = ctx.measureText(text).width;
  const y = height - pad - (liftedByProgress ? 34 * sf : 0);
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
function photoWindowAlpha(desde: number): number {
  if (!(desde >= 0)) return 0;
  const entra = Math.min(1, desde / PHOTO_FADE_IN_S);
  const sai =
    1 -
    Math.min(
      1,
      Math.max(0, (desde - (PHOTO_HOLD_S - PHOTO_FADE_OUT_S)) / PHOTO_FADE_OUT_S),
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
  indice: number,
) {
  const { character, style, rotate, elapsed } = input;
  const badge = Math.round(Math.max(38, Math.min(86, 62 * sf)) * (character.size ?? 1));
  const respira = 1 + 0.05 * Math.sin(elapsed * 4);
  const { sobe, lado, estica } = andar(input, character);
  const inclina = inclinacaoDaCurva(input.track, indice);

  ctx.save();
  ctx.translate(at.x + lado * badge, at.y + sobe * badge);
  if (inclina !== 0) ctx.rotate((inclina * Math.PI) / 180);
  if (estica !== 0) ctx.scale(1 - estica * 0.6, 1 + estica);

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
   * O emoji ocupa o selo de verdade: era desenhado com 0,6 do selo, e a figura
   * ficava pequena dentro de um aro grande — o conjunto parecia ícone de painel,
   * não personagem.
   */
  ctx.rotate(rotate ? ((rumo + (character.baseAngle ?? 0)) * Math.PI) / 180 : 0);
  ctx.font = `${Math.round(badge * 0.78)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(character.emoji, 0, badge * 0.03);

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

function drawPin(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  fallback: string,
  color: string,
  sf: number,
  mark?: import("./endpoints").EndpointMark | null,
  foto?: PhotoImage | null,
  fotoAlpha = 0,
  /** retângulo que o pino não pode invadir (a cartela final, no fim do vídeo) */
  esquiva?: { x: number; y: number; w: number; h: number; forca: number } | null,
  /** 1 = tamanho cheio; menos = o pino ainda está nascendo ("pipoco") */
  crescimento = 1,
) {
  const marked = hasMark(mark ?? null);
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

  // etiqueta com o nome do local marcado
  const label = marked ? mark!.label.trim() : "";
  if (label) {
    ctx.font = `700 ${Math.round(11.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
    const tw = ctx.measureText(label).width;
    const bw = tw + 16 * sf;
    const bh = 19 * sf;
    const by = -r - bh - 6 * sf;
    roundRect(ctx, -bw / 2, by, bw, bh, 7 * sf);
    ctx.fillStyle = "rgba(9,12,20,0.92)";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8 * sf;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = hexA(color, 0.85);
    ctx.lineWidth = 1.4 * sf;
    ctx.stroke();
    // seta da etiqueta
    ctx.beginPath();
    ctx.moveTo(-4 * sf, by + bh);
    ctx.lineTo(4 * sf, by + bh);
    ctx.lineTo(0, by + bh + 4 * sf);
    ctx.closePath();
    ctx.fillStyle = "rgba(9,12,20,0.92)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, by + bh / 2 + 0.5 * sf);
  }

  // foto do local em círculo, acima do nome — **menor** que a das paradas: as
  // duas ficam nos extremos do trajeto, onde o personagem e a cartela final
  // disputam o mesmo lugar
  if (foto && fotoAlpha > 0.01) {
    const lado = 56 * sf;
    // acima do pino e da etiqueta do nome (as duas coisas estão em y negativo)
    const alturaRotulo = label ? r + 19 * sf + 10 * sf : r;
    ctx.save();
    ctx.globalAlpha = fotoAlpha;
    drawStopCircle(ctx, foto, 0, -alturaRotulo - 6 * sf, lado, color, sf);
    ctx.restore();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Paradas do percurso                                                 */
/* ------------------------------------------------------------------ */

type ToastEvent = {
  /** posição do evento na rota (0..1) */
  at: number;
  /**
   * Quanto a notificação dura, em fração da rota.
   *
   * As paradas e a partida são medidas em **metros** (o aviso acompanha o
   * lugar); a chegada é medida em **segundos de vídeo**, para o aviso ter
   * sempre a mesma duração na tela — em metros, numa rota longa ele passava
   * depressa demais e numa curta ficava demais.
   */
  hold: number;
  emoji: string;
  title: string;
  sub: string;
  color: string;
};

/**
 * Toast de eventos no topo da tela — estilo notificação.
 * Fica em posição FIXA (não cola no personagem), então nunca é escondido.
 * Cobre partida (A), cada parada e chegada (B).
 * Animação medida em metros — idêntica na pré-visualização e no vídeo.
 */
function drawEventToast(
  ctx: CanvasRenderingContext2D,
  width: number,
  input: FrameState,
  sf: number,
  headerBottom: number,
) {
  const { track, t, stops, endpoints } = input;
  const total = track.total;
  if (total <= 0) return;

  // duração do toast em metros percorridos
  const holdMeters = Math.max(90, Math.min(600, total * 0.07));
  /**
   * Quanto tempo o aviso da chegada fica na tela (segundos de vídeo).
   *
   * Ele termina **no instante da chegada**: o pino do B chega ao tamanho cheio
   * exatamente ali, e o aviso já saiu — quem anuncia a chegada é o pino (com a
   * foto, quando existe), não um retângulo no topo.
   */
  const TOAST_CHEGADA_S = 2.5;

  /*
   * Quem tem foto pronta não vira toast: o círculo com a foto (e o nome embaixo
   * dele) já anuncia o lugar, e escrever de novo no topo seria repetir a mesma
   * informação. Se a foto foi escolhida mas **não** carregou, o toast continua
   * aparecendo — melhor repetir do que o lugar passar em branco.
   */
  const anunciadoPelaFoto = (foto: string | undefined) => {
    if (!foto) return false;
    if (input.photos?.get(foto)) return true;
    // escolhida e ainda carregando também cala o aviso: ele só volta quando o
    // carregamento **falhou** de verdade (`has` diz que já tentou)
    return !input.photos?.has?.(foto);
  };

  const events: ToastEvent[] = [];
  // partida
  if (!anunciadoPelaFoto(endpoints.a?.photo)) {
    events.push({
      at: 0,
      hold: holdMeters / total,
      emoji: endpoints.a?.emoji.trim() || "🚩",
      title: endpoints.a?.label.trim() || "Partida",
      sub: "Início do percurso",
      color: "#22c55e",
    });
  }
  // paradas — uma vez para **cada passagem** (na volta, aparece de novo)
  for (const s of stops) {
    if (anunciadoPelaFoto(s.photo)) continue;
    const passagens = input.passages?.[s.id] ?? [s.t];
    for (const ts of passagens) {
      const km = (ts * total) / 1000;
      events.push({
        at: ts,
        hold: holdMeters / total,
        emoji: s.emoji,
        title: s.label.trim() || "Parada",
        sub: `📍 ${km < 10 ? km.toFixed(2) : km.toFixed(1)} km do início`,
        color: s.color,
      });
    }
  }
  /*
   * Chegada: o aviso entra nos **últimos 2,5 s de vídeo** do percurso e termina
   * no instante em que o personagem chega.
   *
   * Já foi medido em metros como as paradas, e dava dois problemas: numa rota
   * longa passava rápido demais, numa curta ficava demais — e, disparando antes
   * do fim do percurso com sobra para depois, ficava congelado na tela quando o
   * `t` parava em 1 (a cartela). Em segundos de vídeo ele tem sempre a mesma
   * duração e sai antes do quadro da chegada.
   */
  const tl = timelineOr(input.timeline, input.duration);
  if (!anunciadoPelaFoto(endpoints.b?.photo)) {
    const at = routeProgress(tl, routeEnd(tl) - TOAST_CHEGADA_S);
    events.push({
      at,
      hold: Math.max(0.01, 1 - at),
      emoji: endpoints.b?.emoji.trim() || "🏁",
      title: endpoints.b?.label.trim() || "Chegada",
      sub: `Percurso completo · ${formatDistance(total)}`,
      color: "#f87171",
    });
  }

  // evento ativo = o mais recente dentro da janela
  let active: ToastEvent | null = null;
  let decorrido = 0;
  for (const ev of events) {
    const d = t - ev.at;
    if (d >= 0 && d <= ev.hold && (!active || ev.at >= active.at)) {
      active = ev;
      decorrido = d;
    }
  }
  if (!active) return;

  const p = Math.max(0, Math.min(1, decorrido / active.hold)); // 0..1
  // vida acabada: não desenha nem o quadro de saída (com a janela fechando no
  // fim do percurso, o `p` chega a 1 exatamente ali e o aviso já saiu)
  if (p >= 1) return;
  const appear = Math.min(1, p / 0.1);
  const fade = p > 0.78 ? Math.max(0, (1 - p) / 0.22) : 1;
  const alpha = appear * fade;
  const slide = Math.max(0, 1 - easeOutBack(Math.min(1, p / 0.16))) * 12 * sf;

  const fTitle = `800 ${Math.round(15.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  const fSub = `600 ${Math.round(11 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.save();
  ctx.font = fTitle;
  const nw = ctx.measureText(active.title).width;
  ctx.font = fSub;
  const sw = ctx.measureText(active.sub).width;

  const badge = 34 * sf;
  const bw = Math.max(nw, sw) + badge + 36 * sf;
  const bh = 46 * sf;
  const x = width / 2 - bw / 2;
  const y = Math.max(64 * sf, headerBottom + 14 * sf) + slide;

  ctx.globalAlpha = alpha;

  // cartão
  roundRect(ctx, x, y, bw, bh, 13 * sf);
  ctx.fillStyle = "rgba(9,12,20,0.93)";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18 * sf;
  ctx.shadowOffsetY = 5 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = hexA(active.color, 0.9);
  ctx.lineWidth = 1.8 * sf;
  ctx.stroke();

  // barra de vida do toast (quanto falta para sumir)
  const lifeW = (bw - 24 * sf) * Math.max(0, 1 - p);
  roundRect(ctx, x + 12 * sf, y + bh - 4.5 * sf, lifeW, 2.5 * sf, 1.5 * sf);
  ctx.fillStyle = hexA(active.color, 0.75);
  ctx.fill();

  // medalhão do emoji
  const bx = x + 10 * sf + badge / 2;
  const by = y + bh / 2;
  ctx.beginPath();
  ctx.arc(bx, by, badge / 2, 0, Math.PI * 2);
  ctx.fillStyle = hexA(active.color, 0.16);
  ctx.fill();
  ctx.lineWidth = 1.6 * sf;
  ctx.strokeStyle = hexA(active.color, 0.85);
  ctx.stroke();
  ctx.font = `${Math.round(badge * 0.56)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(active.emoji, bx, by + 1 * sf);

  // textos
  const tx = x + badge + 22 * sf;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = fTitle;
  ctx.fillText(active.title, tx, y + 20 * sf);
  ctx.fillStyle = active.color;
  ctx.font = fSub;
  ctx.fillText(active.sub, tx, y + 36 * sf);

  ctx.restore();
}

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
function drawStops(
  ctx: CanvasRenderingContext2D,
  input: FrameState,
  toXY: (p: LatLng) => { x: number; y: number },
  sf: number,
) {
  const { track, t, stops, style } = input;
  // a janela da foto da parada é medida em segundos de **percurso**
  const tl = timelineOr(input.timeline, input.duration);
  const popMeters = Math.max(28, Math.min(190, track.total * 0.014));

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
    // para a etiqueta: ela nasce na primeira passagem e fica (como sempre foi)
    const pRotulo = Math.min(1, ((t - primeira) * track.total) / popMeters);

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
    ctx.arc(at.x, at.y, (upcoming ? 3.2 : 4.4) * sf, 0, Math.PI * 2);
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

    const scale = upcoming ? 0.7 : Math.max(0.15, easeOutBack(p));
    ctx.globalAlpha = upcoming ? 0.55 : Math.min(1, 0.3 + p * 1.2);
    ctx.translate(px, py);
    ctx.scale(scale, scale);

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
    const foto = stop.photo ? (input.photos?.get(stop.photo) ?? null) : null;
    // a janela da foto começa na passagem mais recente: na volta, ela aparece
    // de novo, mesmo que já tenha aparecido na ida
    const desde = ultima === null ? -1 : (t - ultima) * tl.percurso;
    const fotoAlpha = foto ? photoWindowAlpha(desde) : 0;
    const ladoFoto = 78 * sf;
    // sem foto pronta, a etiqueta não sobe: não pode ficar um buraco no lugar dela
    const alturaFoto = foto ? (ladoFoto + 10 * sf) * fotoAlpha : 0;
    const rotuloVisivel = ultima !== null && style.showStopLabels && pRotulo > 0.26;
    const la = rotuloVisivel ? Math.min(1, (pRotulo - 0.26) / 0.38) : 0;
    const baseRotulo = -r - 33 * sf - 8 * sf + (1 - la) * 9 * sf;

    if (foto && fotoAlpha > 0.01) {
      // o alfa é calculado, e não lido do contexto: ler `ctx.globalAlpha` de
      // volta devolveria o valor do pino em vez do que está valendo de fato
      const alfaPino = Math.min(1, 0.3 + p * 1.2);
      ctx.save();
      ctx.globalAlpha = alfaPino * fotoAlpha;
      drawStopCircle(ctx, foto, 0, baseRotulo - alturaFoto - 6 * sf, ladoFoto, stop.color, sf);
      ctx.restore();
    }

    // etiqueta com nome + distância desde a partida
    if (rotuloVisivel) {
      ctx.globalAlpha = Math.min(1, 0.3 + p * 1.2) * la;
      const name = stop.label.trim() || "Parada";
      // no retorno, o km é o do momento (16,8 km), não o da primeira passagem
      const km = ((ultima ?? stop.t) * track.total) / 1000;
      const kmTxt = `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
      const sub = off >= 25 ? `⤷ ${kmTxt}` : kmTxt;
      const fName = `700 ${Math.round(13.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
      const fSub = `600 ${Math.round(10.5 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
      ctx.font = fName;
      const nw = ctx.measureText(name).width;
      ctx.font = fSub;
      const sw = ctx.measureText(sub).width;
      const bw = Math.max(nw, sw) + 20 * sf;
      const bh = 33 * sf;
      const by = baseRotulo - alturaFoto;

      roundRect(ctx, -bw / 2, by, bw, bh, 9 * sf);
      ctx.fillStyle = "rgba(9,12,20,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 10 * sf;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = hexA(stop.color, 0.85);
      ctx.lineWidth = 1.6 * sf;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-5 * sf, by + bh);
      ctx.lineTo(5 * sf, by + bh);
      ctx.lineTo(0, by + bh + 5 * sf);
      ctx.closePath();
      ctx.fillStyle = "rgba(9,12,20,0.92)";
      ctx.fill();

      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffffff";
      ctx.font = fName;
      ctx.fillText(name, 0, by + 15 * sf);
      ctx.fillStyle = stop.color;
      ctx.font = fSub;
      ctx.fillText(sub, 0, by + 27 * sf);
    }

    ctx.restore();
  }
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
  sample: { distance: number },
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

  // selos do canto superior direito: paradas alcançadas (opcional) + distância
  /*
   * O contador conta **passagens**, não paradas: numa ida e volta, passar de
   * novo pela mesma parada conta de novo. Quando não há repetição (o caso
   * comum), passa a ser a mesma coisa de antes — e o texto continua "paradas".
   */
  const contagem = countPassed(input.stops, input.passages, t);
  const stopsTotal = style.showStopCounter ? contagem.total : 0;
  const stopsPassed = contagem.passed;
  const stopTxt = `${stopsPassed}/${stopsTotal} ${contagem.extras > 0 ? "passagens" : "paradas"}`;
  const dist = `${(sample.distance / 1000).toFixed(sample.distance < 10000 ? 2 : 1)} km`;
  const badgeFont = `700 ${Math.round(15 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
  ctx.font = badgeFont;
  const dh = 28 * sf;
  const dy = pad;
  const dw = ctx.measureText(dist).width + 26 * sf;
  const dx = width - pad - dw;
  const stopW = stopsTotal > 0 ? ctx.measureText(stopTxt).width + 34 * sf : 0;
  const sx = dx - stopW - 8 * sf;

  const badge = (x: number, w: number, ring: string) => {
    roundRect(ctx, x, dy, w, dh, dh / 2);
    ctx.fillStyle = "rgba(9,12,20,0.72)";
    ctx.fill();
    ctx.strokeStyle = hexA(ring, 0.5);
    ctx.lineWidth = 1.5 * sf;
    ctx.stroke();
  };

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (stopW > 0) {
    badge(sx, stopW, stopsPassed === stopsTotal ? "#4ade80" : style.accent);
    ctx.font = `${Math.round(13 * sf)}px ${EMOJI_FONT}`;
    ctx.fillText("📍", sx + 15 * sf, dy + dh / 2 + 1);
    ctx.font = badgeFont;
    ctx.fillStyle = stopsPassed === stopsTotal ? "#4ade80" : "#ffffff";
    ctx.fillText(stopTxt, sx + 22 * sf + (stopW - 26 * sf) / 2, dy + dh / 2 + 1);
  }
  badge(dx, dw, style.accent);
  ctx.font = badgeFont;
  ctx.fillStyle = "#fff";
  ctx.fillText(dist, dx + dw / 2, dy + dh / 2 + 1);

  void track;
  ctx.restore();
  return boxY + boxH;
}

/**
 * Distância em texto no vídeo usa o mesmo formato do painel (`formatDistance`):
 * vírgula decimal em pt-BR. Antes o título escrevia "3.02 km" com ponto e a
 * cartela "3,02 km" com vírgula — dois formatos no mesmo quadro.
 */

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

  const boxW = Math.min(maxW, Math.max(totalW, notaW) + pad * 2);
  const altura =
    alturaAvatar +
    (colunas.length > 0 ? valorFs * 1.15 + labelFs * 1.35 : 0) +
    (nota ? noteFs * 1.5 : 0) +
    pad * 1.6;
  const boxX = (width - boxW) / 2;
  const boxY = (height - altura) / 2;


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
    boxX,
    boxY,
    boxW,
    boxH: altura,
  };
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

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let base = boxY + pad * 0.8 + alturaAvatar + valorFs * 0.85;

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
    const real = elapsedAt(track.pts, track.cum, t, times);
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

  // o número do centro: velocidade (km/h) ou ritmo (min/km)
  const txtVel = style.pace
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
  const nota = style.pace
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
  ctx.fillText(style.pace ? "min/km" : "km/h", cx, cy + 22 * sf);
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
) {
  const pad = 30 * sf;
  const chipW = 22 * sf;
  const gap = 2 * sf;
  const chips = colored.colors.length;
  const innerW = chips * chipW + (chips - 1) * gap;
  const placW = innerW + 16 * sf;
  const placH = 44 * sf;
  const px = pad;
  const py = height - pad - (lifted ? 34 * sf : 0) - placH - 8 * sf;
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
