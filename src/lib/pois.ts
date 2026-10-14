/**
 * Paradas do percurso — pontos que aparecem no vídeo quando o personagem
 * passa por eles (ponte, cachoeira, igreja…). Tudo personalizável:
 * nome, emoji, cor e posição.
 *
 * A posição pode ficar FORA da rota (uma cachoeira no meio da mata, um
 * mirante no alto do morro). Nesse caso `pos` guarda a coordenada exata e
 * `t` continua sendo o gatilho: o momento da rota em que o personagem está
 * mais perto daquela parada.
 */

import { haversine, sampleTrack, type LatLng, type Track } from "./geo";

export type PoiKind = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  group: "Natureza" | "Cidade" | "Cultura" | "Serviços" | "Transporte";
};

export const POI_KINDS: PoiKind[] = [
  // Natureza
  { id: "ponte", name: "Ponte", emoji: "🌉", color: "#38bdf8", group: "Natureza" },
  { id: "cachoeira", name: "Cachoeira", emoji: "💦", color: "#22d3ee", group: "Natureza" },
  { id: "mirante", name: "Mirante", emoji: "🏞️", color: "#4ade80", group: "Natureza" },
  { id: "parque", name: "Parque", emoji: "🌳", color: "#84cc16", group: "Natureza" },
  { id: "praia", name: "Praia", emoji: "🏖️", color: "#fbbf24", group: "Natureza" },
  { id: "lago", name: "Lago", emoji: "🛶", color: "#2dd4bf", group: "Natureza" },
  { id: "montanha", name: "Montanha", emoji: "⛰️", color: "#a3a3a3", group: "Natureza" },
  { id: "floresta", name: "Floresta", emoji: "🌲", color: "#16a34a", group: "Natureza" },
  { id: "trilha", name: "Trilha", emoji: "🥾", color: "#d97706", group: "Natureza" },
  { id: "rio", name: "Rio", emoji: "🏊", color: "#0ea5e9", group: "Natureza" },

  // Cidade
  { id: "praca", name: "Praça", emoji: "⛲", color: "#a78bfa", group: "Cidade" },
  { id: "estatua", name: "Estátua", emoji: "🗿", color: "#d6d3d1", group: "Cidade" },
  { id: "portal", name: "Portal", emoji: "🚪", color: "#f472b6", group: "Cidade" },
  { id: "torre", name: "Torre", emoji: "📡", color: "#94a3b8", group: "Cidade" },
  { id: "coreto", name: "Coreto", emoji: "🎪", color: "#fb7185", group: "Cidade" },
  { id: "feira", name: "Feira", emoji: "🎡", color: "#f59e0b", group: "Cidade" },

  // Cultura
  { id: "igreja", name: "Igreja", emoji: "⛪", color: "#facc15", group: "Cultura" },
  { id: "museu", name: "Museu", emoji: "🏛️", color: "#c084fc", group: "Cultura" },
  { id: "castelo", name: "Castelo", emoji: "🏰", color: "#e879f9", group: "Cultura" },
  { id: "teatro", name: "Teatro", emoji: "🎭", color: "#f43f5e", group: "Cultura" },
  { id: "monumento", name: "Monumento", emoji: "🗽", color: "#5eead4", group: "Cultura" },
  { id: "farol", name: "Farol", emoji: "🗼", color: "#fde047", group: "Cultura" },

  // Serviços
  { id: "restaurante", name: "Restaurante", emoji: "🍽️", color: "#fb923c", group: "Serviços" },
  { id: "cafe", name: "Café", emoji: "☕", color: "#d4a373", group: "Serviços" },
  { id: "padaria", name: "Padaria", emoji: "🥖", color: "#f59e0b", group: "Serviços" },
  { id: "mercado", name: "Mercado", emoji: "🛒", color: "#34d399", group: "Serviços" },
  { id: "hotel", name: "Hotel", emoji: "🏨", color: "#818cf8", group: "Serviços" },
  { id: "camping", name: "Camping", emoji: "🏕️", color: "#a3e635", group: "Serviços" },
  { id: "hospital", name: "Hospital", emoji: "🏥", color: "#f87171", group: "Serviços" },
  { id: "escola", name: "Escola", emoji: "🏫", color: "#fca5a5", group: "Serviços" },

  // Transporte
  { id: "estacao", name: "Estação", emoji: "🚉", color: "#60a5fa", group: "Transporte" },
  { id: "aeroporto", name: "Aeroporto", emoji: "✈️", color: "#93c5fd", group: "Transporte" },
  { id: "post", name: "Posto", emoji: "⛽", color: "#fca5a5", group: "Transporte" },
  { id: "pedagio", name: "Pedágio", emoji: "🚧", color: "#fbbf24", group: "Transporte" },
  { id: "tunel", name: "Túnel", emoji: "🚇", color: "#a1a1aa", group: "Transporte" },
  { id: "parada", name: "Ponto", emoji: "🚏", color: "#fdba74", group: "Transporte" },
  { id: "porto", name: "Porto", emoji: "⚓", color: "#67e8f9", group: "Transporte" },
  { id: "destino", name: "Destaque", emoji: "⭐", color: "#fde047", group: "Cidade" },
  { id: "vulcao", name: "Vulcão", emoji: "🌋", color: "#fb923c", group: "Natureza" },
  { id: "deserto", name: "Deserto", emoji: "🏜️", color: "#fbbf24", group: "Natureza" },
  { id: "ilha", name: "Ilha", emoji: "🏝️", color: "#2dd4bf", group: "Natureza" },
  { id: "gruta", name: "Gruta", emoji: "🪨", color: "#a8a29e", group: "Natureza" },
  { id: "jardim", name: "Jardim", emoji: "🌷", color: "#f472b6", group: "Natureza" },
  { id: "reserva", name: "Reserva natural", emoji: "🦋", color: "#60a5fa", group: "Natureza" },
  { id: "zoologico", name: "Zoológico", emoji: "🦁", color: "#fbbf24", group: "Cidade" },
  { id: "aquario", name: "Aquário", emoji: "🐠", color: "#22d3ee", group: "Cidade" },
  { id: "estadio", name: "Estádio", emoji: "🏟️", color: "#4ade80", group: "Cidade" },
  { id: "roda-gigante", name: "Roda-gigante", emoji: "🎡", color: "#f472b6", group: "Cidade" },
  { id: "observatorio", name: "Observatório", emoji: "🔭", color: "#a78bfa", group: "Cultura" },
  { id: "biblioteca", name: "Biblioteca", emoji: "📚", color: "#d4a373", group: "Cultura" },
  { id: "cinema", name: "Cinema", emoji: "🎬", color: "#c084fc", group: "Cultura" },
  { id: "galeria", name: "Galeria de arte", emoji: "🖼️", color: "#fb7185", group: "Cultura" },
  { id: "templo", name: "Templo", emoji: "🛕", color: "#facc15", group: "Cultura" },
  { id: "mesquita", name: "Mesquita", emoji: "🕌", color: "#5eead4", group: "Cultura" },
  { id: "pizzaria", name: "Pizzaria", emoji: "🍕", color: "#fb923c", group: "Serviços" },
  { id: "sorveteria", name: "Sorveteria", emoji: "🍦", color: "#f9a8d4", group: "Serviços" },
  { id: "bar", name: "Bar", emoji: "🍻", color: "#fbbf24", group: "Serviços" },
  { id: "farmacia", name: "Farmácia", emoji: "💊", color: "#f87171", group: "Serviços" },
  { id: "banco", name: "Banco", emoji: "🏦", color: "#94a3b8", group: "Serviços" },
  { id: "compras", name: "Shopping", emoji: "🛍️", color: "#f472b6", group: "Serviços" },
  { id: "banheiro", name: "Banheiro", emoji: "🚻", color: "#60a5fa", group: "Serviços" },
  { id: "agua-potavel", name: "Água potável", emoji: "🚰", color: "#22d3ee", group: "Serviços" },
  { id: "estacionamento", name: "Estacionamento", emoji: "🅿️", color: "#60a5fa", group: "Transporte" },
  { id: "bicicletario", name: "Bicicletário", emoji: "🚲", color: "#4ade80", group: "Transporte" },
  { id: "recarga", name: "Recarga elétrica", emoji: "🔌", color: "#a3e635", group: "Transporte" },
  { id: "balsa", name: "Balsa", emoji: "⛴️", color: "#67e8f9", group: "Transporte" },
  { id: "teleferico", name: "Teleférico", emoji: "🚡", color: "#fbbf24", group: "Transporte" },
];

export const POI_GROUPS: PoiKind["group"][] = [
  "Natureza",
  "Cidade",
  "Cultura",
  "Serviços",
  "Transporte",
];

/** Uma parada colocada no percurso. */
export type Poi = {
  id: string;
  emoji: string;
  label: string;
  color: string;
  /** gatilho: posição na rota (0 = partida, 1 = chegada) em que ela aparece */
  t: number;
  /**
   * Coordenada real. Ausente = colada na rota em `t`.
   * Presente = marcada fora da rota (com precisão de metros).
   */
  pos?: LatLng;
  /**
   * Foto da parada (data URL já reduzida), que aparece no vídeo em uma
   * polaroide quando o personagem passa por ela.
   *
   * Não vai para o link compartilhado: ver `photos.ts`.
   */
  photo?: string;
};

/** Coordenada geográfica efetiva da parada. */
export function poiLatLng(poi: Poi, track: Track): LatLng {
  return poi.pos ?? sampleTrack(track, poi.t).pos;
}

/** Ponto da rota usado como gatilho (de onde sai a linha de chamada). */
export function poiAnchor(poi: Poi, track: Track): LatLng {
  return sampleTrack(track, poi.t).pos;
}

/** Distância, em metros, entre a parada e a rota. 0 = colada na rota. */
export function poiOffset(poi: Poi, track: Track): number {
  if (!poi.pos) return 0;
  return haversine(poi.pos, sampleTrack(track, poi.t).pos);
}

/** Devolve a parada colada de novo sobre a rota. */
export function snapPoiToRoute(poi: Poi): Poi {
  return { ...poi, pos: undefined };
}

/** Uma parada está marcada fora da rota? */
export function isOffRoute(poi: Poi, track: Track): boolean {
  return poiOffset(poi, track) > 12;
}

export function kindById(id: string): PoiKind {
  return POI_KINDS.find((k) => k.id === id) ?? POI_KINDS[0];
}

let seq = 0;

/**
 * Id único de uma parada.
 *
 * Precisa ser gerado **fora** do atualizador de estado do React: em
 * desenvolvimento o `<StrictMode>` executa o updater duas vezes, e um id
 * sorteado lá dentro não seria o mesmo que acabou ficando na lista —
 * a parada recém-criada não apareceria selecionada.
 */
export function nextPoiId(): string {
  seq += 1;
  return `poi-${Date.now().toString(36)}-${seq}`;
}

export function makePoi(
  kindId: string,
  t: number,
  label?: string,
  pos?: LatLng,
  id: string = nextPoiId(),
): Poi {
  const kind = kindById(kindId);
  return {
    id,
    emoji: kind.emoji,
    label: label ?? kind.name,
    color: kind.color,
    t: Math.max(0.01, Math.min(0.99, t)),
    pos,
  };
}

/**
 * Onde colocar a próxima parada: no meio do maior buraco livre,
 * para que as paradas fiquem distribuídas pela rota.
 */
export function nextFreeT(existing: Poi[]): number {
  if (existing.length === 0) return 0.5;
  const sorted = [...existing].map((p) => p.t).sort((a, b) => a - b);
  const marks = [0, ...sorted, 1];
  let bestGap = -1;
  let bestT = 0.5;
  for (let i = 0; i < marks.length - 1; i++) {
    const gap = marks[i + 1] - marks[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestT = (marks[i] + marks[i + 1]) / 2;
    }
  }
  return Math.max(0.01, Math.min(0.99, bestT));
}

export function sortPois(pois: Poi[]): Poi[] {
  return [...pois].sort((a, b) => a.t - b.t);
}
