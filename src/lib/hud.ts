/**
 * Números do HUD que aparece no vídeo.
 *
 * O HUD mostra velocidade, distância, relógio e o andamento do percurso. A
 * distância e o andamento saem direto do traçado; a velocidade e o relógio
 * dependem do `<time>` que o Strava e o Garmin gravam em cada ponto.
 *
 * E é aí que mora o cuidado: **sem hora no arquivo não existe velocidade para
 * mostrar**. Cheguei a usar a média do vídeo como reserva e o resultado foi
 * absurdo — uma rota de 12 km num clipe de 14 s dava 3.137 km/h. Velocidade que
 * o arquivo não tem, o HUD não mostra: aparece um traço.
 */

import { haversine, type LatLng } from "./geo";

/** Acima disto é salto do GPS, não pedalada. */
export const MAX_SPEED_KMH = 120;

/** Janela de tempo usada para medir a velocidade instantânea. */
export const SPEED_WINDOW_MS = 20_000;

/**
 * Tempo (em ms) de cada ponto, ou `null` se o arquivo não tiver hora.
 *
 * Com só um ponto com hora não há como medir nada — aí também é `null`, para o
 * HUD não mostrar número sem base.
 */
export function timesOf(pts: LatLng[]): number[] | null {
  const tempos = pts.map((p) => (typeof p.t === "number" && Number.isFinite(p.t) ? p.t : NaN));
  let validos = 0;
  for (const t of tempos) if (Number.isFinite(t)) validos++;
  return validos >= 2 ? tempos : null;
}

/**
 * Relógio do HUD, no formato de relógio de atividade.
 *
 * `mm:ss` do `formatTime` serve para o cronômetro do app, mas no HUD uma
 * pedalada de 3 h 19 min apareceria como **199:00** — minutos e segundos sem
 * dizer que são minutos. Acima de uma hora, vira `h:mm:ss`.
 */
export function formatClock(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const seg = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(seg)}` : `${dois(m)}:${dois(seg)}`;
}

/** Busca binária: primeiro índice cujo valor é >= `alvo`. */
function lowerBound(valores: number[], alvo: number): number {
  let lo = 0;
  let hi = valores.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (valores[mid] < alvo) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Índices dos pontos que têm hora. */
function pontosDatados(tempos: number[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < tempos.length; i++) if (Number.isFinite(tempos[i])) idx.push(i);
  return idx;
}

/**
 * Relógio do percurso em `t` (0..1 do vídeo).
 *
 * O tempo anda sobre a **fração de distância** de cada ponto, e não sobre o
 * índice: assim o relógio acompanha o personagem mesmo com o traçado decimado.
 */
export function elapsedAt(
  pts: LatLng[],
  cum: number[],
  t: number,
  tempos: number[],
): number | null {
  if (pts.length === 0) return null;
  const idx = pontosDatados(tempos);
  if (idx.length < 2) return null;

  const total = cum[cum.length - 1] ?? 0;
  const alvo = Math.max(0, Math.min(1, isFinite(t) ? t : 0)) * total;

  const inicio = tempos[idx[0]];
  const fim = tempos[idx[idx.length - 1]];

  // antes do primeiro ponto com hora (ou depois do último), o relógio espera
  if (alvo <= (cum[idx[0]] ?? 0)) return 0;
  if (alvo >= (cum[idx[idx.length - 1]] ?? total)) return (fim - inicio) / 1000;

  for (let k = 1; k < idx.length; k++) {
    const a = idx[k - 1];
    const b = idx[k];
    if (alvo > cum[b]) continue;
    const trecho = cum[b] - cum[a];
    const f = trecho > 0 ? (alvo - cum[a]) / trecho : 0;
    return (tempos[a] + (tempos[b] - tempos[a]) * f - inicio) / 1000;
  }
  return (fim - inicio) / 1000;
}

/**
 * Velocidade instantânea em `t`, medida numa janela em volta do instante.
 *
 * Dois cuidados, os dois aprendidos medindo:
 *
 * 1. **A janela de tempo** existe porque a leitura do GPS sozinha é barulhenta:
 *    dois pontos vizinhos podem dar picos de 80 km/h numa pedalada de 20.
 * 2. **O deslocamento é em linha reta entre as pontas da janela**, e não a
 *    distância acumulada. Somar o caminho dentro da janela piora o ruído: um
 *    ponto que sai do lugar e volta conta a ida **e** a volta, dobrando o
 *    salto. A linha reta cancela o vaivém (que é o que o erro do GPS faz) e
 *    continua honesta numa estrada normal, porque 20 s é um trecho curto.
 *
 * Devolve `null` quando não dá para medir com honestidade — nunca um número
 * inventado.
 */
export function speedAt(
  pts: LatLng[],
  cum: number[],
  t: number,
  tempos: number[],
): number | null {
  const idx = pontosDatados(tempos);
  if (idx.length < 2) return null;

  const total = cum[cum.length - 1] ?? 0;
  const alvo = Math.max(0, Math.min(1, isFinite(t) ? t : 0)) * total;
  const pos = idx.map((i) => cum[i]);
  const k = lowerBound(pos, alvo);

  // janela de tempo em volta do instante atual
  let a = k;
  let b = k;
  while (a > 0 && tempos[idx[k]] - tempos[idx[a - 1]] <= SPEED_WINDOW_MS / 2) a--;
  while (b + 1 < idx.length && tempos[idx[b + 1]] - tempos[idx[k]] <= SPEED_WINDOW_MS / 2) b++;

  let i = idx[a];
  let j = idx[b];
  // perto das pontas a janela fica de um lado só
  if (i === j) {
    i = idx[Math.max(0, k - 1)];
    j = idx[Math.min(idx.length - 1, k + 1)];
  }

  const dt = (tempos[j] - tempos[i]) / 1000;
  const ds = haversine(pts[i], pts[j]);
  if (!(dt > 0) || !(ds > 0)) return null;

  const kmh = (ds / dt) * 3.6;
  if (!Number.isFinite(kmh) || kmh > MAX_SPEED_KMH) return null;
  return Math.max(0, kmh);
}
