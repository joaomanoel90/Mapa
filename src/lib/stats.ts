/**
 * Resumo de um percurso gravado — o que aparece na cartela do fim do vídeo.
 *
 * Os dois dados que interessam vêm do próprio arquivo: altitude (`<ele>`) e
 * hora (`<time>`). Rota desenhada à mão não tem nenhum dos dois, e aí o resumo
 * simplesmente encolhe — a cartela nunca mostra um número inventado.
 */

import { formatDistance, type LatLng } from "./geo";

/**
 * Variação mínima (em metros) para contar como subida ou descida.
 *
 * O altímetro erra a cada leitura, e somar tudo cru faz uma pedalada plana
 * "ganhar" centenas de metros. O corte é pelo **balanço** do erro, não pelo
 * erro: uma oscilação de ±1,5 m anda 3 m de uma leitura para a outra, então o
 * limiar precisa ficar acima disso. Com 4 m, o vaivém de ±1,5 m (o comum em
 * aparelho com barômetro) fica de fora, e a subida real entra.
 *
 * A referência só anda quando a variação passa do limiar, o que mantém o erro
 * do total **abaixo do próprio limiar** — em vez de acumular o erro das pontas
 * como faria um suavizado.
 */
export const ELE_NOISE_M = 4;

export type ElevationSummary = {
  /** subida acumulada (D+), em metros */
  gain: number;
  /** descida acumulada (D−), em metros */
  loss: number;
  min: number;
  max: number;
};

export type TimeSummary = {
  /** epoch em ms do primeiro ponto com hora */
  start: number;
  end: number;
  durationMs: number;
};

export type RideSummary = {
  distanceM: number;
  /** null quando o arquivo não tem altitude */
  elevation: ElevationSummary | null;
  /** null quando o arquivo não tem hora */
  time: TimeSummary | null;
  /** pontos do traçado */
  points: number;
};

/** Subida e descida acumuladas, ignorando o ruído do GPS. */
export function elevationSummary(
  pts: LatLng[],
  threshold = ELE_NOISE_M,
): ElevationSummary | null {
  let ref: number | null = null;
  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const p of pts) {
    const e = p.ele;
    if (typeof e !== "number" || !Number.isFinite(e)) continue;
    if (e < min) min = e;
    if (e > max) max = e;
    if (ref === null) {
      ref = e;
      continue;
    }
    const d = e - ref;
    if (d >= threshold) {
      gain += d;
      ref = e;
    } else if (d <= -threshold) {
      loss += -d;
      ref = e;
    }
  }

  if (ref === null || !Number.isFinite(min)) return null;
  return { gain, loss, min, max };
}

/** Início, fim e duração, a partir das horas gravadas nos pontos. */
export function timeSummary(pts: LatLng[]): TimeSummary | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const p of pts) {
    if (typeof p.t !== "number" || !Number.isFinite(p.t)) continue;
    if (start === null || p.t < start) start = p.t;
    if (end === null || p.t > end) end = p.t;
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end, durationMs: end - start };
}

/** Junta tudo o que a cartela mostra. */
export function rideSummary(pts: LatLng[], distanceM: number): RideSummary {
  return {
    distanceM,
    elevation: elevationSummary(pts),
    time: timeSummary(pts),
    points: pts.length,
  };
}

export type SummaryTile = { value: string; label: string };

const metros = (m: number) => `${Math.round(m).toLocaleString("pt-BR")} m`;

/**
 * Duração em texto curto: "2 h 14 min", "48 min", "35 s".
 *
 * `formatTime` do geo devolve relógio (`02:14`), que serve para o cronômetro,
 * mas "02:14" não diz se são horas ou minutos numa cartela.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const seg = total % 60;
  if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`;
  if (min > 0) return `${min} min`;
  return `${seg} s`;
}

/**
 * Os números da cartela, já formatados — sem os que o arquivo não tem.
 *
 * A distância vem primeiro porque é o único dado que existe sempre; elevação e
 * tempo só entram quando o arquivo traz.
 */
export function summaryTiles(s: RideSummary): SummaryTile[] {
  const tiras: SummaryTile[] = [
    { value: formatDistance(s.distanceM), label: "distância" },
  ];
  if (s.elevation && s.elevation.gain >= 1) {
    tiras.push({ value: `+${metros(s.elevation.gain)}`, label: "elevação" });
  }
  if (s.time) {
    tiras.push({ value: formatDuration(s.time.durationMs), label: "tempo" });
  }
  return tiras;
}

/** Quanto cabe em cada campo da cartela (o vídeo corta, mas o link agradece). */
export const MAX_CARD_TEXT = 40;

/** Os campos digitados no painel. */
export type CardFields = {
  cardDistance: string;
  cardElevation: string;
  cardTime: string;
  cardNote: string;
};

/** O que a cartela mostra: as tiras de número e a linha de baixo. */
export type EndCard = {
  tiles: SummaryTile[];
  note: string | null;
  /** o que o arquivo diz, para o painel usar como dica e no botão de copiar */
  sugestao: { distance: string; elevation: string | null; time: string | null; date: string | null };
};

/** Texto de um campo: sem espaços sobrando, quebrado em uma linha só e com teto. */
function campo(v: string): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CARD_TEXT);
}

/**
 * Monta a cartela final.
 *
 * Os números vêm **do que foi digitado**; o arquivo só sugere. Isso deixa a
 * cartela servir para uma rota desenhada à mão (que não tem altitude nem hora)
 * e para quem quer escrever o número que o Strava mostrou, sem digitar no
 * escuro: o painel mostra a sugestão ao lado de cada campo.
 *
 * Com `preencherComArquivo`, o campo **em branco** passa a mostrar o que o
 * arquivo mediu. Era o pedido do usuário ("adicione a cartela no final do
 * vídeo"): o interruptor da cartela já vinha ligado, mas ela só existia se
 * alguém digitasse alguma coisa — e o vídeo terminava sem cartela nenhuma. Com
 * o preenchimento, ligar o interruptor basta, e quem quiser outro número é só
 * escrever por cima.
 *
 * `null` quando não há nada para mostrar, e aí o vídeo termina sem cartela.
 */
export function endCard(
  f: CardFields,
  file: RideSummary,
  preencherComArquivo = false,
): EndCard | null {
  const sugestao = cardSuggestions(file);

  /** o que foi digitado manda; em branco, entra o arquivo (se pedido) */
  const numero = (digitado: string, doArquivo: string | null): string => {
    const escrito = campo(digitado);
    if (escrito) return escrito;
    return preencherComArquivo ? campo(doArquivo ?? "") : "";
  };

  const tiles: SummaryTile[] = [];
  const dist = numero(f.cardDistance, sugestao.distance);
  if (dist) tiles.push({ value: dist, label: "distância" });
  const ele = numero(f.cardElevation, sugestao.elevation);
  if (ele) tiles.push({ value: ele, label: "elevação" });
  const tempo = numero(f.cardTime, sugestao.time);
  if (tempo) tiles.push({ value: tempo, label: "tempo" });

  const nota = campo(f.cardNote);
  // A cartela existe porque alguém escreveu algo. A data do arquivo só
  // **enfeita** uma cartela que já existe — se ela sozinha criasse a cartela,
  // quem não digitou nada ganharia um retângulo com uma data no fim do vídeo.
  if (tiles.length === 0 && !nota) return null;

  return { tiles, note: nota || sugestao.date || null, sugestao };
}

/**
 * O que o arquivo diz, para o painel mostrar ao lado de cada campo.
 *
 * Separado de `endCard` porque o painel precisa das sugestões mesmo quando a
 * cartela está vazia (é ali que o botão "usar os números do arquivo" aparece).
 */
export function cardSuggestions(file: RideSummary): EndCard["sugestao"] {
  const dados = summaryTiles(file);
  return {
    distance: dados[0]?.value ?? "",
    elevation: dados.find((t) => t.label === "elevação")?.value ?? null,
    time: dados.find((t) => t.label === "tempo")?.value ?? null,
    date: summaryDate(file),
  };
}

/** Data do percurso, escrita por extenso ("13 de outubro de 2026"). */
export function summaryDate(s: RideSummary): string | null {
  if (!s.time) return null;
  return new Date(s.time.start).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
