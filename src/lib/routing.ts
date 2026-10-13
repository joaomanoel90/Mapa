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
/** trechos em andamento, para não disparar a mesma requisição duas vezes */
const inflight = new Map<string, Promise<Leg>>();

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

async function requestLeg(
  a: LatLng,
  b: LatLng,
  o: RouteOptions,
  signal?: AbortSignal,
): Promise<Leg> {
  const engine = engineFor(o);
  if (!engine) return directLeg(a, b);

  const coord = `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}`;
  // continue_straight=false evita voltas no quarteirão ao passar pelos pontos
  const qs = "overview=full&geometries=geojson&alternatives=false&steps=false&continue_straight=false";

  for (const base of ENDPOINTS[engine]) {
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
          if (attempt === 0) {
            await sleep(retryAfterMs(res));
            continue;
          }
          break;
        }
        if (!res.ok) break;

        const data = await res.json();
        const coords: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code !== "Ok" || !coords?.length) break;
        return {
          points: coords.map(([lng, lat]) => ({ lat, lng })),
          distance: Number(data.routes[0].distance) || 0,
          direct: false,
        };
      } catch (err) {
        // cancelamento não é falha do servidor: propaga para o chamador
        if (isAbortError(err)) throw err;
        break; // erro de rede: tenta o próximo servidor
      }
    }
  }
  return directLeg(a, b);
}

function getLeg(a: LatLng, b: LatLng, o: RouteOptions, signal?: AbortSignal): Promise<Leg> {
  const key = legKey(a, b, o);
  const cached = legCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;

  const p = requestLeg(a, b, o, signal)
    .then((leg) => {
      legCache.set(key, leg);
      inflight.delete(key);
      return leg;
    })
    .catch((err) => {
      inflight.delete(key);
      // cancelamento não vira cache: a próxima tentativa deve bater no servidor
      if (isAbortError(err)) throw err;
      return directLeg(a, b);
    });
  inflight.set(key, p);
  return p;
}

/** Já temos este trecho pronto? (usado para saber se a rota muda) */
export function hasLeg(a: LatLng, b: LatLng, o: RouteOptions): boolean {
  return legCache.has(legKey(a, b, o));
}

export function clearRouteCache() {
  legCache.clear();
  inflight.clear();
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

  let reused = 0;
  const jobs: { i: number; a: LatLng; b: LatLng }[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    if (hasLeg(waypoints[i - 1], waypoints[i], options)) reused++;
    jobs.push({ i: i - 1, a: waypoints[i - 1], b: waypoints[i] });
  }

  // concorrência limitada: os servidores de rota gratuitos pedem uso moderado
  const legs: Leg[] = new Array(jobs.length);
  const CONCURRENCY = 4;
  let cursor = 0;
  await Promise.all(
    new Array(Math.min(CONCURRENCY, Math.max(1, jobs.length))).fill(0).map(async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        legs[job.i] = await getLeg(job.a, job.b, options, signal);
      }
    }),
  );

  const points: LatLng[] = [];
  let distance = 0;
  let directCount = 0;

  legs.forEach((leg, i) => {
    distance += leg.distance;
    if (leg.direct) directCount++;
    const pts = leg.points;
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
