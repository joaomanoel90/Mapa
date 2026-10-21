/**
 * Percurso de **vários dias** (uma travessia, um trekking de fim de semana,
 * uma viagem de bike).
 *
 * O GPX não tem "dias": tem pontos com hora. Um arquivo multi-dia é um traçado
 * em que, de um ponto para o outro, passaram-se horas — a noite. É isso que
 * separa os dias aqui: um **intervalo** entre pontos, e não a data do relógio
 * (uma pedalada que atravessa a meia-noite continua sendo um dia só, e é assim
 * que quem pedalou conta).
 *
 * Sem hora nos pontos não há dia nenhum para mostrar — e o vídeo sai como
 * sempre, sem marcas e sem a linha "dias" na cartela.
 */

import { cumDoDesenho, totalDoDesenho, type Track } from "./geo";

/**
 * Intervalo que separa dois dias.
 *
 * Seis horas: tempo de sobra para uma parada longa (almoço, banho de cachoeira,
 * um cochilo) **não** virar "dia 2", e curto o bastante para uma noite de
 * travessia contar. Medido no uso real: um percurso de um dia tem intervalos de
 * minutos; um de dois dias tem uma noite inteira entre eles.
 */
export const INTERVALO_DE_DIA_MS = 6 * 3_600_000;

export type Dia = {
  /** 1, 2, 3… na ordem do arquivo */
  n: number;
  /** onde o dia começa e termina, em fração do percurso desenhado (0..1) */
  t0: number;
  t1: number;
  /** distância pedalada/caminhada no dia, em metros */
  metros: number;
  /** hora do primeiro e do último ponto do dia (epoch ms) */
  inicio: number;
  fim: number;
};

/**
 * Os dias do percurso.
 *
 * Devolve `[]` quando o arquivo não tem hora em **todos** os pontos (um dia só
 * não é "multi-dia", e um traçado com hora faltando no meio não dá para
 * dividir sem inventar) e quando o traçado não tem comprimento.
 */
export function diasDoPercurso(track: Track): Dia[] {
  const pts = track.pts;
  if (pts.length < 2) return [];

  const horas: number[] = [];
  for (const p of pts) {
    if (typeof p.t !== "number" || !Number.isFinite(p.t)) return [];
    horas.push(p.t);
  }

  const cum = cumDoDesenho(track);
  const total = totalDoDesenho(track);
  if (!(total > 0)) return [];

  // os índices em que um dia começa (o 0 é sempre o primeiro)
  const inicios = [0];
  for (let i = 1; i < pts.length; i++) {
    if (horas[i] - horas[i - 1] > INTERVALO_DE_DIA_MS) inicios.push(i);
  }
  if (inicios.length < 2) return [];

  const dias: Dia[] = [];
  for (let d = 0; d < inicios.length; d++) {
    const i0 = inicios[d];
    const i1 = d + 1 < inicios.length ? inicios[d + 1] : pts.length;
    /*
     * O dia vai até o **ponto em que o seguinte começa** (e não até o seu
     * último ponto): o segmento entre os dois é a distância em que a pessoa
     * parou e retomou, e sem ele os dias não cobririam a rota inteira — cada
     * um ficaria com um pedaço a menos e a soma das distâncias não fecharia
     * com o total do percurso.
     */
    const inicio = cum[i0] ?? 0;
    const fim = cum[Math.min(i1, cum.length - 1)] ?? inicio;
    dias.push({
      n: d + 1,
      t0: Math.max(0, Math.min(1, inicio / total)),
      t1: Math.max(0, Math.min(1, fim / total)),
      metros: Math.max(0, fim - inicio),
      inicio: horas[i0],
      fim: horas[i1 - 1],
    });
  }
  return dias;
}

/** Quanto tempo o aviso de dia novo fica na tela (em segundos de vídeo). */
export const DIA_FICA_S = 2.4;

/** Rampa de entrada e de saída do aviso (segundos de vídeo). */
export const DIA_FADE_S = 0.35;

/**
 * O aviso de "DIA N" que está em cena neste instante, e a opacidade dele.
 *
 * O dia 1 não avisa nada: o vídeo já começa nele, e um "DIA 1" no primeiro
 * quadro seria uma etiqueta sem informação. Do 2 em diante, o aviso entra
 * quando o personagem cruza para o dia seguinte.
 *
 * Como o destaque do percurso, a conta é em **segundos de vídeo** — o aviso
 * dura o mesmo tanto num clipe de 8 s e num de 40.
 */
export function diaNaTela(
  dias: Dia[] | null | undefined,
  t: number,
  percursoS: number,
): { dia: Dia; alfa: number } | null {
  if (!dias || dias.length < 2 || !(percursoS > 0)) return null;
  for (const dia of dias) {
    if (dia.n === 1) continue;
    const desde = (t - dia.t0) * percursoS;
    if (desde < 0 || desde > DIA_FICA_S) continue;
    const entra = Math.min(1, desde / DIA_FADE_S);
    const sai = Math.min(1, (DIA_FICA_S - desde) / DIA_FADE_S);
    return { dia, alfa: Math.max(0, Math.min(entra, sai)) };
  }
  return null;
}
