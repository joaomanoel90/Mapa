import type { Character } from "./characters";
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
import { elapsedAt, formatClock, speedAt } from "./hud";
import { cameraTarget, STOP_BOOST, type CinematicConfig } from "./camera";
import { NEUTRAL_COLOR, type ColoredRoute } from "./coloring";
import type { KmMark } from "./km-marks";
import { coverSquare, type PhotoLookup } from "./photos";
import {
  TILE_SIZE,
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
  /** segundos desde o início (para efeitos) */
  elapsed: number;
  duration: number;
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
    return viewFrom(pos, camera.followZoom, width, height, maxZoom);
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
  const push = (v: View) => {
    for (const [z, x, y] of tilesInView(v, width, height, 1)) {
      const k = `${z}/${x}/${y}`;
      if (!map.has(k)) map.set(k, { url: tileUrl(bm, z, x, y), z, x, y });
    }
  };
  const paraView = (alvo: { lat: number; lng: number; zoom: number }): View =>
    viewFrom(alvo, alvo.zoom, width, height, maxZoom);

  if (camera.mode === "fit") {
    push(targetView({ track, t: 0, camera, width, height, maxZoom }));
    return Array.from(map.values());
  }

  const cine = cinematic ?? camera.cinematic ?? null;
  if (cine?.opening) {
    // o enquadramento da abertura é o do "Rota toda", no meio do traçado
    push(
      paraView(
        cameraTarget({
          track,
          t: 0,
          camera: { mode: "fit", followZoom: camera.followZoom },
          width,
          height,
          maxZoom,
          elapsed: 0,
          duration: 1,
        }),
      ),
    );
  }

  // amostra por distância: um tile de folga cobre o atraso da câmera suavizada
  const stepMeters = 140;
  const byDistance = Math.round(track.total / stepMeters);
  const steps = Math.max(2, Math.min(500, byDistance));
  for (let i = 0; i <= steps; i++) {
    push(targetView({ track, t: i / steps, camera, width, height, maxZoom }));
  }
  // início e fim garantidos
  push(targetView({ track, t: 0, camera, width, height, maxZoom }));
  push(targetView({ track, t: 1, camera, width, height, maxZoom }));

  if (cine?.stops && cine.stopTs.length > 0) {
    // no máximo oito paradas: numa rota com cinquenta, o ganho de zoom em
    // todas elas dobraria a conta dos servidores gratuitos sem que ninguém
    // reparasse nas do meio
    const validas = cine.stopTs.filter((ts) => Number.isFinite(ts));
    const escolhidas = validas.length <= 8 ? validas : spread(validas, 8);
    const zoomParada = Math.min(camera.followZoom + STOP_BOOST, maxZoom);
    for (const ts of escolhidas) {
      const pos = sampleTrack(track, ts).pos;
      push(viewFrom(pos, zoomParada, width, height, maxZoom));
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

export class SceneRenderer {
  private cam: Camera | null = null;
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

    // --- câmera (alvo puro + suavização) ---
    const target = cameraTarget({
      track,
      t,
      camera,
      width,
      height,
      maxZoom,
      elapsed: input.elapsed,
      duration: input.duration,
    });

    if (!this.cam) this.cam = { lat: target.lat, lng: target.lng, zoom: target.zoom };
    // durante a abertura o alvo já é uma animação pronta: suavizar de novo só
    // atrasaria o pouso, então a câmera vai junto
    const k =
      target.opening < 1 ? 1 : camera.mode === "follow" ? 0.16 : 0.1;
    this.cam.lat += (target.lat - this.cam.lat) * k;
    this.cam.lng += (target.lng - this.cam.lng) * k;
    this.cam.zoom += (target.zoom - this.cam.zoom) * (target.opening < 1 ? 1 : 0.12);

    const view = viewFrom(this.cam, this.cam.zoom, width, height, maxZoom);
    const { z, s, ox, oy } = view;
    const toXY = (p: LatLng) => {
      const w = project(p.lat, p.lng, z);
      return { x: (w.x - ox) * s, y: (w.y - oy) * s };
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
    const cantoA = unproject(ox, oy, z);
    const cantoB = unproject(ox + width / s, oy + height / s, z);
    const dLat = cantoA.lat - cantoB.lat;
    const dLng = cantoB.lng - cantoA.lng;
    const janela: Bounds = {
      north: cantoA.lat + (margemPx * dLat) / height,
      south: cantoB.lat - (margemPx * dLat) / height,
      west: cantoA.lng - (margemPx * dLng) / width,
      east: cantoB.lng + (margemPx * dLng) / width,
    };


    // --- fundo + tiles ---
    ctx.save();
    ctx.fillStyle = bm.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const [tz, tx, ty] of tilesInView(view, width, height)) {
      this.store.request(tz, tx, ty);
      const img = this.store.get(tz, tx, ty);
      if (img) {
        ctx.drawImage(img as CanvasImageSource, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    ctx.restore();

    const sample = sampleTrack(track, t);

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

    // --- pontos A/B (podem ser locais marcados) ---
    if (style.showEndpoints && track.pts.length > 1) {
      drawPin(ctx, toXY(track.pts[0]), "A", "#22c55e", sf, input.endpoints.a);
      drawPin(
        ctx,
        toXY(track.pts[track.pts.length - 1]),
        "B",
        "#f87171",
        sf,
        input.endpoints.b,
      );
    }

    // --- personagem ---
    drawCharacter(ctx, toXY(sample.pos), sample.heading, input, sf);

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
    if (style.showSummary) drawSummary(ctx, width, height, input, onDark, sf);

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

const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  heading: number,
  input: FrameState,
  sf: number,
) {
  const { character, style, rotate, elapsed } = input;
  const badge = Math.round(Math.max(38, Math.min(86, 62 * sf)) * (character.size ?? 1));
  const pulse = 1 + 0.05 * Math.sin(elapsed * 4);

  ctx.save();
  ctx.translate(at.x, at.y);

  // halo
  const halo = ctx.createRadialGradient(0, 0, badge * 0.25, 0, 0, badge * 1.5);
  halo.addColorStop(0, hexA(style.accent, 0.45));
  halo.addColorStop(1, hexA(style.accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, badge * 1.5 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // anel de pulso
  ctx.strokeStyle = hexA(style.accent, 0.55);
  ctx.lineWidth = 2 * sf;
  ctx.beginPath();
  ctx.arc(0, 0, badge * (0.85 + 0.12 * pulse), 0, Math.PI * 2);
  ctx.stroke();

  // seta de direção
  const arrowAngle = ((heading - 90) * Math.PI) / 180;
  ctx.save();
  ctx.rotate(arrowAngle);
  ctx.beginPath();
  ctx.moveTo(badge * 0.95, 0);
  ctx.lineTo(badge * 0.62, -badge * 0.3);
  ctx.lineTo(badge * 0.62, badge * 0.3);
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

  // emoji
  ctx.rotate(rotate ? ((heading + (character.baseAngle ?? 0)) * Math.PI) / 180 : 0);
  ctx.font = `${Math.round(badge * 0.6)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(character.emoji, 0, badge * 0.03);

  ctx.restore();
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  fallback: string,
  color: string,
  sf: number,
  mark?: import("./endpoints").EndpointMark | null,
) {
  const marked = hasMark(mark ?? null);
  const r = (marked ? 17 : 15) * sf;

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15,18,28,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 10 * sf;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2.5 * sf;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (marked && mark!.emoji.trim()) {
    ctx.font = `${Math.round(r * 1.05)}px ${EMOJI_FONT}`;
    ctx.fillText(mark!.emoji.trim(), 0, r * 0.06);
  } else {
    ctx.font = `800 ${Math.round(r * 1.1)}px "Inter","Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fallback, 0, r * 0.06);
  }

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
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Paradas do percurso                                                 */
/* ------------------------------------------------------------------ */

type ToastEvent = {
  /** posição do evento na rota (0..1) */
  at: number;
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

  const events: ToastEvent[] = [];
  // partida
  events.push({
    at: 0,
    emoji: endpoints.a?.emoji.trim() || "🚩",
    title: endpoints.a?.label.trim() || "Partida",
    sub: "Início do percurso",
    color: "#22c55e",
  });
  // paradas
  for (const s of stops) {
    const km = (s.t * total) / 1000;
    events.push({
      at: s.t,
      emoji: s.emoji,
      title: s.label.trim() || "Parada",
      sub: `📍 ${km < 10 ? km.toFixed(2) : km.toFixed(1)} km do início`,
      color: s.color,
    });
  }
  // chegada (dispara um pouco antes do fim para dar tempo de ler)
  const endAt = Math.max(0, 1 - (holdMeters * 0.4) / total);
  events.push({
    at: endAt,
    emoji: endpoints.b?.emoji.trim() || "🏁",
    title: endpoints.b?.label.trim() || "Chegada",
    sub: `Percurso completo · ${formatDistance(total)}`,
    color: "#f87171",
  });

  // evento ativo = o mais recente dentro da janela
  let active: ToastEvent | null = null;
  let passedM = 0;
  for (const ev of events) {
    const d = (t - ev.at) * total;
    if (d >= 0 && d <= holdMeters && (!active || ev.at >= active.at)) {
      active = ev;
      passedM = d;
    }
  }
  if (!active) return;

  const p = passedM / holdMeters; // 0..1
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
  const popMeters = Math.max(28, Math.min(190, track.total * 0.014));

  for (const stop of stops) {
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

    const passedM = (t - stop.t) * track.total;
    const upcoming = passedM < 0;
    const p = upcoming ? 0 : Math.min(1, passedM / popMeters);

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
    if (!upcoming && p < 1) {
      ctx.beginPath();
      ctx.arc(px, py, (15 + 54 * p) * sf, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(stop.color, (1 - p) * 0.6);
      ctx.lineWidth = (3.4 * (1 - p) + 0.4) * sf;
      ctx.stroke();
    }

    const scale = upcoming ? 0.7 : Math.max(0.15, easeOutBack(p));
    ctx.globalAlpha = upcoming ? 0.55 : Math.min(1, 0.3 + p * 1.2);
    ctx.translate(px, py);
    ctx.scale(scale, scale);

    const r = 17 * sf;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(9,12,20,0.94)";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 12 * sf;
    ctx.shadowOffsetY = 3 * sf;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2.6 * sf;
    ctx.strokeStyle = stop.color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r - 2.6 * sf, Math.PI * 0.92, Math.PI * 1.85);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1.6 * sf;
    ctx.stroke();

    ctx.font = `${Math.round(r * 1.08)}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(stop.emoji, 0, r * 0.05);

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
    const foto = !upcoming && stop.photo ? (input.photos?.get(stop.photo) ?? null) : null;
    const desde = (t - stop.t) * input.duration;
    const fotoEntra = Math.min(1, Math.max(0, desde / PHOTO_FADE_IN_S));
    const fotoSai =
      1 -
      Math.min(
        1,
        Math.max(0, (desde - (PHOTO_HOLD_S - PHOTO_FADE_OUT_S)) / PHOTO_FADE_OUT_S),
      );
    const fotoAlpha = foto ? Math.min(fotoEntra, fotoSai) : 0;
    const ladoFoto = 78 * sf;
    // sem foto pronta, a etiqueta não sobe: não pode ficar um buraco no lugar dela
    const alturaFoto = foto ? (ladoFoto + 10 * sf) * fotoAlpha : 0;
    const rotuloVisivel = !upcoming && style.showStopLabels && p > 0.26;
    const la = rotuloVisivel ? Math.min(1, (p - 0.26) / 0.38) : 0;
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
      const km = (stop.t * track.total) / 1000;
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
  const stopsTotal = style.showStopCounter ? input.stops.length : 0;
  const stopsPassed = countStopsPassed(input.stops, t);
  const stopTxt = `${stopsPassed}/${stopsTotal} paradas`;
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
const SUMMARY_HOLD_S = 4.2;
const SUMMARY_FADE_S = 0.6;

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

function drawSummary(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: FrameState,
  onDark: boolean,
  sf: number,
) {
  const card = input.summary;
  if (!card || (card.tiles.length === 0 && !card.note)) return;

  const dur = Math.max(1, input.duration);
  // percentual do vídeo em que a cartela começa (limitado a 45% em clipes curtos)
  const hold = Math.min(0.45, SUMMARY_HOLD_S / dur);
  const fade = Math.min(hold, SUMMARY_FADE_S / dur);
  const inicio = 1 - hold;
  if (input.t < inicio) return;
  const alpha = fade > 0 ? Math.min(1, Math.max(0, (input.t - inicio) / fade)) : 1;

  const claro = !onDark;
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

  const claro = !onDark;
  const pad = 22 * sf;
  const r = 54 * sf;
  const anel = 9 * sf;
  const cx = width - pad - r - anel / 2;
  // abaixo do cabeçalho; se não houver título, mantém a margem do topo
  const topo = Math.max(headerBottom, 0) + pad * 0.6;
  const cy = topo + r + anel / 2;

  const fVel = `800 ${Math.round(30 * sf)}px "Inter","Segoe UI",system-ui,sans-serif`;
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

  // velocidade no centro
  const txtVel = velocidade === null ? "—" : velocidade.toFixed(velocidade < 10 ? 1 : 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = fVel;
  ctx.fillStyle = claro ? "#0f172a" : "#ffffff";
  ctx.fillText(txtVel, cx, cy + 4 * sf);
  ctx.font = fUni;
  ctx.fillStyle = claro ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.62)";
  ctx.fillText("km/h", cx, cy + 22 * sf);
  if (media) {
    ctx.font = fNota;
    ctx.fillStyle = claro ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.45)";
    ctx.fillText("média", cx, cy - 26 * sf);
  } else if (velocidade === null) {
    ctx.font = fNota;
    ctx.fillStyle = claro ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.45)";
    ctx.fillText("sem arquivo", cx, cy - 26 * sf);
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

  // paradas marcadas na própria linha do tempo do vídeo
  if (style.showStops && input.stops.length > 0) {
    for (const stop of input.stops) {
      const sx = pad + w * stop.t;
      const cy = y + barH / 2;
      const passed = t >= stop.t;
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
