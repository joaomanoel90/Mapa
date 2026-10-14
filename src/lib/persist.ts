/**
 * Guardar e ler as preferências no `localStorage`.
 *
 * Parece trivial até entrar uma foto: o `localStorage` tem uns 5 MB **para o
 * site inteiro**, e uma foto de 640 px ocupa ~70 KB (o data URL em base64 é
 * maior que o arquivo). Se a gravação estourar a cota e o erro for engolido em
 * silêncio — que era o que o app fazia —, o usuário perde **todos** os ajustes
 * sem saber, e a causa (a foto) fica invisível.
 *
 * Aqui a gravação tem plano B e conta o que aconteceu: guarda tudo; não cabendo,
 * guarda tudo menos a foto; não cabendo nem isso, avisa que falhou. A tela usa
 * o resultado para dizer a verdade em vez de fingir que salvou.
 */

import { sanitizeSettings, type Settings } from "./settings";

export type SaveOutcome = "ok" | "sem-foto" | "falhou";

type Gravavel = { setItem(chave: string, valor: string): void };
type Legivel = { getItem(chave: string): string | null };

export const SETTINGS_KEY = "rotacast:settings";

/**
 * Grava as preferências, largando a foto se for ela que não cabe.
 *
 * A foto continua valendo para o vídeo que está na tela: o que se perde é só
 * ela ao recarregar a página.
 */
export function saveSettings(
  storage: Gravavel,
  settings: Settings,
  chave = SETTINGS_KEY,
): SaveOutcome {
  try {
    storage.setItem(chave, JSON.stringify(settings));
    return "ok";
  } catch {
    /* provavelmente cota estourada */
  }
  if (settings.cardPhoto) {
    try {
      storage.setItem(chave, JSON.stringify({ ...settings, cardPhoto: "" }));
      return "sem-foto";
    } catch {
      /* nem sem a foto coube */
    }
  }
  return "falhou";
}

/**
 * Lê as preferências guardadas (JSON em texto), já saneadas.
 *
 * Texto corrompido devolve `{}`: preferências quebradas não podem impedir o app
 * de abrir.
 */
export function decodeSettings(texto: string | null): Partial<Settings> {
  if (!texto) return {};
  try {
    const bruto = JSON.parse(texto) as unknown;
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
    return sanitizeSettings(bruto as Partial<Settings>);
  } catch {
    return {};
  }
}

/** Atalho: lê direto do armazenamento. */
export function loadSettings(storage: Legivel, chave = SETTINGS_KEY): Partial<Settings> {
  try {
    return decodeSettings(storage.getItem(chave));
  } catch {
    return {};
  }
}
