/**
 * Um ponto no mapa.
 *
 * `ele` (metros) e `t` (epoch em ms) só existem quando o ponto veio de um
 * arquivo de GPS — o Strava e o Garmin gravam os dois em cada `<trkpt>`. São
 * opcionais de propósito: tudo que desenha, mede ou compartilha a rota continua
 * funcionando só com lat/lng, e quem precisa de altitude (o resumo do vídeo,
 * a exportação) checa se o dado está lá antes de usar.
 */
export type LatLng = {
  lat: number;
  lng: number;
  /** altitude em metros */
  ele?: number;
  /** instante da gravação (epoch em ms) */
  t?: number;
};

export const TILE_SIZE = 256;
const EARTH_R = 6371008.8;

export function haversine(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumo em graus (0 = norte, 90 = leste). */
export function bearing(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) *
      Math.cos(b.lat * toRad) *
      Math.cos((b.lng - a.lng) * toRad);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export type Track = {
  pts: LatLng[];
  /** distância acumulada (m) até cada ponto; cum[0] = 0 */
  cum: number[];
  total: number;
};

/**
 * Teto de pontos do traçado usado para desenhar.
 *
 * Importar um GPX preserva o arquivo inteiro (até `MAX_GPX_POINTS`) e o
 * `rawTrack` guarda isso; aqui é só a versão que vai para a tela e para o
 * canvas do vídeo. Subiu de 1.200 para 12.000 junto com o corte de janela no
 * renderizador: com o filtro, 12 mil pontos ficam **mais baratos** por quadro
 * do que os 1.200 custavam antes, e a rota deixa de ficar angulosa em percursos
 * longos (1.200 pontos num trajeto de 300 km dava um ponto a cada 250 m).
 */
const MAX_TRACK_POINTS = 12_000;

/**
 * Distância acumulada ponto a ponto (m); o primeiro é zero.
 *
 * Fica separado porque a rota colorida precisa medir o traçado **original**
 * (o mesmo que o HUD e a cartela usam), e não a versão decimada para desenho:
 * a rampa de um trecho não pode mudar por causa do arredondamento da tela.
 */
export function cumulative(pts: LatLng[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  }
  return cum;
}

export function buildTrack(input: LatLng[]): Track {
  let pts = input;
  if (input.length > MAX_TRACK_POINTS) {
    const step = Math.ceil(input.length / MAX_TRACK_POINTS);
    pts = input.filter((_, i) => i % step === 0 || i === input.length - 1);
  }
  const cum = cumulative(pts);
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Teto de pontos do traçado de desenho (exposto para testes e diagnóstico). */
export const TRACK_POINT_LIMIT = MAX_TRACK_POINTS;

export type Sample = {
  pos: LatLng;
  heading: number;
  /** índice do segmento atual */
  index: number;
  /** distância percorrida em metros */
  distance: number;
};

/** Amostra a rota em t (0..1) da distância total. */
export function sampleTrack(track: Track, t: number): Sample {
  const pts = track.pts;
  if (pts.length === 0) {
    return { pos: { lat: 0, lng: 0 }, heading: 0, index: 0, distance: 0 };
  }
  if (pts.length === 1) {
    return { pos: pts[0], heading: 0, index: 0, distance: 0 };
  }
  const clamped = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
  const target = clamped * track.total;
  const cum = track.cum;
  let i = 1;
  let hi = cum.length - 1;
  while (i < hi) {
    const mid = (i + hi) >> 1;
    if (cum[mid] < target) i = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(1, i);
  const segStart = cum[idx - 1];
  const segLen = cum[idx] - segStart;
  const f = segLen > 0 ? (target - segStart) / segLen : 0;
  const a = pts[idx - 1];
  const b = pts[idx];
  const pos = {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
  };
  let head = bearing(a, b);
  if (!isFinite(head) || (Math.abs(b.lat - a.lat) < 1e-9 && Math.abs(b.lng - a.lng) < 1e-9)) {
    head = 0;
  }
  return { pos, heading: head, index: idx - 1, distance: target };
}

/* ---------- Web Mercator ---------- */

export function project(lat: number, lng: number, zoom: number) {
  const n = TILE_SIZE * Math.pow(2, zoom);
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

/** Inverso exato de `project`: pixel do mundo → coordenada geográfica. */
export function unproject(x: number, y: number, zoom: number): LatLng {
  const n = TILE_SIZE * Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  // de `y = (0,5 - log((1+s)/(1-s)) / 4π) · n` sai `s = tanh(k/2)`
  const k = (0.5 - y / n) * 4 * Math.PI;
  const s = Math.max(-1, Math.min(1, Math.tanh(k / 2)));
  return { lat: (Math.asin(s) * 180) / Math.PI, lng };
}

export type Bounds = { north: number; south: number; east: number; west: number };

export function boundsOf(pts: LatLng[]): Bounds {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of pts) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { north, south, east, west };
}

/** Faixa de índices `[início, fim]`, inclusiva nas duas pontas. */
export type IndexRange = [number, number];

/**
 * Quais trechos do traçado aparecem na janela visível.
 *
 * Desenhar a rota inteira a cada quadro custa caro à toa: com a câmera
 * acompanhando o personagem no zoom 16, a janela mostra uns 3 km — numa rota
 * de 70 km isso é ~4% dos pontos. Filtrar aqui é barato porque só compara
 * coordenadas cruas; a projeção (que tem `sin`/`log`) fica reservada para o
 * que de fato vai ser desenhado. Medido: 12 mil pontos ficam ~12x mais rápidos.
 *
 * O teste é por **segmento**, não por ponto: assim um trecho que atravessa a
 * janela com as duas pontas fora dela continua sendo desenhado.
 *
 * Devolve várias faixas porque um traçado pode sair e voltar à área visível.
 */
export function visibleRuns(
  pts: LatLng[],
  b: Bounds,
  endIndex: number = pts.length - 1,
): IndexRange[] {
  const fim = Math.max(0, Math.min(endIndex, pts.length - 1));
  // visão do mundo inteiro (ou bounds invertidos): não há o que cortar
  if (b.east - b.west >= 360 || b.north - b.south >= 180 || b.west > b.east) {
    return fim >= 1 ? [[0, fim]] : [];
  }

  const runs: IndexRange[] = [];
  let inicio = -1;
  for (let i = 0; i < fim; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const fora =
      Math.max(a.lat, c.lat) < b.south ||
      Math.min(a.lat, c.lat) > b.north ||
      Math.max(a.lng, c.lng) < b.west ||
      Math.min(a.lng, c.lng) > b.east;
    if (fora) {
      if (inicio >= 0) {
        runs.push([inicio, i]);
        inicio = -1;
      }
    } else if (inicio < 0) {
      inicio = i;
    }
  }
  if (inicio >= 0) runs.push([inicio, fim]);
  return runs;
}

/** Zoom fracionário que faz os limites caberem em width x height com padding. */
export function fitZoom(b: Bounds, width: number, height: number, padFrac = 0.14): number {
  const w = Math.max(64, width * (1 - padFrac * 2));
  const h = Math.max(64, height * (1 - padFrac * 2));
  for (let z = 20; z >= 0; z -= 0.25) {
    const tl = project(b.north, b.west, z);
    const br = project(b.south, b.east, z);
    if (br.x - tl.x <= w && br.y - tl.y <= h) return z;
  }
  return 0;
}

/**
 * Projeta um ponto qualquer sobre a rota e devolve a posição (t) equivalente.
 * Usado para "colar" paradas na linha: clicar na rota ou arrastar um pino.
 */
export function nearestTOnTrack(
  track: Track,
  p: LatLng,
): { t: number; pos: LatLng; offset: number } {
  const pts = track.pts;
  if (pts.length === 0) return { t: 0, pos: p, offset: 0 };
  if (pts.length === 1) return { t: 0, pos: pts[0], offset: haversine(p, pts[0]) };

  // projeção local em metros (rápida e suficiente para distâncias curtas)
  const mLat = 111320;
  const mLng = 111320 * Math.cos((pts[0].lat * Math.PI) / 180);
  const px = (p.lng - pts[0].lng) * mLng;
  const py = (p.lat - pts[0].lat) * mLat;

  let best = Infinity;
  let bestDist = track.total / 2;
  let bestPos = pts[0];

  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1].lng - pts[0].lng) * mLng;
    const ay = (pts[i - 1].lat - pts[0].lat) * mLat;
    const bx = (pts[i].lng - pts[0].lng) * mLng;
    const by = (pts[i].lat - pts[0].lat) * mLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    const fc = Math.max(0, Math.min(1, f));
    const cx = ax + dx * fc;
    const cy = ay + dy * fc;
    const d2 = (px - cx) ** 2 + (py - cy) ** 2;
    if (d2 < best) {
      best = d2;
      const segLen = track.cum[i] - track.cum[i - 1];
      bestDist = track.cum[i - 1] + segLen * fc;
      bestPos = {
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * fc,
        lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * fc,
      };
    }
  }

  return {
    t: track.total > 0 ? bestDist / track.total : 0,
    pos: bestPos,
    offset: Math.sqrt(best),
  };
}

/**
 * Desloca uma coordenada em metros (norte/leste) — base do ajuste fino
 * de posição das paradas.
 */
export function nudge(p: LatLng, eastM: number, northM: number): LatLng {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((p.lat * Math.PI) / 180) || 1e-6;
  return { lat: p.lat + northM / mLat, lng: p.lng + eastM / mLng };
}

export function formatCoords(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

export function formatDistance(m: number): string {
  if (!isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
}

export function formatSpeed(kmh: number): string {
  return `${kmh.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km/h`;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
