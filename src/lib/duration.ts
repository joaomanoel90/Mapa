/**
 * Leitura do tempo digitado na cartela.
 *
 * O campo "Tempo" da cartela é texto livre, então o HUD precisa entender o que
 * as pessoas escrevem de verdade — `3 h 19 min`, `199 min`, `1h30`, `45 s` — em
 * vez de exigir um formato. O que não der para ler vira `null`, e aí o HUD
 * simplesmente não mostra relógio: melhor nada do que um número errado.
 */

/** Um número com vírgula ou ponto decimal. */
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const paraNumero = (bruto: string) => Number(bruto.replace(",", "."));

/**
 * Duração em segundos, ou `null` quando o texto não é uma duração.
 *
 * Formas aceitas:
 * - `1 h 30 min`, `2h`, `1h30`
 * - `199 min`, `199min`, `199 m` (com espaço)
 * - `45 s`, `45s`, `45 seg`
 * - `1:30` (h:mm) e `1:30:00` (h:mm:ss)
 * - número solto: **minutos** (é o que mais se digita)
 */
export function parseDuration(texto: string): number | null {
  const t = (texto ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;

  // h:mm ou h:mm:ss
  const relogio = t.match(new RegExp(`^(\\d{1,3}):([0-5]?\\d)(?::([0-5]?\\d))?$`));
  if (relogio) {
    const h = Number(relogio[1]);
    const m = Number(relogio[2]);
    const s = relogio[3] === undefined ? 0 : Number(relogio[3]);
    return h * 3600 + m * 60 + s;
  }

  // "1h30", "2h", "3 h 19", "1h 30min"
  const comHora = t.match(new RegExp(`^(${NUM}) ?h(?: ?(${NUM}) ?(min|m|s)?)?$`));
  if (comHora) {
    const h = paraNumero(comHora[1]);
    let resto = 0;
    if (comHora[2] !== undefined) {
      const valor = paraNumero(comHora[2]);
      // "1h30" (sem unidade) é 30 minutos; "1h30s" é 30 segundos
      resto = comHora[3] === "s" ? valor : valor * 60;
    }
    return h * 3600 + resto;
  }

  // "19 min", "19m", "45 s", "45s"
  const comUnidade = t.match(new RegExp(`^(${NUM}) ?(min|m|s|seg|segundos?|minutos?)$`));
  if (comUnidade) {
    const valor = paraNumero(comUnidade[1]);
    const unidade = comUnidade[2];
    return unidade.startsWith("s") ? valor : valor * 60;
  }

  // número solto: minutos
  const solto = t.match(new RegExp(`^(${NUM})$`));
  if (solto) return paraNumero(solto[1]) * 60;

  return null;
}

/** Duração em texto curto, ou o próprio texto quando não é duração. */
export function humanDuration(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${total} s`;
}
