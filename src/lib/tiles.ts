/**
 * Mapas 100% gratuitos e SEM chave de API.
 *
 * Nota: a CARTO (Positron/Dark Matter/Voyager) passou a exigir API key em 2026
 * e carimba "API KEY REQUIRED" nos tiles — por isso não é usada aqui.
 * Os estilos escuro/claro são gerados no próprio navegador, aplicando filtros
 * sobre os tiles do OpenStreetMap.
 */

export type BasemapId = "dark" | "light" | "osm" | "cyclosm" | "topo" | "satellite";

export type Basemap = {
  id: BasemapId;
  name: string;
  hint: string;
  /** template XYZ (sem chave de API) */
  template: string;
  subdomains: string[];
  /** maior zoom realmente servido pelo provedor */
  maxZoom: number;
  attribution: string;
  /** cor de fundo enquanto os tiles carregam */
  bg: string;
  /** filtro aplicado aos tiles (cria estilos que não existem de graça) */
  filter?: string;
  /** rótulo curto de licença mostrado na interface */
  license: string;
};

export const BASEMAPS: Record<BasemapId, Basemap> = {
  dark: {
    id: "dark",
    name: "Escuro",
    hint: "Ideal para vídeo · OSM com filtro",
    template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: [],
    maxZoom: 19,
    attribution: "© OpenStreetMap",
    bg: "#0e1117",
    filter: "invert(1) hue-rotate(180deg) saturate(0.45) brightness(0.9) contrast(1.02)",
    license: "OpenStreetMap · grátis, sem chave",
  },
  light: {
    id: "light",
    name: "Clean",
    hint: "Cinza minimalista · OSM com filtro",
    template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: [],
    maxZoom: 19,
    attribution: "© OpenStreetMap",
    bg: "#f4f4f3",
    filter: "grayscale(0.92) brightness(1.08) contrast(0.88) saturate(0.5)",
    license: "OpenStreetMap · grátis, sem chave",
  },
  osm: {
    id: "osm",
    name: "Padrão",
    hint: "OpenStreetMap original",
    template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: [],
    maxZoom: 19,
    attribution: "© OpenStreetMap",
    bg: "#e9e4dc",
    license: "OpenStreetMap · grátis, sem chave",
  },
  cyclosm: {
    id: "cyclosm",
    name: "Ciclo",
    hint: "Ciclovias em destaque",
    template: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 18,
    attribution: "© OpenStreetMap · CyclOSM",
    bg: "#eae7df",
    license: "CyclOSM / OSM France · grátis",
  },
  topo: {
    id: "topo",
    name: "Relevo",
    hint: "Trilhas e montanhas",
    template: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 17,
    attribution: "© OpenStreetMap · OpenTopoMap (CC-BY-SA)",
    bg: "#e5e0d8",
    license: "OpenTopoMap · grátis, sem chave",
  },
  satellite: {
    id: "satellite",
    name: "Satélite",
    hint: "Imagens de satélite",
    template:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    maxZoom: 19,
    attribution: "Esri · Maxar · Earthstar Geographics",
    bg: "#1b2430",
    license: "Esri World Imagery · uso livre não comercial",
  },
};

export const BASEMAP_ORDER: BasemapId[] = [
  "dark",
  "light",
  "osm",
  "cyclosm",
  "topo",
  "satellite",
];

export function tileUrl(basemap: Basemap, z: number, x: number, y: number): string {
  const n = Math.pow(2, z);
  const wx = ((x % n) + n) % n;
  const sub =
    basemap.subdomains.length > 0
      ? basemap.subdomains[(wx + y) % basemap.subdomains.length]
      : "";
  return basemap.template
    .replace("{s}", sub)
    .replace("{z}", String(z))
    .replace("{x}", String(wx))
    .replace("{y}", String(y));
}

/* ------------------------------------------------------------------ */
/* Carregamento de tiles                                               */
/* ------------------------------------------------------------------ */

/** qualquer fonte desenhável no canvas (ImageBitmap ou HTMLImageElement) */
export type TileImage = CanvasImageSource & { width: number; height: number };

const cache = new Map<string, Promise<TileImage | null>>();
const failed = new Set<string>();

async function viaFetch(url: string): Promise<TileImage | null> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (blob.size === 0) return null;
  try {
    return (await createImageBitmap(blob)) as TileImage;
  } catch {
    return null;
  }
}

function viaImg(url: string): Promise<TileImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve(img.complete && img.naturalWidth > 0 ? (img as unknown as TileImage) : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Carrega um tile de forma que o canvas **nunca** fique "tainted"
 * (condição obrigatória para gravar vídeo com captureStream).
 */
export function loadTile(url: string): Promise<TileImage | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    let img: TileImage | null = null;
    try {
      img = await viaFetch(url);
    } catch {
      img = null;
    }
    if (!img) img = await viaImg(url);
    if (!img) failed.add(url);
    return img;
  })();
  cache.set(url, p);
  return p;
}

export function isFailedTile(url: string): boolean {
  return failed.has(url);
}

/** Nova tentativa para um tile que falhou (falhas transitórias do servidor). */
export function retryTile(url: string): Promise<TileImage | null> {
  if (!failed.has(url)) return loadTile(url);
  failed.delete(url);
  cache.delete(url);
  return loadTile(url);
}

/**
 * Aplica o filtro do estilo UMA VEZ por tile (e não a cada quadro do vídeo),
 * devolvendo um bitmap já colorido — muito mais rápido na gravação.
 */
export async function filterTile(
  img: TileImage,
  filter: string | undefined,
): Promise<TileImage> {
  if (!filter) return img;
  const w = Math.max(1, Number(img.width) || 256);
  const h = Math.max(1, Number(img.height) || 256);
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return img;
    // navegadores sem suporte a ctx.filter: devolve o tile original
    ctx.filter = filter;
    if (!ctx.filter || ctx.filter === "none") return img;
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    const out = await createImageBitmap(c);
    return out as TileImage;
  } catch {
    return img;
  }
}

export function cacheStats() {
  return { cached: cache.size, failed: failed.size };
}
