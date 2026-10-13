/**
 * Partida (A) e chegada (B) podem ser locais marcados: com emoji, nome e
 * cor — em vez das letras genéricas "A" e "B".
 * Ex.: 🏠 Casa → 💦 Cachoeira do Salto.
 */

export type EndpointMark = {
  emoji: string;
  label: string;
};

export type Endpoints = {
  a: EndpointMark | null;
  b: EndpointMark | null;
};

export const DEFAULT_ENDPOINTS: Endpoints = { a: null, b: null };

/** Sugestões rápidas para partida/chegada. */
export const ENDPOINT_PRESETS: { emoji: string; label: string }[] = [
  { emoji: "🏠", label: "Casa" },
  { emoji: "🏢", label: "Trabalho" },
  { emoji: "🏫", label: "Escola" },
  { emoji: "⛪", label: "Igreja" },
  { emoji: "💦", label: "Cachoeira" },
  { emoji: "🌉", label: "Ponte" },
  { emoji: "🏞️", label: "Mirante" },
  { emoji: "🏖️", label: "Praia" },
  { emoji: "🏕️", label: "Camping" },
  { emoji: "🏁", label: "Chegada" },
];

export function hasMark(m: EndpointMark | null): m is EndpointMark {
  return !!m && (m.emoji.trim() !== "" || m.label.trim() !== "");
}
