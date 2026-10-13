import { BASEMAPS, type BasemapId } from "./tiles";
import type { CameraMode } from "./renderer";
import type { Profile } from "./routing";

/**
 * Limite de paradas por rota.
 *
 * Cada trecho era uma requisição ao servidor de rotas gratuito — com 60
 * paradas, 59 requisições. Desde que as coordenadas passaram a ir em punhado
 * (até 99 trechos por requisição), 3.000 paradas custam 31 requisições.
 * O teto agora existe para a tela continuar respondendo, e não para o
 * servidor: acima de `PIN_DOT_LIMIT` os pinos viram pontos no mapa.
 */
export const MAX_WAYPOINTS = 3000;

export type AspectId = "16:9" | "9:16" | "1:1" | "4:5";

export const ASPECTS: { id: AspectId; label: string; hint: string; w: number; h: number }[] = [
  { id: "16:9", label: "16:9", hint: "YouTube", w: 1280, h: 720 },
  { id: "9:16", label: "9:16", hint: "Reels / Shorts", w: 720, h: 1280 },
  { id: "1:1", label: "1:1", hint: "Feed", w: 960, h: 960 },
  { id: "4:5", label: "4:5", hint: "Instagram", w: 864, h: 1080 },
];

export type Settings = {
  profile: Profile;
  /** ignora mão única: o traçado não dá voltas para "entrar na mão certa" */
  ignoreOneway: boolean;
  /** encaixa cada ponto clicado na rua mais próxima */
  snapToRoad: boolean;
  /** exibe as paradas do percurso no vídeo */
  showStops: boolean;
  /** mostra o nome de cada parada em uma etiqueta */
  showStopLabels: boolean;
  /** mostra o contador "2/5 paradas" no canto do vídeo */
  showStopCounter: boolean;
  characterId: string;
  accent: string;
  rotate: boolean;
  duration: number;
  cameraMode: CameraMode;
  followZoom: number;
  basemap: BasemapId;
  showRoute: boolean;
  showTraveled: boolean;
  showEndpoints: boolean;
  showTitle: boolean;
  showProgress: boolean;
  /** cartela com o resumo do percurso nos últimos segundos do vídeo */
  endCard: boolean;
  title: string;
  subtitle: string;
  aspect: AspectId;
  fps: number;
  formatId: string;
  bitrateMbps: number;
  /**
   * Exportação rápida com WebCodecs: renderiza o vídeo o mais rápido que a
   * máquina conseguir, em vez de gravar em tempo real. Cai sozinha para o
   * `MediaRecorder` quando o navegador não suporta o formato escolhido.
   */
  fastExport: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  profile: "car",
  ignoreOneway: true,
  snapToRoad: true,
  showStops: true,
  showStopLabels: true,
  showStopCounter: true,
  characterId: "car",
  accent: "#a3e635",
  rotate: false,
  duration: 14,
  cameraMode: "follow",
  followZoom: 16,
  basemap: "dark",
  showRoute: true,
  showTraveled: true,
  showEndpoints: true,
  showTitle: true,
  showProgress: true,
  endCard: true,
  title: "Minha rota",
  subtitle: "",
  aspect: "16:9",
  fps: 30,
  formatId: "",
  bitrateMbps: 10,
  fastExport: true,
};

/**
 * Saneia preferências vindas do localStorage: estilos de mapa antigos
 * (ex.: os da CARTO, que passaram a exigir chave) são descartados.
 */
export function sanitizeSettings(raw: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = { ...raw };
  if (!out.basemap || !(out.basemap in BASEMAPS)) delete out.basemap;
  if (!out.aspect || !ASPECTS.some((a) => a.id === out.aspect)) delete out.aspect;
  if (typeof out.duration !== "number" || out.duration < 3 || out.duration > 60) {
    delete out.duration;
  }
  if (typeof out.followZoom !== "number" || out.followZoom < 3 || out.followZoom > 19) {
    delete out.followZoom;
  }
  if (out.cameraMode !== "fit" && out.cameraMode !== "follow") delete out.cameraMode;
  if (typeof out.ignoreOneway !== "boolean") delete out.ignoreOneway;
  if (typeof out.snapToRoad !== "boolean") delete out.snapToRoad;
  if (typeof out.showStopCounter !== "boolean") delete out.showStopCounter;
  if (typeof out.endCard !== "boolean") delete out.endCard;
  if (typeof out.fastExport !== "boolean") delete out.fastExport;
  const profiles = ["car", "bike", "foot", "straight"];
  if (!out.profile || !profiles.includes(out.profile)) delete out.profile;
  return out;
}

/** zoom máximo útil para o estilo escolhido */
export function maxZoomFor(basemap: BasemapId): number {
  return BASEMAPS[basemap]?.maxZoom ?? 19;
}
