/**
 * Cor da linha ao longo do traçado: por velocidade ou por inclinação.
 *
 * A ideia é ver **onde a subida doeu**: a mesma rota pintada de azul (descida)
 * a vermelho (parede) diz mais do que qualquer número no fim.
 *
 * Três cuidados que vieram de medir, não de teoria:
 *
 * 1. **O traçado não é repintado ponto a ponto.** Doze mil segmentos seriam
 *    doze mil `stroke()` por quadro, e o vídeo é desenhado 30 vezes por
 *    segundo. A linha é desenhada em **oito passadas** — uma por faixa de cor —
 *    e cada passada é um único `stroke()`. Oito traços no lugar de doze mil.
 * 2. **A altitude do GPS é barulhenta.** Um degrau de 4 m entre dois pontos
 *    distantes 10 m é 40% de rampa que não existe. Por isso a altitude passa
 *    por uma média móvel (por distância, não por índice) antes de virar
 *    inclinação — e a rampa é medida numa janela de 200 m, não entre pontos
 *    vizinhos.
 * 3. **Sem o dado, sem a cor.** Arquivo sem `<ele>` não tem inclinação; sem
 *    `<time>` não tem velocidade. Nesses pontos a linha sai na cor neutra em
 *    vez de inventar uma faixa.
 */

import { type LatLng } from "./geo";
import { speedAt } from "./hud";

export type ColorMode = "solid" | "speed" | "slope";

/** Quantas faixas de cor a linha usa (o nome "oito passadas" depende disso). */
export const COLOR_BANDS = 8;

/**
 * Inclinação: descida (frio) → plano (verde-limão, a cor do app) → subida
 * (quente). O centro da escala é a **cor neutra**, então um percurso plano
 * aparece plano, e não "meio quente".
 */
export const SLOPE_COLORS = [
  "#1d4ed8",
  "#2563eb",
  "#38bdf8",
  "#22d3ee",
  "#a3e635",
  "#fde047",
  "#fb923c",
  "#dc2626",
];

/**
 * Velocidade: devagar (quente) → rápido (frio), como no trânsito. Vermelho
 * onde o carro engasga, azul onde a estrada abre.
 */
export const SPEED_COLORS = [
  "#dc2626",
  "#f97316",
  "#fb923c",
  "#fde047",
  "#a3e635",
  "#22d3ee",
  "#38bdf8",
  "#2563eb",
];

/** Cor da linha onde o arquivo não tem o dado pedido. */
export const NEUTRAL_COLOR = "#94a3b8";

export type ColoredRoute = {
  mode: "speed" | "slope";
  /** faixa (0..7) de cada ponto; `NaN` onde não há dado */
  bands: number[];
  /** valor medido em cada ponto (km/h ou %) — `NaN` onde não há dado */
  values: number[];
  /** quantos pontos têm dado */
  measured: number;
  unit: "km/h" | "%";
  /** título da legenda */
  title: string;
  /** extremos da escala, já formatados para a legenda */
  lowLabel: string;
  highLabel: string;
  /** cores das faixas, na ordem (0 = extremo frio) */
  colors: string[];
};

/* ------------------------------------------------------------------ */
/* Frações do arquivo que têm cada dado                                */
/* ------------------------------------------------------------------ */

/**
 * Quanto do arquivo tem altitude e quanto tem hora (0..1).
 *
 * É o que permite avisar na tela em vez de o usuário escolher "inclinação" e
 * ver uma linha cinza sem entender por quê.
 */
export function dataCoverage(pts: LatLng[]): { ele: number; time: number } {
  let ele = 0;
  let time = 0;
  for (const p of pts) {
    if (typeof p.ele === "number" && Number.isFinite(p.ele)) ele++;
    if (typeof p.t === "number" && Number.isFinite(p.t)) time++;
  }
  const n = Math.max(1, pts.length);
  return { ele: ele / n, time: time / n };
}

/* ------------------------------------------------------------------ */
/* Médias móveis por distância                                         */
/* ------------------------------------------------------------------ */

/**
 * Média móvel de uma série, numa janela medida em **metros** em cada lado.
 *
 * A janela é em distância, e não em número de pontos, porque o arquivo de GPS
 * não é regular: numa curva fechada chegam dez pontos em vinte metros.
 * Pontos sem valor não entram na média (mas recebem a média dos vizinhos).
 */
function averageByDistance(values: number[], cum: number[], radiusM: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  let soma = 0;
  let cont = 0;
  let ini = 0;
  let fim = -1;
  for (let i = 0; i < n; i++) {
    while (fim + 1 < n && cum[fim + 1] - cum[i] <= radiusM) {
      fim++;
      if (Number.isFinite(values[fim])) {
        soma += values[fim];
        cont++;
      }
    }
    while (ini < i && cum[i] - cum[ini] > radiusM) {
      if (Number.isFinite(values[ini])) {
        soma -= values[ini];
        cont--;
      }
      ini++;
    }
    if (cont > 0) out[i] = soma / cont;
  }
  return out;
}

/** Meia-janela da suavização da altitude. Ver o aviso 2 no topo do arquivo. */
export const ELE_SMOOTH_M = 40;

/** Meia-janela em que a rampa é medida (200 m no total). */
export const SLOPE_WINDOW_M = 100;

/**
 * Rampa em cada ponto, em % (positiva = subida).
 *
 * A altitude entra suavizada e a rampa sai de dois pontos afastados 200 m —
 * uma subida de verdade, não o degrau entre dois pontos vizinhos.
 *
 * Exportada porque **o número do HUD tem de ser o mesmo da cor da linha**: numa
 * rota sem hora, o anel mostra a inclinação do trecho, e ela é lida desta mesma
 * série — se fossem duas contas, o anel diria "+6%" numa linha verde.
 */
export function slopeSeries(pts: LatLng[], cum: number[]): number[] {
  const ele = pts.map((p) => (typeof p.ele === "number" && Number.isFinite(p.ele) ? p.ele : NaN));
  const suave = averageByDistance(ele, cum, ELE_SMOOTH_M);
  const n = suave.length;
  const out = new Array<number>(n).fill(NaN);
  let tras = 0;
  let frente = 0;
  for (let i = 0; i < n; i++) {
    if (frente < i) frente = i;
    while (frente + 1 < n && cum[frente + 1] - cum[i] <= SLOPE_WINDOW_M) frente++;
    while (tras < i && cum[i] - cum[tras] > SLOPE_WINDOW_M) tras++;
    const d = cum[frente] - cum[tras];
    const a = suave[tras];
    const b = suave[frente];
    if (d >= 40 && Number.isFinite(a) && Number.isFinite(b)) out[i] = ((b - a) / d) * 100;
  }
  return out;
}

/**
 * A rampa (%) no progresso `t` (0..1) do traçado.
 *
 * Lê a **mesma** série que pinta a linha (`slopeSeries`), pelo mesmo índice de
 * distância que o personagem usa. Devolve `null` onde não há elevação — o HUD
 * então mostra outra coisa em vez de um número sem base.
 */
export function slopeAt(series: number[], cum: number[], t: number): number | null {
  const n = Math.min(series.length, cum.length);
  if (n < 2) return null;
  const total = cum[n - 1];
  if (!(total > 0)) return null;
  const alvo = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * total;
  // busca binária: primeiro índice cuja distância acumulada alcança o alvo
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < alvo) lo = mid + 1;
    else hi = mid;
  }
  const v = series[lo];
  return Number.isFinite(v) ? v : null;
}

/**
 * Cortes fixos da inclinação, em %.
 *
 * Fixos (e não adaptados ao percurso) porque a escala precisa significar a
 * mesma coisa em toda rota: ±1% é plano em qualquer lugar do mundo, e o miolo
 * da escala fica na cor neutra.
 */
export const SLOPE_BREAKS = [-6, -4, -2, -1, 1, 2, 4, 6];

/** Faixa de uma inclinação, pelos cortes fixos. */
export function slopeBand(percent: number): number {
  let b = 0;
  for (const corte of SLOPE_BREAKS) if (percent >= corte) b++;
  return Math.min(COLOR_BANDS - 1, b);
}

/** Quartil de uma série já ordenada (interpolação linear). */
function quantile(ordenado: number[], q: number): number {
  if (ordenado.length === 0) return NaN;
  if (ordenado.length === 1) return ordenado[0];
  const pos = (ordenado.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return ordenado[lo];
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (pos - lo);
}

/**
 * Faixa de uma velocidade.
 *
 * Aqui os cortes são **do percurso** (percentis 5 e 95 das velocidades
 * medidas), e não fixos: 30 km/h é rápido de bicicleta e devagar de carro. Com
 * escala fixa, uma pedalada sairia inteira azul e uma estrada inteira
 * vermelha. Os extremos são os das faixas, e é isso que a legenda mostra.
 */
export function speedBands(values: number[]): {
  bands: number[];
  low: number;
  high: number;
  breaks: number[];
} {
  const validos = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  let low = quantile(validos, 0.05);
  let high = quantile(validos, 0.95);
  if (!(high - low > 2)) {
    // percurso quase parado: abre uma faixa mínima em volta da média para a
    // escala não virar um borrão de cores aleatórias
    const meio = (low + high) / 2;
    low = meio - 1.5;
    high = meio + 1.5;
  }
  const breaks: number[] = [];
  for (let i = 1; i < COLOR_BANDS; i++) breaks.push(low + ((high - low) * i) / COLOR_BANDS);
  const bands = values.map((v) => {
    if (!Number.isFinite(v)) return NaN;
    let b = 0;
    for (const corte of breaks) if (v >= corte) b++;
    return Math.min(COLOR_BANDS - 1, b);
  });
  return { bands, low, high, breaks };
}

/* ------------------------------------------------------------------ */
/* Entrada principal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Monta a linha colorida — ou `null` quando não há como colorir.
 *
 * Devolver `null` é parte do contrato: quem chama desenha a rota sólida de
 * sempre, e a tela avisa o que falta no arquivo.
 */
export function colorizeRoute(input: {
  pts: LatLng[];
  cum: number[];
  times: number[] | null;
  mode: ColorMode;
}): ColoredRoute | null {
  const { pts, cum, times, mode } = input;
  if (mode === "solid" || pts.length < 2 || cum.length !== pts.length) return null;

  if (mode === "slope") {
    const values = slopeSeries(pts, cum);
    const measured = values.reduce((n, v) => n + (Number.isFinite(v) ? 1 : 0), 0);
    if (measured < 2) return null;
    const bands = values.map((v) => (Number.isFinite(v) ? slopeBand(v) : NaN));
    return {
      mode,
      bands,
      values,
      measured,
      unit: "%",
      title: "inclinação",
      lowLabel: `${SLOPE_BREAKS[0]}%`,
      highLabel: `+${SLOPE_BREAKS[SLOPE_BREAKS.length - 1]}%`,
      colors: SLOPE_COLORS,
    };
  }

  if (!times) return null;
  const total = cum[cum.length - 1] || 1;
  const values = pts.map((_, i) =>
    Number.isFinite(times[i]) ? (speedAt(pts, cum, cum[i] / total, times) ?? NaN) : NaN,
  );
  const measured = values.reduce((n, v) => n + (Number.isFinite(v) ? 1 : 0), 0);
  if (measured < 2) return null;
  const { bands, low, high } = speedBands(values);
  return {
    mode,
    bands,
    values,
    measured,
    unit: "km/h",
    title: "velocidade",
    lowLabel: `${Math.round(low)}`,
    highLabel: `${Math.round(high)}`,
    colors: SPEED_COLORS,
  };
}
