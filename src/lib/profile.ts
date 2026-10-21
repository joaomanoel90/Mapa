import { cumDoDesenho, totalDoDesenho, type Track } from "./geo";

/**
 * O perfil de elevação do percurso — a faixa que cresce embaixo do vídeo.
 *
 * Por que ele existe: numa prova ou trilha, o **relevo** é o que a pessoa quer
 * ver antes de sair (onde sobe, quanto sobe), e é o que falta nos vídeos
 * automáticos do Strava e do Relive — eles mostram o traçado visto de cima, mas
 * não contam a dureza do caminho. Aqui o gráfico se enche junto com o
 * personagem: em qualquer instante dá para ler "estou a 60% do percurso, a 312 m
 * de altitude, e ainda vem a subida".
 *
 * Tudo é calculado uma vez (`trailProfile`) e o desenho só lê o resultado: o
 * quadro é desenhado 60 vezes por segundo e não pode varrer 5.700 pontos.
 */

export type ProfilePoint = {
  /** posição no percurso, 0..1 (pela distância **desenhada**, como o personagem) */
  frac: number;
  /** altitude em metros */
  ele: number;
};

export type Climb = {
  /** onde a subida começa e termina, 0..1 */
  ini: number;
  fim: number;
  /** quantos metros ela sobe */
  ganho: number;
  eleMin: number;
  eleMax: number;
};

export type TrailProfile = {
  /** a linha, já reduzida a `colunas` pontos */
  pontos: ProfilePoint[];
  /** altitude mínima e máxima do percurso */
  min: number;
  max: number;
  /** subida acumulada (D+), com o mesmo filtro de ruído do resumo */
  ganho: number;
  /** a subida contínua mais forte do percurso (null quando é plano) */
  maiorSubida: Climb | null;
};

/**
 * Variação mínima (em metros) para o perfil valer a pena.
 *
 * Abaixo disto o gráfico seria uma linha reta — um retângulo decorativo
 * ocupando o rodapé do vídeo sem dizer nada. Rotas planas simplesmente não
 * ganham o perfil.
 */
export const RELEVO_MINIMO_M = 3;

/**
 * Subida mínima para virar destaque no gráfico — é o mesmo critério que o
 * resumo já usa para dizer que o arquivo tem elevação.
 */
export const SUBIDA_MINIMA_M = 20;

/** O ponto do traçado tem altitude aproveitável? */
const eleValida = (p: { ele?: number }): p is { ele: number } =>
  typeof p.ele === "number" && Number.isFinite(p.ele);

/**
 * O perfil de elevação de um traçado, pronto para desenhar.
 *
 * A posição de cada coluna vem da distância **do desenho** (`cumDoDesenho`), a
 * mesma que o personagem percorre — assim o gráfico e o mapa contam a mesma
 * história no mesmo instante (o `cum` medido, 2% menor e irregular, desalinharia
 * os dois).
 */
export function trailProfile(track: Track, colunas = 160): TrailProfile | null {
  const pts = track.pts;
  if (!pts || pts.length < 2) return null;

  const cum = cumDoDesenho(track);
  const total = totalDoDesenho(track);
  if (!(total > 0)) return null;

  let min = Infinity;
  let max = -Infinity;
  let validos = 0;
  for (const p of pts) {
    if (!eleValida(p)) continue;
    validos++;
    if (p.ele < min) min = p.ele;
    if (p.ele > max) max = p.ele;
  }
  if (validos < 2 || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min < RELEVO_MINIMO_M) return null;

  const n = Math.max(2, Math.min(600, Math.round(colunas)));
  const pontos: ProfilePoint[] = [];
  // ponteiro único: o percurso só anda para a frente, então é O(n + pontos)
  let j = 1;
  for (let i = 0; i < n; i++) {
    const alvo = (i / (n - 1)) * total;
    while (j < pts.length - 1 && (cum[j] ?? 0) < alvo) j++;
    const antes = pts[j - 1];
    const depois = pts[j];
    const dAntes = cum[j - 1] ?? 0;
    const dDepois = cum[j] ?? dAntes;
    /*

     * Quando um dos dois vizinhos não tem altitude (buraco no arquivo), o
     * perfil simplesmente não desenha ali — inventar altitude seria mentir
     * sobre o relevo.
     */
    if (!eleValida(antes) || !eleValida(depois)) continue;
    const f = dDepois > dAntes ? (alvo - dAntes) / (dDepois - dAntes) : 0;
    const ele = antes.ele + (depois.ele - antes.ele) * Math.min(1, Math.max(0, f));
    pontos.push({ frac: i / (n - 1), ele });
  }
  if (pontos.length < 2) return null;

  return {
    pontos,
    min,
    max,
    ganho: subidaAcumulada(pts),
    maiorSubida: maiorSubida(pts, cum, total),
  };
}

/**
 * Subida acumulada (D+) com filtro de ruído.
 *
 * A conta é a mesma ideia do resumo do percurso (`elevationSummary`): só conta
 * a variação **depois** que ela passa de alguns metros, senão o tremor do GPS
 * somaria centenas de metros num percurso plano.
 */
function subidaAcumulada(pts: { ele?: number }[], limiar = 4): number {
  let base: number | null = null;
  let ganho = 0;
  for (const p of pts) {
    if (!eleValida(p)) continue;
    if (base === null) {
      base = p.ele;
      continue;
    }
    const d = p.ele - base;
    if (d >= limiar) {
      ganho += d;
      base = p.ele;
    } else if (d < 0) {
      base = p.ele;
    }
  }
  return ganho;
}

/**
 * A maior subida contínua: do ponto mais baixo até o ponto mais alto que vem
 * depois dele.
 *
 * É a conta clássica de "maior subida" (a diferença máxima entre um vale e um
 * cume posterior) — não é a rampa mais inclinada, e sim a subida que a pessoa
 * sente como **a** subida do percurso. Devolve `null` quando o relevo não
 * chega a `SUBIDA_MINIMA_M` (rota plana não ganha destaque).
 */
function maiorSubida(
  pts: { ele?: number }[],
  cum: number[],
  total: number,
): Climb | null {
  let vale: { ele: number; i: number } | null = null;
  let melhor: { vale: { ele: number; i: number }; cume: { ele: number; i: number } } | null =
    null;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!eleValida(p)) continue;
    if (vale === null || p.ele < vale.ele) vale = { ele: p.ele, i };
    if (melhor === null || p.ele - vale.ele > melhor.cume.ele - melhor.vale.ele) {
      melhor = { vale, cume: { ele: p.ele, i } };
    }
  }
  if (!melhor) return null;
  const ganho = melhor.cume.ele - melhor.vale.ele;
  if (ganho < SUBIDA_MINIMA_M) return null;
  const frac = (i: number) => {
    const d = cum[i];
    return Number.isFinite(d) && total > 0 ? Math.min(1, Math.max(0, d / total)) : 0;
  };
  return {
    ini: frac(melhor.vale.i),
    fim: frac(melhor.cume.i),
    ganho,
    eleMin: melhor.vale.ele,
    eleMax: melhor.cume.ele,
  };
}

/**
 * A altitude no instante `frac` do percurso (0..1), interpolada na linha.
 *
 * É o que move o marcador do perfil junto com o personagem.
 */
export function elevacaoEm(perfil: TrailProfile, frac: number): number | null {
  const p = perfil.pontos;
  if (p.length === 0) return null;
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
  if (f <= p[0].frac) return p[0].ele;
  if (f >= p[p.length - 1].frac) return p[p.length - 1].ele;
  // busca binária: a linha é crescente em `frac` por construção
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid].frac <= f) lo = mid;
    else hi = mid;
  }
  const a = p[lo];
  const b = p[hi];
  const t = b.frac > a.frac ? (f - a.frac) / (b.frac - a.frac) : 0;
  return a.ele + (b.ele - a.ele) * t;
}

/** A inclinação média da maior subida, em porcentagem (null quando é plana). */
export function inclinacaoDaSubida(perfil: TrailProfile, distanciaM: number): number | null {
  const c = perfil.maiorSubida;
  if (!c || !(distanciaM > 0)) return null;
  const percorrido = Math.max(0, c.fim - c.ini) * distanciaM;
  if (percorrido < 50) return null;
  return (c.ganho / percorrido) * 100;
}

/**
 * Onde fica a faixa do perfil no quadro e o tamanho dela.
 *
 * Fica no rodapé, alinhada com a margem da rota, e **sobe** quando a barra de
 * progresso está ligada (ela ocupa o pé do quadro, com o "3,2 de 21,1 km").
 * Função pura porque o desenho e o teste precisam do mesmo retângulo.
 */
export function profileLayout(
  width: number,
  height: number,
  sf: number,
  progressoAbaixo: boolean,
): { x: number; y: number; w: number; h: number; raio: number } {
  const pad = 26 * sf;
  const w = Math.round(width - pad * 2);
  const h = Math.round(Math.min(Math.max(52 * sf, 52), height * 0.16));
  // a barra de progresso vive entre `height - 38·sf` e o pé, com o rótulo
  // acima dele: 62·sf de folga deixa a faixa inteira livre
  const base = progressoAbaixo ? height - 62 * sf : height - 18 * sf;
  const y = Math.round(base - h);
  return { x: Math.round(pad), y, w, h, raio: 12 * sf };
}
