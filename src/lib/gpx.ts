/**
 * Importação e exportação de GPX.
 *
 * O GPX é o formato que Strava, Garmin, Komoot e afins usam para traçados, então
 * ele é a ponte natural entre o app e o resto do mundo: importar uma trilha já
 * gravada (sem redesenhar à mão) e exportar a rota para abrir em outro lugar.
 *
 * O XML que chega é **entrada não confiável**: `parseGpx` recusa DTD, limita o
 * número de pontos e valida cada coordenada antes de aceitá-la.
 */

import { haversine, type LatLng } from "./geo";
import { POI_KINDS } from "./pois";

/** Teto de pontos aceitos na importação (traçados reais raramente passam disso). */
export const MAX_GPX_POINTS = 100_000;

/** Termo de comparação seguro para latitude/longitude. */
function validCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Busca elementos pelo nome, cobrindo os dois formatos de GPX que aparecem.
 *
 * O caso real (Strava, Garmin, Komoot) é o GPX 1.1 com namespace **padrão**
 * (`xmlns="…"`), onde a tag continua sendo `<trkpt>` — e o seletor estático
 * encontra. Arquivos sem namespace também.
 *
 * A ordem importa: `querySelectorAll` devolve coleção **estática**, enquanto
 * percorrer uma coleção **viva** de `getElementsByTagNameNS` é O(n²) — medido:
 * 20 mil pontos levavam 22 s contra 33 ms. Por isso o caminho lento só é usado
 * quando o rápido não achou nada, que é o caso de arquivos com prefixo
 * (`<g:trkpt>`) — raro e, nesses, o custo ainda é aceitável.
 */
function byLocalName(root: Document | Element, name: string): Element[] {
  const estatico = root.querySelectorAll(name);
  if (estatico.length > 0) return Array.from(estatico);
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function firstText(root: Document | Element, name: string): string | undefined {
  const el = byLocalName(root, name)[0];
  const texto = el?.textContent?.trim();
  return texto ? texto : undefined;
}

/**
 * Nome do arquivo, procurando no lugar certo.
 *
 * Ler `firstText(doc, "metadata")` devolveria o conteúdo **inteiro** do
 * `<metadata>` — nome, descrição e hora colados. O nome está é dentro dele.
 */
function documentName(doc: Document): string | undefined {
  for (const container of ["metadata", "trk", "rte"]) {
    const el = byLocalName(doc, container)[0];
    if (!el) continue;
    const nome = firstText(el, "name");
    if (nome) return nome;
  }
  return undefined;
}

function readPoint(el: Element): LatLng | null {
  const latBruto = el.getAttribute("lat");
  const lngBruto = el.getAttribute("lon");
  // `getAttribute` devolve null quando o atributo falta, e `Number(null)` é 0 —
  // que passaria como coordenada válida e jogaria o ponto para o equador.
  // Atributo vazio tem o mesmo problema (`Number("")` também é 0).
  if (!latBruto?.trim() || !lngBruto?.trim()) return null;
  const lat = Number(latBruto);
  const lng = Number(lngBruto);
  return validCoord(lat, lng) ? { lat, lng } : null;
}

export type GpxWaypoint = {
  lat: number;
  lng: number;
  name?: string;
  /** símbolo/pictograma, quando o arquivo traz */
  sym?: string;
};

export type GpxParseResult = {
  /** traçado completo, na ordem do arquivo */
  points: LatLng[];
  /** pontos soltos (`<wpt>`) — no app viram paradas do percurso */
  waypoints: GpxWaypoint[];
  name?: string;
  /** quantos `<trkseg>` havia: mais de um significa que o traçado tem cortes */
  segments: number;
  /** o arquivo tinha mais pontos do que o teto e passou por amostragem */
  reduced: boolean;
};

/** Erro com mensagem pronta para mostrar ao usuário. */
export class GpxError extends Error {}

export function parseGpx(xml: string): GpxParseResult {
  const texto = xml.trim();
  if (!texto) throw new GpxError("O arquivo está vazio.");

  // DTD é o vetor clássico de expansão de entidades ("billion laughs").
  // Este app não precisa de DTD nenhum, então recusar é o caminho mais simples.
  if (/<!DOCTYPE/i.test(texto)) {
    throw new GpxError("Este GPX usa DTD, que não é aceito por segurança.");
  }

  if (typeof DOMParser === "undefined") {
    throw new GpxError("Este navegador não consegue ler GPX.");
  }

  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (byLocalName(doc, "parsererror").length > 0) {
    throw new GpxError("O arquivo não é um XML válido.");
  }
  const raiz = doc.documentElement;
  if (!raiz || raiz.localName?.toLowerCase() !== "gpx") {
    throw new GpxError("O arquivo não parece ser um GPX.");
  }

  /* -------- traçado -------- */
  let points: LatLng[] = [];
  const segmentos = byLocalName(doc, "trkseg");
  let segments = 0;

  if (segmentos.length > 0) {
    segments = segmentos.length;
    for (const seg of segmentos) {
      for (const el of byLocalName(seg, "trkpt")) {
        const p = readPoint(el);
        if (p) points.push(p);
      }
    }
  }
  // sem <trkseg>, tenta pontos de traçado soltos e depois pontos de rota
  if (points.length === 0) {
    points = byLocalName(doc, "trkpt")
      .map(readPoint)
      .filter((p): p is LatLng => p !== null);
  }
  if (points.length === 0) {
    points = byLocalName(doc, "rtept")
      .map(readPoint)
      .filter((p): p is LatLng => p !== null);
  }

  const reduced = points.length > MAX_GPX_POINTS;
  const finalPoints = reduced ? decimate(points, MAX_GPX_POINTS) : points;

  /* -------- pontos soltos -------- */
  const waypoints: GpxWaypoint[] = [];
  for (const el of byLocalName(doc, "wpt")) {
    const p = readPoint(el);
    if (!p) continue;
    waypoints.push({
      ...p,
      name: firstText(el, "name"),
      sym: firstText(el, "sym"),
    });
  }

  if (points.length === 0 && waypoints.length === 0) {
    throw new GpxError("O GPX não tem nenhum ponto de traçado.");
  }

  const name = documentName(doc);

  return { points: finalPoints, waypoints, name, segments, reduced };
}

/**
 * Reduz uma lista mantendo a cobertura do percurso inteiro.
 *
 * Nada de `slice`: cortar pelos primeiros N pontos faria a rota **terminar
 * antes do fim**, em silêncio. A amostragem uniforme preserva o traçado todo,
 * só com menos resolução — e mantém o primeiro e o último ponto.
 */
export function decimate(points: LatLng[], maxPoints: number): LatLng[] {
  if (points.length <= maxPoints) return [...points];
  if (maxPoints < 2) return [points[0]];

  const out: LatLng[] = [];
  const passo = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints - 1; i++) {
    out.push(points[Math.floor(i * passo)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Simplificação (Douglas–Peucker)                                    */
/* ------------------------------------------------------------------ */

/**
 * Distância, em metros, do ponto `p` ao segmento `a`–`b`.
 * Projeção local: suficiente para trechos de poucos quilômetros e muito mais
 * barata que calcular geodésicas.
 */
function perpendicularMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) || 1e-6;
  const bx = (b.lng - a.lng) * mLng;
  const by = (b.lat - a.lat) * mLat;
  const px = (p.lng - a.lng) * mLng;
  const py = (p.lat - a.lat) * mLat;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Reduz a lista mantendo os pontos que definem a forma (tolerância em metros). */
function douglasPeucker(points: LatLng[], epsilonM: number): LatLng[] {
  if (points.length <= 2) return [...points];

  // pilha em vez de recursão: um traçado de 100 mil pontos chegaria fundo demais
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [ini, fim] = stack.pop()!;
    let maior = -1;
    let idx = -1;
    for (let i = ini + 1; i < fim; i++) {
      const d = perpendicularMeters(points[i], points[ini], points[fim]);
      if (d > maior) {
        maior = d;
        idx = i;
      }
    }
    if (idx > 0 && maior > epsilonM) {
      keep[idx] = 1;
      stack.push([ini, idx], [idx, fim]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Reduz um traçado para caber em `maxPoints` sem perder a forma.
 *
 * Um track gravado tem milhares de pontos; o app aceita 60 waypoints. Cortar de
 * forma uniforme achataria as curvas — aqui a tolerância é ajustada por busca
 * binária até o resultado caber.
 */
export function simplifyTo(points: LatLng[], maxPoints: number): LatLng[] {
  if (points.length <= maxPoints) return [...points];
  if (maxPoints < 2) return [points[0]];

  // teto inicial generoso: a diagonal da caixa que envolve o traçado
  let norte = -90;
  let sul = 90;
  let leste = -180;
  let oeste = 180;
  for (const p of points) {
    norte = Math.max(norte, p.lat);
    sul = Math.min(sul, p.lat);
    leste = Math.max(leste, p.lng);
    oeste = Math.min(oeste, p.lng);
  }
  let alto = haversine({ lat: norte, lng: oeste }, { lat: sul, lng: leste }) || 1000;

  // garante que o teto já seja suficiente
  for (let i = 0; i < 8 && douglasPeucker(points, alto).length > maxPoints; i++) {
    alto *= 2;
  }

  let baixo = 0;
  let melhor = douglasPeucker(points, alto);
  for (let i = 0; i < 42; i++) {
    const meio = (baixo + alto) / 2;
    const r = douglasPeucker(points, meio);
    if (r.length > maxPoints) {
      baixo = meio;
    } else {
      melhor = r;
      alto = meio;
    }
  }

  // rede de segurança: amostragem uniforme se a tolerância não bastar
  if (melhor.length > maxPoints) {
    const passo = Math.ceil(melhor.length / maxPoints);
    const reduzido = melhor.filter((_, i) => i % passo === 0);
    const ultimo = melhor[melhor.length - 1];
    if (reduzido[reduzido.length - 1] !== ultimo) reduzido.push(ultimo);
    return reduzido;
  }
  return melhor;
}

/* ------------------------------------------------------------------ */
/* Exportação                                                          */
/* ------------------------------------------------------------------ */

export type GpxExportData = {
  /** traçado a exportar */
  points: LatLng[];
  /** paradas que viram `<wpt>` */
  waypoints?: { lat: number; lng: number; name?: string; sym?: string }[];
  name?: string;
  desc?: string;
};

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Datas em ISO 8601 com milissegundos, como o schema do GPX 1.1 pede. */
const isoNow = () => new Date().toISOString();

/** Coordenada com 6 casas: ~11 cm, mais preciso do que o GPX normalmente traz. */
const coord = (n: number) => n.toFixed(6);

export function toGpx(data: GpxExportData, criadoEm = isoNow()): string {
  const nome = data.name?.trim() || "Rota";

  const linhas: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RotaCast" xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    "  <metadata>",
    `    <name>${escapeXml(nome)}</name>`,
  ];
  if (data.desc?.trim()) {
    linhas.push(`    <desc>${escapeXml(data.desc.trim())}</desc>`);
  }
  linhas.push(`    <time>${criadoEm}</time>`, "  </metadata>");

  for (const w of data.waypoints ?? []) {
    linhas.push(`  <wpt lat="${coord(w.lat)}" lon="${coord(w.lng)}">`);
    if (w.name?.trim()) linhas.push(`    <name>${escapeXml(w.name.trim())}</name>`);
    if (w.sym?.trim()) linhas.push(`    <sym>${escapeXml(w.sym.trim())}</sym>`);
    linhas.push("  </wpt>");
  }

  linhas.push("  <trk>", `    <name>${escapeXml(nome)}</name>`, "    <trkseg>");
  for (const p of data.points) {
    linhas.push(`      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lng)}" />`);
  }
  linhas.push("    </trkseg>", "  </trk>", "</gpx>", "");

  return linhas.join("\n");
}

/* ------------------------------------------------------------------ */
/* Tipos de parada                                                     */
/* ------------------------------------------------------------------ */

/**
 * Palavras que aparecem no `<sym>` (padrão Garmin) ou no próprio nome do
 * ponto solto, associadas a um tipo de parada do app.
 *
 * A busca é por trecho, sem diferenciar maiúsculas: "Waterfall" pega
 * "water", "Cachoeira do Salto" pega "cachoeira".
 */
const SYM_PARA_TIPO: [RegExp, string][] = [
  [/igreja|church|chapel|cathedral|capela/i, "igreja"],
  [/cachoeira|waterfall|water/i, "cachoeira"],
  [/mirante|summit|peak|viewpoint|scenic/i, "mirante"],
  [/parque|park|picnic|garden|jardim/i, "parque"],
  [/praia|beach/i, "praia"],
  [/camping|campsite|campground|acampamento/i, "camping"],
  [/posto|fuel|gas|gasoline/i, "post"],
  [/restaurante|restaurant|food/i, "restaurante"],
  [/caf[eé]|coffee/i, "cafe"],
  [/padaria|bakery/i, "padaria"],
  [/hotel|hostel|pousada|lodging/i, "hotel"],
  [/mercado|supermarket|grocery|shopping/i, "mercado"],
  [/hospital|clinic|sa[úu]de/i, "hospital"],
  [/escola|school|university/i, "escola"],
  [/esta[çc][ãa]o|station|bus|train|metro/i, "estacao"],
  [/aeroporto|airport/i, "aeroporto"],
  [/ponte|bridge/i, "ponte"],
  [/museu|museum/i, "museu"],
  [/castelo|castle|fort/i, "castelo"],
  [/teatro|theater|theatre/i, "teatro"],
  [/monumento|monument|memorial/i, "monumento"],
  [/farol|lighthouse/i, "farol"],
  [/trilha|trail|hiking/i, "trilha"],
  [/floresta|forest|woods/i, "floresta"],
  [/montanha|mountain/i, "montanha"],
  [/lago|lake|lagoon|lagoa/i, "lago"],
  [/rio|river/i, "rio"],
  [/estacionamento|parking/i, "estacionamento"],
  [/biciclet[áa]rio|bicycle|bike/i, "bicicletario"],
  [/farm[áa]cia|pharmacy/i, "farmacia"],
  [/banheiro|restroom|toilet/i, "banheiro"],
  [/[áa]gua|drinking|potable/i, "agua-potavel"],
];

/** Tipo de parada padrão quando nada no arquivo indica o que é. */
export const DEFAULT_POI_KIND = "destino";

/**
 * Descobre qual tipo de parada do app corresponde a um ponto solto do GPX.
 * Nunca devolve um id inexistente: cai em `DEFAULT_POI_KIND`.
 */
export function poiKindForSym(sym?: string, name?: string): string {
  const procurar = (alvo?: string): string | undefined => {
    const texto = alvo?.trim();
    if (!texto) return undefined;
    for (const [padrao, tipo] of SYM_PARA_TIPO) {
      if (padrao.test(texto) && POI_KINDS.some((k) => k.id === tipo)) return tipo;
    }
    return undefined;
  };

  // O `<sym>` é o campo estruturado do arquivo, então manda: se ele diz
  // "Restaurant", o tipo é restaurante mesmo que o nome fale em cachoeira.
  // Só quando ele não ajuda é que o nome é consultado.
  return procurar(sym) ?? procurar(name) ?? DEFAULT_POI_KIND;
}

/** Nome de arquivo previsível, sem acento nem caractere proibido. */
export function gpxFileName(titulo: string): string {
  const limpo = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  const data = new Date().toISOString().slice(0, 10);
  return `${limpo || "rota"}-${data}.gpx`;
}
