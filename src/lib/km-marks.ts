/**
 * Marcas de quilômetro ao longo do traçado.
 *
 * O passo acompanha o tamanho da rota: numa volta de 5 km uma marca por km
 * ajuda; numa travessia de 400 km seriam 400 números empilhados. O limite é o
 * número de marcas desenhadas (e não o passo), então a rota sai legível em
 * qualquer tamanho.
 */

export type KmMark = {
  /** índice do ponto do traçado onde a marca cai */
  index: number;
  km: number;
  /** marca grande: múltiplo de 5 passos (o ponto no traçado sai maior) */
  major: boolean;
  /**
   * Leva o número escrito ao lado.
   *
   * Até o passo de 5 km **toda** marca é numerada — sem isso o usuário veria
   * pontos mudos no mapa. Em passos maiores (rota longa) só as redondas levam
   * número, senão as etiquetas cobrem o traçado.
   */
  label: boolean;
};

/** Passos possíveis, em km. */
export const KM_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/** Passo escolhido para um percurso de `totalMeters`, com no máximo `maxMarks`. */
export function kmStep(totalMeters: number, maxMarks = 12): number {
  const totalKm = Math.max(0, totalMeters) / 1000;
  for (const passo of KM_STEPS) if (totalKm / passo <= maxMarks) return passo;
  return Math.max(1, Math.ceil(totalKm / maxMarks));
}

/** Primeiro índice cuja distância acumulada é >= `alvo`. */
function indexAtDistance(cum: number[], alvo: number): number {
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < alvo) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * As marcas de km da rota (sem a partida, que já tem o pino "A").
 *
 * `cum` é a distância acumulada de cada ponto; `step` pode ser forçado nos
 * testes.
 */
export function kmMarks(cum: number[], maxMarks = 12, step?: number): KmMark[] {
  const n = cum.length;
  if (n < 2) return [];
  const total = cum[n - 1];
  if (!(total > 0)) return [];

  const passo = step ?? kmStep(total, maxMarks);
  const aCada = passo * 5;
  const out: KmMark[] = [];
  for (let km = passo; km * 1000 <= total; km += passo) {
    const redonda = km % aCada === 0;
    out.push({
      index: indexAtDistance(cum, km * 1000),
      km,
      major: redonda,
      label: passo <= 5 || redonda,
    });
  }
  return out;
}
