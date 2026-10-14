/**
 * Quantas vezes a rota passa por uma parada.
 *
 * Até agora cada parada era **um instante** (`t`): a rota passava, o vídeo
 * mostrava, e acabou. Numa ida e volta pelo mesmo caminho isso ficava errado —
 * a parada da metade do percurso é passada **duas vezes**, e a segunda não
 * aparecia no vídeo nem na linha do tempo.
 *
 * Aqui a pergunta é feita ao contrário: em vez de perguntar "quando a parada
 * acontece", pergunta-se **onde a rota chega perto da parada**. A resposta são
 * todos os trechos em que a rota fica a menos de `PASSAGE_RADIUS_M` do lugar —
 * um na ida, outro na volta.
 *
 * O raio de 40 m é o que separa "passou de novo pelo mesmo lugar" de "passou
 * numa rua paralela". Ida e volta pelo mesmo asfalto ficam a poucos metros uma
 * da outra (é o erro do GPS); duas ruas paralelas ficam a 100 m ou mais. Um raio
 * largo demais marcaria a rua do lado como se fosse a mesma parada.
 *
 * Duas passagens muito próximas ao longo da rota (uma parada em cima do ponto
 * de retorno, por exemplo) contam como **uma só**: senão o pino piscaria duas
 * vezes em cima de si mesmo.
 */

import type { LatLng, Track } from "./geo";
import { poiLatLng, type Poi } from "./pois";

/** A que distância da parada a rota precisa chegar para contar uma passagem. */
export const PASSAGE_RADIUS_M = 40;

/** Duas passagens mais próximas que isto, ao longo da rota, são a mesma. */
const MERGE_M = 3 * PASSAGE_RADIUS_M;

const M_POR_GRAU = 111_320;

export type Passage = {
  /** instante da rota (0..1), como `Poi.t` */
  t: number;
  /** distância real até a parada naquele instante, em metros */
  dist: number;
};

/**
 * Distância do lugar `at` até o **trecho** de rota que vai de `a` a `b`.
 *
 * Medir por trecho, e não por ponto, é o que faz a conta não depender do
 * espaçamento do GPS: uma rota com um ponto a cada 100 m passa exatamente por
 * cima da parada sem ter nenhum ponto ali, e medindo por ponto a parada
 * "não existiria".
 *
 * A conta é feita em metros num plano local (equiretangular centrado no lugar),
 * que erra alguns centímetros nas distâncias que interessam aqui (dezenas de
 * metros) e não precisa de trigonometria esférica.
 *
 * `u` diz onde caiu o ponto mais próximo do trecho (0 = em `a`, 1 = em `b`).
 */
function distToSegment(at: LatLng, a: LatLng, b: LatLng): { d: number; u: number } {
  const cosLat = Math.cos((at.lat * Math.PI) / 180);
  const ax = (a.lng - at.lng) * cosLat * M_POR_GRAU;
  const ay = (a.lat - at.lat) * M_POR_GRAU;
  const bx = (b.lng - at.lng) * cosLat * M_POR_GRAU;
  const by = (b.lat - at.lat) * M_POR_GRAU;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;

  const px = ax + dx * u;
  const py = ay + dy * u;
  return { d: Math.hypot(px, py), u };
}

/**
 * Todos os instantes em que a rota chega a menos de `raioM` da parada.
 *
 * Vem em ordem de percurso. Vazio = a rota nunca chegou perto (parada marcada
 * longe do trajeto).
 */
export function passagesOf(
  track: Track,
  at: LatLng,
  raioM: number = PASSAGE_RADIUS_M,
): Passage[] {
  const pts = track.pts;
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) {
    const d = distToSegment(at, pts[0], pts[0]).d;
    return d <= raioM ? [{ t: 0, dist: d }] : [];
  }

  /*
   * Percorre os trechos e guarda o trecho mais próximo de cada aproximação
   * contígua: um trecho fora do raio fecha a aproximação, o seguinte abre outra.
   * Assim a ida e a volta — separadas por quilômetros de rota — viram duas
   * passagens, e uma parada em cima do ponto de retorno (onde a rota nunca sai
   * do raio) continua sendo uma só.
   */
  const encontradas: Passage[] = [];
  let atual: { seg: number; u: number; d: number } | null = null;
  let ultimoSeg = -2;

  for (let i = 0; i < n - 1; i++) {
    const q = distToSegment(at, pts[i], pts[i + 1]);
    if (q.d <= raioM) {
      if (atual && i === ultimoSeg + 1) {
        if (q.d < atual.d) atual = { seg: i, u: q.u, d: q.d };
      } else {
        if (atual) encontradas.push({ t: (atual.seg + atual.u) / (n - 1), dist: atual.d });
        atual = { seg: i, u: q.u, d: q.d };
      }
      ultimoSeg = i;
    } else {
      if (atual) {
        encontradas.push({ t: (atual.seg + atual.u) / (n - 1), dist: atual.d });
        atual = null;
      }
      ultimoSeg = -2;
    }
  }
  if (atual) encontradas.push({ t: (atual.seg + atual.u) / (n - 1), dist: atual.d });

  // mescla passagens praticamente no mesmo ponto da rota (parada no retorno,
  // ondulação do GPS em volta do lugar): o pino não pode piscar duas vezes
  const out: Passage[] = [];
  for (const p of encontradas) {
    const ultima = out[out.length - 1];
    if (ultima && Math.abs(p.t - ultima.t) * track.total < MERGE_M) {
      if (p.dist < ultima.dist) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Instantes em que a parada aparece no vídeo.
 *
 * Quando a rota nunca chega perto (parada marcada a centenas de metros do
 * trajeto), volta ao comportamento de sempre: acontece no `t` em que foi
 * criada. Sem isso, uma parada fora da rota **nunca** apareceria.
 */
export function stopPassages(
  track: Track,
  stop: Poi,
  raioM: number = PASSAGE_RADIUS_M,
): number[] {
  const found = passagesOf(track, poiLatLng(stop, track), raioM);
  if (found.length === 0) return [stop.t];
  return found.map((p) => p.t);
}

/** Passagens de todas as paradas, por id — o que o desenho e a câmera usam. */
export function mapPassages(
  track: Track,
  stops: Poi[],
  raioM: number = PASSAGE_RADIUS_M,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of stops) out[s.id] = stopPassages(track, s, raioM);
  return out;
}

/** Todas as passagens em ordem de percurso (a câmera cinematográfica usa). */
export function passageTimes(
  stops: Poi[],
  passages: Record<string, number[]> | null | undefined,
): number[] {
  const out: number[] = [];
  for (const s of stops) {
    const lista = passages?.[s.id] ?? [s.t];
    for (const t of lista) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Quantas passagens a parada tem (1 = comportamento antigo). */
export function countFor(
  stop: Poi,
  passages: Record<string, number[]> | null | undefined,
): number {
  return (passages?.[stop.id] ?? [stop.t]).length;
}

/**
 * Quantas passagens já aconteceram, e quantas existem.
 *
 * `extras` conta as passagens além da primeira de cada parada: é o que distingue
 * "5 paradas" de "5 paradas, uma delas passada duas vezes" (6 passagens).
 */
export function countPassed(
  stops: Poi[],
  passages: Record<string, number[]> | null | undefined,
  t: number,
): { passed: number; total: number; extras: number } {
  let passed = 0;
  let total = 0;
  for (const s of stops) {
    const lista = passages?.[s.id] ?? [s.t];
    total += lista.length;
    for (const ts of lista) if (t >= ts) passed++;
  }
  return { passed, total, extras: total - stops.length };
}
