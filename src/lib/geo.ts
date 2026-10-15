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

/**
 * Meia-janela (em metros de caminho) da média móvel que tira o ruído do GPS.
 *
 * A janela é medida em **metros de caminho**, e não em quantidade de pontos: um
 * arquivo de 1 Hz e outro de 10 Hz têm que medir a mesma distância. Ela vale para
 * os dois lados: o ponto vira a média de até 50 m antes e 50 m depois.
 *
 * O valor foi calibrado num arquivo real de prova de rua (5.704 pontos, um a cada
 * 3,6 m): somando ponto a ponto, o percurso rende **21,717 km**, e o Strava marca
 * **21,370**. Com 8 m (o valor anterior) o app media 21,531 — 0,8% a mais, o que
 * num vídeo de 1h47 aparecia como ritmo **4:58** onde o certo era **5:02**. Com
 * esta janela mede 21,394 km (**5:02** com o tempo exato digitado na cartela).
 *
 * Uma janela larga assim só é segura por causa das outras duas regras abaixo: o
 * ponto de curva fechada fica exatamente onde está, e a janela **não atravessa**
 * essas curvas. Sem elas, esta janela cortava esquina de rua e media -1,3% de um
 * percurso com curvas de raio 25 m e 150 m; com elas, erra -0,2% no mesmo
 * percurso e -0,13% numa volta curta de quadra (900 m, cinco esquinas).
 */
export const SMOOTH_WINDOW_M = 50;

/**
 * Curvatura (em graus) a partir da qual o ponto é **preservado** como está.
 *
 * A média móvel sozinha corta esquina: numa rua de cidade com curvas de 90°, a
 * distância medida perdia 2,1% — e pé de ouvido isso é sumir com uma curva
 * inteira. Preservando os pontos de curva fechada, a mesma rua de cidade mede
 * exatamente o que mediava antes.
 *
 * São 30° medidos no trecho de 40 m (`TURN_SPAN_M` de cada lado), o que preserva
 * curva de raio até ~76 m — a esquina arredondada de rua (raio 10 a 25 m),
 * inclusive as **bocas** da curva. Era esse o defeito dos 50°: a esquina de raio
 * 25 m dava 46° no meio (protegida) mas só 20-40° na entrada e na saída, e a
 * média entrava justamente ali, comendo a curva: medido num percurso de 34,7 km
 * com esquinas de raio 25 m e curvas de raio 150 m, o filtro perdia 1,3% com a
 * janela de 50 m e 50°; com 30°, perde 0,27%.
 */
export const SHARP_TURN_DEG = 30;

/**
 * Distância (m) usada para medir a curva em cada ponto.
 *
 * **Não** se mede o giro entre dois pontos vizinhos: com ruído de GPS, um ponto
 * jogado 3 m para o lado num arquivo de 1 Hz vira uma "curva" de 50°, e aí o
 * filtro preserva tudo e não filtra nada (foi o primeiro defeito que apareceu,
 * medindo). O rumo é medido de 40 m antes até 40 m depois: o vaivém do sinal se
 * cancela, e uma esquina de verdade continua aparecendo inteira.
 *
 * O span é o que separa **vaivém de curva** quando os dois têm o mesmo tamanho
 * aparente: o erro do rumo cai com o span (é ruído dividido por distância), e o
 * giro de uma curva de verdade não muda com ele. Medido numa reta densa com
 * ruído branco de ±2,5 m, o giro medido tem mediana de 23° num span de 20 m e de
 * 13° num span de 40 m: com 20 m, o limiar de 30° preservava 36 pontos de cada
 * 100 (o ruído passava inteiro); com 40 m, 5.
 */
export const TURN_SPAN_M = 40;

/**
 * Quantas passadas a média móvel dá.
 *
 * Duas passadas encolhem o ruído que sobra sem mexer na geometria limpa (numa
 * rua reta de verdade, a média de pontos alinhados cai na própria reta — o
 * filtro é inofensivo nela). Medido numa reta de 21,4 km com ruído de ±2,5 m:
 * somar cru dá +3,8%; uma passada, +1,0%; duas, +0,6%; três, +0,5% (a terceira
 * já não paga o preço).
 */
export const SMOOTH_PASSES = 2;

/**
 * Todos os `LatLng` são o mesmo objeto no fim; nada aqui muta as pontas.
 */
function copia(p: LatLng): LatLng {
  return { lat: p.lat, lng: p.lng, ...(p.ele === undefined ? {} : { ele: p.ele }) };
}

/** Primeiro índice cujo `cum` alcança `alvo` (cum é monótono). */
function primeiroIndice(cum: number[], alvo: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < alvo) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Último índice cujo `cum` não passa de `alvo`. */
function ultimoIndice(cum: number[], alvo: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= alvo) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Onde cada ponto cai depois de tirar o vaivém do GPS.
 *
 * Cada ponto vira a média dos pontos que estão a até `windowM` de caminho dele
 * (a média de desvios aleatórios encolhe: com n pontos, sobram 1/√n do ruído).
 * Dois cuidados, os dois aprendidos medindo:
 *
 * 1. **as pontas e as curvas fechadas ficam como estão** — a média corta esquina
 *    de verdade, e uma esquina de rua não é ruído;
 * 2. **a janela é medida no caminho, e não em quantidade de pontos** — arquivos
 *    de 1 Hz e de 10 Hz têm que medir a mesma distância;
 * 3. **a janela não atravessa uma curva fechada** — o trecho de média de cada
 *    ponto começa depois da última esquina e termina antes da próxima. Sem isso,
 *    a média pegava pontos dos dois lados da esquina e o traçado "estourava" ali
 *    (medido numa rua de cidade limpa, 90° a cada 200 m: +2,5% de distância
 *    inventada com janela de 32 m, sem curva nenhuma para justificar).
 */
export function smoothedPoints(
  pts: LatLng[],
  windowM = SMOOTH_WINDOW_M,
  passadas = SMOOTH_PASSES,
): LatLng[] {
  if (pts.length < 3 || !(windowM > 0)) return pts.map(copia);
  let atual = pts.map(copia);
  const n = Math.max(1, Math.round(passadas));
  for (let k = 0; k < n; k++) atual = umaPassada(atual, windowM);
  return atual;
}

/** Uma passada da média móvel (o vaivém do GPS encolhe; a reta fica na reta). */
function umaPassada(pts: LatLng[], windowM: number): LatLng[] {
  const n = pts.length;
  if (n < 3) return pts.map(copia);

  const cum = cumulative(pts);
  // quem fica exatamente onde está: as pontas e as curvas fechadas
  const fixo = pts.map((_, i) => i === 0 || i === n - 1 || curvaFechada(pts, i, cum));
  // vizinho fixo mais próximo de cada lado: é ele que limita a janela
  const antes = new Int32Array(n);
  const depois = new Int32Array(n);
  let ultimo = -1;
  for (let i = 0; i < n; i++) {
    antes[i] = ultimo;
    if (fixo[i]) ultimo = i;
  }
  ultimo = n;
  for (let i = n - 1; i >= 0; i--) {
    depois[i] = ultimo;
    if (fixo[i]) ultimo = i;
  }
  // prefixos das coordenadas: a média de cada janela sai em tempo constante
  const somaLat = new Float64Array(n + 1);
  const somaLng = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    somaLat[i + 1] = somaLat[i] + pts[i].lat;
    somaLng[i + 1] = somaLng[i] + pts[i].lng;
  }

  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    if (fixo[i]) {
      out.push(copia(pts[i]));
      continue;
    }
    /*
     * A janela **não atravessa** um ponto fixo: perto de uma esquina, a média
     * só enxerga o lado do caminho em que o ponto está. É o que permite a janela
     * ser larga o bastante para tirar o ruído sem inventar distância na curva.
     */
    const lo = Math.max(primeiroIndice(cum, cum[i] - windowM), antes[i] + 1);
    const hi = Math.min(ultimoIndice(cum, cum[i] + windowM), depois[i] - 1);
    const m = hi - lo + 1;
    if (m < 2) {
      out.push(copia(pts[i]));
      continue;
    }
    const medio = pts[i];
    out.push({
      lat: (somaLat[hi + 1] - somaLat[lo]) / m,
      lng: (somaLng[hi + 1] - somaLng[lo]) / m,
      ...(medio.ele === undefined ? {} : { ele: medio.ele }),
    });
  }
  return out;
}

/**
 * O ponto `i` é uma curva fechada (e não vaivém do GPS)?
 *
 * O rumo de chegada e o de saída são medidos em `TURN_SPAN_M` metros, e não nos
 * pontos vizinhos: é o que separa uma esquina de verdade de um ponto que o sinal
 * jogou para o lado. Um trecho curto demais não tem rumo confiável — aí,
 * conservadoramente, o ponto é preservado (melhor manter um ponto a mais do que
 * cortar uma curva de verdade).
 */
function curvaFechada(pts: LatLng[], i: number, cum: number[]): boolean {
  const ia = Math.min(i - 1, primeiroIndice(cum, cum[i] - TURN_SPAN_M));
  const ib = Math.max(i + 1, ultimoIndice(cum, cum[i] + TURN_SPAN_M));
  if (ia < 0 || ib > pts.length - 1) return true;
  if (ia === i || ib === i) return true;
  if (haversine(pts[ia], pts[i]) < 1 || haversine(pts[i], pts[ib]) < 1) return true;
  const b1 = bearing(pts[ia], pts[i]);
  const b2 = bearing(pts[i], pts[ib]);
  if (!Number.isFinite(b1) || !Number.isFinite(b2)) return true;
  const delta = ((b2 - b1 + 540) % 360) - 180;
  return Math.abs(delta) > SHARP_TURN_DEG;
}

/**
 * Distância acumulada medida **com o ruído do GPS removido**.
 *
 * A distância que vai para os números do vídeo (ritmo, distância do HUD, marcas
 * de km) sai daqui; o traçado **desenhado** continua sendo o do arquivo, ponto a
 * ponto. É a mesma ideia que os aplicativos de treino usam — aqui somar cru
 * infla a distância em ~2%, e o ritmo sai ~2% rápido por causa disso.
 *
 * O `cum` devolvido é por ponto do **arquivo**, então `sampleTrack`, as marcas
 * de km e o HUD seguem falando a mesma língua.
 */
export function measuredCumulative(
  pts: LatLng[],
  windowM = SMOOTH_WINDOW_M,
  passadas = SMOOTH_PASSES,
): number[] {
  return cumulative(smoothedPoints(pts, windowM, passadas));
}

export function buildTrack(input: LatLng[]): Track {
  let pts = input;
  if (input.length > MAX_TRACK_POINTS) {
    const step = Math.ceil(input.length / MAX_TRACK_POINTS);
    pts = input.filter((_, i) => i % step === 0 || i === input.length - 1);
  }
  /*
   * O desenho usa `pts` como sempre; só a **medida** passa pelo filtro. Com os
   * três pontos de um teste de unidade, o filtro devolve a mesma coisa: os
   * pontos do meio de uma reta caem na própria reta.
   */
  const cum = pts.length < 3 ? cumulative(pts) : measuredCumulative(pts);
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
