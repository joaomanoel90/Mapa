/**
 * Partida (A) e chegada (B) podem ser locais marcados: com emoji, nome, foto e
 * cor — em vez das letras genéricas "A" e "B".
 * Ex.: 🏠 Casa → 💦 Cachoeira do Salto.
 */

import { isPhotoDataUrl } from "./photos";

export type EndpointMark = {
  emoji: string;
  label: string;
  /**
   * Foto do local (data URL já reduzida), mostrada em círculo na largada e na
   * chegada — no vídeo e no pino do mapa.
   *
   * Como a foto das paradas, ela **não** entra no link compartilhado (ver
   * `share.ts`): são ~70 KB de texto que nenhum mensageiro carrega.
   */
  photo?: string;
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

/**
 * O lado está marcado?
 *
 * Vale emoji, nome **ou** foto: uma partida com só a foto já é um lugar
 * marcado (aparece no vídeo e no pino), e tratá-la como "vazia" faria a foto
 * ser descartada ao recarregar a página.
 */
export function hasMark(m: EndpointMark | null): m is EndpointMark {
  return !!m && (hasText(m) || (m.photo ?? "").length > 0);
}

/** Tem emoji ou nome? (o que o link compartilhado carrega) */
export function hasText(m: EndpointMark | null): boolean {
  return !!m && (m.emoji.trim() !== "" || m.label.trim() !== "");
}

/**
 * Atualiza um lado (emoji, nome ou foto) **sem perder o que não foi tocado**.
 *
 * O editor montava o local do zero a cada digitação (`{ emoji, label }`), e o
 * campo `photo` simplesmente não entrava: escolher a foto e depois escrever o
 * nome — ou tocar num atalho — apagava a foto, inclusive do pino no mapa.
 * Aqui a foto só sai quando é pedida (`photo: undefined`).
 *
 * Devolve `null` quando o local fica vazio (nem emoji, nem nome, nem foto).
 */
export function patchMark(
  atual: EndpointMark | null,
  patch: Partial<EndpointMark>,
): EndpointMark | null {
  const next: EndpointMark = {
    emoji: patch.emoji ?? atual?.emoji ?? "",
    label: patch.label ?? atual?.label ?? "",
  };
  const photo = "photo" in patch ? patch.photo : atual?.photo;
  if (photo) next.photo = photo;
  return hasMark(next) ? next : null;
}

/** Algum dos dois lados (partida ou chegada) está marcado? */
export function hasEndpointMarks(e: Endpoints): boolean {
  return hasMark(e.a) || hasMark(e.b);
}

/** Descarta o que não for foto válida (URL externa, texto, base64 gigante). */
export function sanitizeMark(m: unknown): EndpointMark | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const raw = m as Partial<EndpointMark>;
  const emoji = typeof raw.emoji === "string" ? raw.emoji.slice(0, 8) : "";
  const label = typeof raw.label === "string" ? raw.label.slice(0, 40) : "";
  const photo = isPhotoDataUrl(raw.photo) ? raw.photo : undefined;
  if (!hasText({ emoji, label }) && !photo) return null;
  return { emoji, label, ...(photo ? { photo } : {}) };
}

export function sanitizeEndpoints(v: unknown): Endpoints {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { a: null, b: null };
  const raw = v as Partial<Endpoints>;
  return { a: sanitizeMark(raw.a), b: sanitizeMark(raw.b) };
}

/**
 * Aplica ao estado atual os locais que vieram de um link compartilhado.
 *
 * O link carrega emoji e nome, mas **não** a foto (ela é grande demais para
 * caber numa URL). A regra: se o lugar do link é o mesmo que já está aqui
 * (mesmo emoji e mesmo nome), a foto escolhida **fica**; se é outro lugar, a
 * foto antiga não vale mais (era de outro lugar) e sai. Sem isso, abrir um link
 * apagaria a foto que a pessoa acabou de anexar.
 */
export function mergeSharedEndpoints(current: Endpoints, shared: Endpoints): Endpoints {
  const lado = (atual: EndpointMark | null, doLink: EndpointMark | null): EndpointMark | null => {
    if (!hasMark(doLink)) return atual;
    const mesmoLugar =
      !!atual &&
      atual.emoji.trim() === doLink!.emoji.trim() &&
      atual.label.trim() === doLink!.label.trim();
    const photo = mesmoLugar ? atual!.photo : undefined;
    return { emoji: doLink!.emoji, label: doLink!.label, ...(photo ? { photo } : {}) };
  };
  return { a: lado(current.a, shared.a), b: lado(current.b, shared.b) };
}
