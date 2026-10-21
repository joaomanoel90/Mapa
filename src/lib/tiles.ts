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
    // chamava-se "Relevo" — e aí o interruptor do sombreado (que se chama
    // Relevo) ficaria com o mesmo nome de um mapa. O mapa é topográfico; o
    // nome dele é Topo.
    name: "Topo",
    hint: "Curvas de nível e trilhas",
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

/** O que basta para montar o endereço de um bloco. */
export type TileSource = {
  template: string;
  subdomains: string[];
};

/* ------------------------------------------------------------------ */
/* Relevo: o sombreado do terreno                                      */
/* ------------------------------------------------------------------ */

/**
 * O sombreado de relevo do Esri (USGS), sem chave de API.
 *
 * É a **sombra** do terreno vista de cima — claro onde a encosta pega sol,
 * escuro onde ela está virada para o outro lado. Não é um mapa: é uma camada
 * cinza para ser misturada por baixo (ou por cima) do mapa que já está lá.
 *
 * O `{y}` vem **antes** do `{x}` no endereço deste serviço; `tileUrl` troca
 * pelos nomes, então a ordem do modelo é o que manda.
 *
 * O serviço serve até o zoom 16. Acima disso o bloco do relevo é o do 16
 * recortado (`hillshadeBloco`) — pedir além disso devolve erro.
 */
export const HILLSHADE = {
  template:
    "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
  subdomains: [] as string[],
  maxZoom: 16,
  attribution: "Esri · World Hillshade (USGS)",
};

export function hillshadeUrl(z: number, x: number, y: number): string {
  return tileUrl(HILLSHADE, z, x, y);
}

/**
 * O bloco de relevo que cobre o bloco `z/x/y` do mapa — e o recorte dele.
 *
 * Em zoom acima de 16 o serviço não tem bloco próprio: o do 16 é desenhado
 * esticado sobre o pedaço que interessa. `sx/sy/sw/sh` são esse recorte, em
 * pixels da imagem (256 de lado, dividido por 2 a cada nível acima).
 */
export function hillshadeBloco(
  z: number,
  x: number,
  y: number,
): { url: string; sx: number; sy: number; sw: number; sh: number } {
  const zRel = Math.min(z, HILLSHADE.maxZoom);
  const acima = Math.max(0, z - HILLSHADE.maxZoom);
  const k = Math.pow(2, acima);
  const px = Math.floor(x / k);
  const py = Math.floor(y / k);
  const lado = 256 / k;
  const dentro = (v: number) => ((v % k) + k) % k;
  return {
    url: hillshadeUrl(zRel, px, py),
    sx: dentro(x) * lado,
    sy: dentro(y) * lado,
    sw: lado,
    sh: lado,
  };
}

/** Como o sombreado entra em cada estilo. */
export type RelevoEstilo = {
  /**
   * O modo de mistura do canvas.
   *
   * `overlay` e `soft-light` são os certos para um sombreado — e a razão é o
   * **cinza neutro**: o sombreado do USGS vem em cinza (128 = encosta plana,
   * 255 = pegando sol, 0 = na sombra), e é justamente no 128 que a mistura
   * `overlay`/`soft-light` deixa o mapa **como estava**. Assim só a encosta
   * muda de brilho; o resto do mapa não escurece.
   *
   * `multiply` foi a primeira escolha e está errado: encosta plana (128)
   * também escurece, e o mapa inteiro fica lavado — medido numa base #efe9df,
   * com alpha 0,55 o chão caía de 234 para 118 de luminância. `screen` erra
   * para o outro lado: no mapa escuro a encosta iluminada estourava para 152.
   */
  modo: "overlay" | "soft-light" | "multiply";
  /** quanto do sombreado aparece (0..1) */
  alpha: number;
};

/**
 * A mistura de cada mapa.
 *
 * O **Escuro** é o que mostra o relevo com mais força: o mapa é quase preto,
 * então a encosta iluminada é o que desenha a serra (é o mesmo truque dos
 * mapas noturnos de montanha). Nos claros o `overlay` entra mais de leve — o
 * mapa já tem contraste de sobra.
 *
 * O **Satélite** usa `soft-light`: as cores da imagem são o assunto, e o
 * `overlay` puxaria o verde da mata para tons irreais.
 *
 * O **Topo** (OpenTopoMap) já vem com curvas de nível e sombreado próprios:
 * sombrear de novo só escureceria o mapa.
 */
export const RELEVO_DO_MAPA: Record<BasemapId, RelevoEstilo | null> = {
  dark: { modo: "overlay", alpha: 0.7 },
  light: { modo: "multiply", alpha: 0.4 },
  osm: { modo: "multiply", alpha: 0.4 },
  cyclosm: { modo: "multiply", alpha: 0.4 },
  satellite: { modo: "soft-light", alpha: 0.7 },
  topo: null,
};

/** O estilo deste mapa aceita relevo? (`null` = o mapa já tem o seu) */
export function relevoDoMapa(basemap: BasemapId): RelevoEstilo | null {
  return RELEVO_DO_MAPA[basemap] ?? null;
}

/**
 * Desenha o sombreado por cima do bloco já filtrado, numa imagem só.
 *
 * Por que juntar os dois numa imagem em vez de desenhar duas camadas no vídeo:
 * assim o bloco continua sendo **um** objeto no cache e no desenho — a
 * gravação, o congelamento de blocos e o aquecimento não precisam saber que
 * existe uma segunda imagem. O custo é uma requisição a mais por bloco — mas
 * só até o zoom 16: acima disso quatro blocos do 18 dividem um do 16, e a
 * conta do teto (`pedidosDaAnimacao`) usa esse número, não "blocos × 2".
 */
export async function comporRelevo(
  base: TileImage,
  sombra: TileImage,
  estilo: RelevoEstilo,
  recorte?: { sx: number; sy: number; sw: number; sh: number },
): Promise<TileImage> {
  const w = Math.max(1, Number(base.width) || 256);
  const h = Math.max(1, Number(base.height) || 256);
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return base;
    ctx.drawImage(base as CanvasImageSource, 0, 0, w, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, estilo.alpha));
    ctx.globalCompositeOperation = estilo.modo;
    if (recorte) {
      ctx.drawImage(
        sombra as CanvasImageSource,
        recorte.sx,
        recorte.sy,
        recorte.sw,
        recorte.sh,
        0,
        0,
        w,
        h,
      );
    } else {
      ctx.drawImage(sombra as CanvasImageSource, 0, 0, w, h);
    }
    return (await createImageBitmap(c)) as TileImage;
  } catch {
    // sem `createImageBitmap` (ou canvas bloqueado): o mapa sai sem o relevo,
    // nunca sem o mapa
    return base;
  }
}

export function tileUrl(source: TileSource, z: number, x: number, y: number): string {
  const n = Math.pow(2, z);
  const wx = ((x % n) + n) % n;
  const sub =
    source.subdomains.length > 0
      ? source.subdomains[(wx + y) % source.subdomains.length]
      : "";
  return source.template
    .replace("{s}", sub)
    .replace("{z}", String(z))
    .replace("{x}", String(wx))
    .replace("{y}", String(y));
}

/* ------------------------------------------------------------------ */
/* A grade de pixels do dispositivo                                    */
/* ------------------------------------------------------------------ */

/**
 * Prende um valor (em pixels de CSS) na grade de pixels do dispositivo.
 *
 * É a mesma ideia do `retanguloDoBloco` do renderizador, do lado do DOM: uma
 * imagem de mapa colocada em cima de meio pixel é reamostrada pelo navegador, e
 * entre duas imagens vizinhas isso deixa uma **fresta** de menos de um pixel —
 * que aparece como uma linha escura (é o fundo do mapa que fica à mostra). Com o
 * `devicePixelRatio` de 2 do celular, prender no pixel de CSS não basta: o
 * navegador desenha em pixels de dispositivo, e é nessa grade que as bordas
 * precisam cair.
 */
export function emPixelInteiro(valor: number, dpr = 1): number {
  const f = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  // multiplicar pelo dpr põe o valor em pixels de dispositivo: arredondar ali
  // é o mesmo que prender no pixel do aparelho, seja ele 1, 2 ou 1,5 por CSS
  return Math.round(valor * f) / f;
}

/** O mesmo, para um ponto em pixels de CSS. */
export function pontoEmPixelInteiro(
  x: number,
  y: number,
  dpr = 1,
): { x: number; y: number } {
  return { x: emPixelInteiro(x, dpr), y: emPixelInteiro(y, dpr) };
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
