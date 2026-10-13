import type { LatLng } from "./geo";
import { haversine } from "./geo";

export type Profile = "car" | "bike" | "foot" | "straight";

export const PROFILES: { id: Profile; name: string; emoji: string; label: string }[] = [
  { id: "car", name: "Carro", emoji: "🚗", label: "Segue as ruas (regras de carro)" },
  { id: "bike", name: "Bike", emoji: "🚲", label: "Segue ruas e ciclovias" },
  { id: "foot", name: "A pé", emoji: "🚶", label: "Segue ruas e calçadas, sem mão obrigatória" },
  { id: "straight", name: "Livre", emoji: "✏️", label: "Linha reta entre os pontos" },
];

/**
 * Servidores de rota, em ordem de preferência.
 *
 * O `router.project-osrm.org` só serve o perfil de carro — por isso ele é
 * fallback **apenas** para `car`. Usá-lo em bike/pé devolveria traçado de
 * carro (rodovia, mão única), o que seria pior do que assumir a falha.
 * Para esses perfis a resiliência vem de retentar após 429 e de avisar o
 * usuário quando o servidor não responde (ver `RouteResult.note`).
 */
const ENDPOINTS: Record<Exclude<Profile, "straight">, string[]> = {
  car: [
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
    "https://router.project-osrm.org/route/v1/driving/",
  ],
  bike: ["https://routing.openstreetmap.de/routed-bike/route/v1/driving/"],
  foot: ["https://routing.openstreetmap.de/routed-foot/route/v1/driving/"],
};

export type RouteOptions = {
  profile: Profile;
  /**
   * Ignora o sentido obrigatório das vias (mão única).
   * O traçado passa a ser o caminho mais direto pelas ruas, sem voltas
   * no quarteirão para "entrar na mão certa".
   */
  ignoreOneway: boolean;
};

export type RouteResult = {
  points: LatLng[];
  distance: number;
  source: "osrm" | "direct" | "mixed";
  note?: string;
  /** quantos trechos vieram do cache (não foram recalculados) */
  reused: number;
};

/* ------------------------------------------------------------------ */
/* Cache por trecho                                                    */
/* ------------------------------------------------------------------ */

type Leg = { points: LatLng[]; distance: number; direct: boolean };

const legCache = new Map<string, Leg>();

const r5 = (n: number) => n.toFixed(5);

function legKey(a: LatLng, b: LatLng, o: RouteOptions): string {
  return [
    o.profile,
    o.ignoreOneway ? "free" : "strict",
    r5(a.lat),
    r5(a.lng),
    r5(b.lat),
    r5(b.lng),
  ].join("|");
}

function directLeg(a: LatLng, b: LatLng): Leg {
  return { points: [a, b], distance: haversine(a, b), direct: true };
}

/**
 * Motor usado de fato.
 * O perfil "a pé" do OSRM não aplica restrições de mão única — por isso ele
 * é usado quando o usuário pede para ignorar a contramão, mantendo o traçado
 * sobre as ruas, mas sem desvios artificiais.
 */
function engineFor(o: RouteOptions): Exclude<Profile, "straight"> | null {
  if (o.profile === "straight") return null;
  if (o.ignoreOneway) return "foot";
  return o.profile;
}

/** Requisição cancelada porque uma rota mais nova tomou o lugar dela. */
export function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number };
  return e.name === "AbortError" || e.code === 20;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Teto de espera para não travar a interface quando o servidor pede pausa. */
const RETRY_AFTER_MAX_MS = 1500;

/** Quanto o servidor pediu para esperar (429 / Retry-After), com teto. */
function retryAfterMs(res: Response): number {
  const raw = res.headers.get("Retry-After");
  if (!raw) return 400;
  const secs = Number(raw);
  if (Number.isFinite(secs)) {
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, secs * 1000));
  }
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, when - Date.now()));
  }
  return 400;
}

/* ------------------------------------------------------------------ */
/* Roteamento em punhado                                               */
/* ------------------------------------------------------------------ */

/**
 * Máximo de coordenadas por requisição (limite do próprio OSRM).
 *
 * Uma requisição por trecho era simples, mas cada trecho é uma ida ao
 * servidor: com 60 paradas eram 59 requisições, e com 3.000 seriam 2.999.
 * Mandando as coordenadas juntas, 100 paradas (99 trechos) cabem em uma
 * requisição só — o servidor devolve a geometria inteira e a distância de
 * cada trecho em `legs`.
 */
export const MAX_COORDS_PER_CALL = 100;

/** Quantos punhados podem estar no ar ao mesmo tempo. */
const RUN_CONCURRENCY = 3;

/** Abaixo disto não vale dividir um punhado que falhou: gera mais requisição do que salva traçado. */
const SPLIT_FLOOR = 4;

type Run = {
  /** geometria da rota inteira do punhado */
  points: LatLng[];
  /** onde o servidor encaixou cada parada (para cortar a geometria) */
  cuts: LatLng[];
  /** distância de cada trecho, na ordem */
  distances: number[];
};

type RunAttempt = { run: Run } | { failure: "rate-limit" | "server" };

/**
 * Quais trechos faltam calcular e como agrupá-los.
 *
 * Só trechos **seguidos** entram no mesmo punhado: a resposta é um caminho
 * único, então agrupar buracos do meio não daria para cortar depois.
 */
export function planRuns(
  missing: boolean[],
  maxCoords = MAX_COORDS_PER_CALL,
): { from: number; to: number }[] {
  const perRun = Math.max(1, maxCoords - 1);
  const runs: { from: number; to: number }[] = [];
  for (let i = 0; i < missing.length; i++) {
    if (!missing[i]) continue;
    let j = i;
    while (j + 1 < missing.length && missing[j + 1] && j - i + 1 < perRun) j++;
    runs.push({ from: i, to: j });
    i = j;
  }
  return runs;
}

/**
 * Em que ponto da geometria cada parada caiu.
 *
 * A rota passa exatamente pelas paradas (o servidor encaixa cada uma na rua),
 * então basta procurar o ponto mais próximo — avançando sempre, porque a
 * ordem das paradas é a ordem do caminho. É isso que permite guardar cada
 * trecho no cache com a sua própria geometria.
 */
export function splitIndices(pts: LatLng[], cuts: LatLng[]): number[] {
  const out: number[] = [0];
  let cursor = 0;
  for (let j = 1; j < cuts.length - 1; j++) {
    const alvo = cuts[j];
    let best = cursor;
    let bestD = Infinity;
    for (let k = cursor; k < pts.length; k++) {
      const d = (pts[k].lat - alvo.lat) ** 2 + (pts[k].lng - alvo.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    cursor = best;
    out.push(best);
  }
  out.push(Math.max(0, pts.length - 1));
  return out;
}

/**
 * Distância de cada trecho.
 *
 * O OSRM devolve `legs[]`, uma por trecho. Quando ele não vem, a distância
 * total é repartida na proporção das linhas retas — a soma continua sendo a
 * distância real do caminho.
 */
function legDistances(
  route: { distance?: number; legs?: { distance?: number }[] } | undefined,
  wps: LatLng[],
): number[] {
  const n = wps.length - 1;
  const retas = wps.slice(1).map((w, i) => haversine(wps[i], w));
  const legs = route?.legs;
  if (Array.isArray(legs) && legs.length === n) {
    return legs.map((l, i) => Number(l?.distance) || retas[i]);
  }
  const total = Number(route?.distance) || 0;
  const soma = retas.reduce((a, b) => a + b, 0);
  if (total <= 0 || soma <= 0) return retas;
  return retas.map((r) => (r / soma) * total);
}

/** Lê a resposta do servidor para um punhado de paradas. */
export function parseRun(data: unknown, wps: LatLng[]): Run | null {
  const d = data as {
    code?: string;
    routes?: {
      geometry?: { coordinates?: [number, number][] };
      distance?: number;
      legs?: { distance?: number }[];
    }[];
    waypoints?: { location?: [number, number] }[];
  } | null;
  const route = d?.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (d?.code !== "Ok" || !coords?.length) return null;

  const points = coords.map(([lng, lat]) => ({ lat, lng }));
  const cuts = wps.map((w, i) => {
    const loc = d.waypoints?.[i]?.location;
    return loc && loc.length === 2 ? { lat: loc[1], lng: loc[0] } : w;
  });
  return { points, cuts, distances: legDistances(route, wps) };
}

/** Um punhado vira um trecho por par de paradas, cada um com a sua geometria. */
export function legsFromRun(run: Run): Leg[] {
  const idx = splitIndices(run.points, run.cuts);
  const out: Leg[] = [];
  for (let i = 0; i + 1 < idx.length; i++) {
    out.push({
      points: run.points.slice(idx[i], idx[i + 1] + 1),
      distance: run.distances[i] ?? 0,
      direct: false,
    });
  }
  return out;
}

async function requestRun(
  wps: LatLng[],
  o: RouteOptions,
  signal?: AbortSignal,
): Promise<RunAttempt> {
  const engine = engineFor(o);
  if (!engine) return { failure: "server" };

  const coord = wps.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(";");
  // continue_straight=false evita voltas no quarteirão ao passar pelos pontos
  const qs = "overview=full&geometries=geojson&alternatives=false&steps=false&continue_straight=false";

  let failure: "rate-limit" | "server" = "server";
  for (const base of ENDPOINTS[engine]) {
    let rate = false;
    // duas tentativas por servidor: a segunda só acontece depois de um 429
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${base}${coord}?${qs}`, {
          headers: { Accept: "application/json" },
          signal,
        });

        if (res.status === 429) {
          // limite de uso do servidor comunitário: espera o tempo pedido
          // e tenta uma vez mais antes de passar para o próximo
          rate = true;
          if (attempt === 0) {
            await sleep(retryAfterMs(res));
            continue;
          }
          break;
        }
        rate = false;
        if (!res.ok) break;

        const run = parseRun(await res.json(), wps);
        if (run) return { run };
        break;
      } catch (err) {
        // cancelamento não é falha do servidor: propaga para o chamador
        if (isAbortError(err)) throw err;
        rate = false;
        break; // erro de rede: tenta o próximo servidor
      }
    }
    failure = rate ? "rate-limit" : "server";
  }
  return { failure };
}

/**
 * Calcula um punhado de trechos.
 *
 * Se o servidor recusar o punhado inteiro — e não for limite de uso —, ele é
 * dividido ao meio e cada metade é tentada de novo: assim uma parada
 * problemática não joga o traçado todo para a linha reta. Quando é limite de
 * uso, dividir só multiplicaria requisições, então o punhado inteiro vira
 * linha reta e o aviso aparece na tela.
 */
async function fetchRun(wps: LatLng[], o: RouteOptions, signal?: AbortSignal): Promise<Leg[]> {
  const attempt = await requestRun(wps, o, signal);
  if ("run" in attempt) return legsFromRun(attempt.run);

  const trechos = wps.length - 1;
  if (attempt.failure === "rate-limit" || trechos <= SPLIT_FLOOR) {
    return wps.slice(1).map((w, i) => directLeg(wps[i], w));
  }
  const meio = Math.ceil(trechos / 2);
  const primeira = await fetchRun(wps.slice(0, meio + 1), o, signal);
  const segunda = await fetchRun(wps.slice(meio), o, signal);
  return [...primeira, ...segunda];
}

/** Já temos este trecho pronto? (usado para saber se a rota muda) */
export function hasLeg(a: LatLng, b: LatLng, o: RouteOptions): boolean {
  return legCache.has(legKey(a, b, o));
}

export function clearRouteCache() {
  legCache.clear();
  snapCache.clear();
}

/* ------------------------------------------------------------------ */
/* Encaixe na rua mais próxima (OSRM "nearest")                        */
/* ------------------------------------------------------------------ */

export type SnapResult = {
  point: LatLng;
  /** nome da via onde o ponto caiu */
  street?: string;
  /** distância, em metros, entre o clique e a rua */
  distance: number;
  snapped: boolean;
};

const NEAREST: Record<Exclude<Profile, "straight">, string[]> = {
  car: [
    "https://routing.openstreetmap.de/routed-car/nearest/v1/driving/",
    "https://router.project-osrm.org/nearest/v1/driving/",
  ],
  bike: ["https://routing.openstreetmap.de/routed-bike/nearest/v1/driving/"],
  foot: ["https://routing.openstreetmap.de/routed-foot/nearest/v1/driving/"],
};

const snapCache = new Map<string, SnapResult>();

/** se a rua estiver mais longe que isso, mantemos o clique original */
const MAX_SNAP_METERS = 220;

/**
 * Move o ponto clicado para cima da rua mais próxima.
 * Assim a linha encosta exatamente no eixo da via, em vez de começar no
 * meio de um quarteirão e "pular" até a rua.
 */
export async function snapToRoad(
  point: LatLng,
  options: RouteOptions,
  signal?: AbortSignal,
): Promise<SnapResult> {
  const engine = engineFor(options);
  if (!engine) return { point, distance: 0, snapped: false };

  const key = `${engine}|${r5(point.lat)}|${r5(point.lng)}`;
  const cached = snapCache.get(key);
  if (cached) return cached;

  const coord = `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`;
  for (const base of NEAREST[engine]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${base}${coord}?number=1`, {
          headers: { Accept: "application/json" },
          signal,
        });

        if (res.status === 429) {
          if (attempt === 0) {
            await sleep(retryAfterMs(res));
            continue;
          }
          break;
        }
        if (!res.ok) break;

        const data = await res.json();
        const wp = data?.waypoints?.[0];
        if (data?.code !== "Ok" || !wp?.location) break;

        const [lng, lat] = wp.location as [number, number];
        const distance = Number(wp.distance) || 0;
        const out: SnapResult =
          distance > MAX_SNAP_METERS
            ? { point, distance, snapped: false }
            : {
                point: { lat, lng },
                street: typeof wp.name === "string" && wp.name ? wp.name : undefined,
                distance,
                snapped: true,
              };
        snapCache.set(key, out);
        return out;
      } catch (err) {
        if (isAbortError(err)) throw err;
        break; // erro de rede: tenta o próximo servidor
      }
    }
  }
  const fallback: SnapResult = { point, distance: 0, snapped: false };
  snapCache.set(key, fallback);
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Rota completa                                                       */
/* ------------------------------------------------------------------ */

/**
 * Monta a rota juntando trecho a trecho.
 *
 * Como cada trecho é calculado e guardado isoladamente, mover ou acrescentar
 * um ponto **não altera** os trechos que já estavam desenhados — o traçado
 * para de "pular" a cada clique.
 */
export async function fetchRoute(
  waypoints: LatLng[],
  options: RouteOptions,
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    return { points: [...waypoints], distance: 0, source: "direct", reused: 0 };
  }

  const legs: (Leg | undefined)[] = new Array(waypoints.length - 1).fill(undefined);
  let reused = 0;
  for (let i = 0; i < legs.length; i++) {
    const cached = legCache.get(legKey(waypoints[i], waypoints[i + 1], options));
    if (cached) {
      legs[i] = cached;
      reused++;
    }
  }

  // só o que falta vai ao servidor, agrupado em punhados de até 99 trechos
  const runs = planRuns(legs.map((l) => !l));

  let cursor = 0;
  await Promise.all(
    new Array(Math.min(RUN_CONCURRENCY, Math.max(1, runs.length))).fill(0).map(async () => {
      while (cursor < runs.length) {
        const run = runs[cursor++];
        const calculados = await fetchRun(
          waypoints.slice(run.from, run.to + 2),
          options,
          signal,
        );
        for (let i = run.from; i <= run.to; i++) {
          const a = waypoints[i];
          const b = waypoints[i + 1];
          const leg = calculados[i - run.from] ?? directLeg(a, b);
          legs[i] = leg;
          legCache.set(legKey(a, b, options), leg);
        }
      }
    }),
  );

  const points: LatLng[] = [];
  let distance = 0;
  let directCount = 0;

  legs.forEach((leg, i) => {
    const l = leg ?? directLeg(waypoints[i], waypoints[i + 1]);
    distance += l.distance;
    if (l.direct) directCount++;
    const pts = l.points;
    // evita duplicar o ponto de junção entre trechos
    const start = i === 0 ? 0 : 1;
    for (let k = start; k < pts.length; k++) points.push(pts[k]);
  });

  const source: RouteResult["source"] =
    options.profile === "straight" || directCount === legs.length
      ? "direct"
      : directCount > 0
        ? "mixed"
        : "osrm";

  let note: string | undefined;
  if (options.profile !== "straight" && directCount > 0) {
    note =
      directCount === legs.length
        ? "Servidor de rotas indisponível — usando linhas retas."
        : `${directCount} de ${legs.length} trechos não puderam ser calculados e viraram linha reta.`;
  }

  return { points, distance, source, note, reused };
}

/* ------------------------------------------------------------------ */
/* Exemplos                                                            */
/* ------------------------------------------------------------------ */

export type Preset = {
  id: string;
  name: string;
  emoji: string;
  profile: Profile;
  points: LatLng[];
  /** paradas sugeridas do percurso */
  stops?: { kindId: string; t: number; label?: string }[];
};

export const PRESETS: Preset[] = [
  {
    id: "angatuba",
    name: "Angatuba",
    emoji: "🏡",
    profile: "car",
    points: [
      { lat: -23.4903, lng: -48.4128 },
      { lat: -23.4938, lng: -48.4186 },
      { lat: -23.4975, lng: -48.4119 },
    ],
    stops: [
      { kindId: "igreja", t: 0.3, label: "Igreja Matriz" },
      { kindId: "praca", t: 0.58, label: "Praça Central" },
      { kindId: "ponte", t: 0.84, label: "Ponte do Rio" },
    ],
  },
  {
    id: "sp",
    name: "São Paulo",
    emoji: "🏙️",
    profile: "car",
    points: [
      { lat: -23.5613, lng: -46.6565 },
      { lat: -23.5766, lng: -46.6489 },
      { lat: -23.5902, lng: -46.6622 },
      { lat: -23.6014, lng: -46.6728 },
    ],
  },
  {
    id: "lis",
    name: "Lisboa",
    emoji: "🚋",
    profile: "car",
    points: [
      { lat: 38.7223, lng: -9.1393 },
      { lat: 38.7107, lng: -9.1369 },
      { lat: 38.6979, lng: -9.2065 },
    ],
  },
  {
    id: "nyc",
    name: "Nova York",
    emoji: "🗽",
    profile: "car",
    points: [
      { lat: 40.758, lng: -73.9855 },
      { lat: 40.7411, lng: -73.9897 },
      { lat: 40.7265, lng: -74.0054 },
      { lat: 40.7128, lng: -74.006 },
    ],
  },
  {
    id: "rio",
    name: "Rio",
    emoji: "🏖️",
    profile: "foot",
    points: [
      { lat: -22.9711, lng: -43.1822 },
      { lat: -22.9638, lng: -43.1745 },
      { lat: -22.9554, lng: -43.1655 },
    ],
  },
];
