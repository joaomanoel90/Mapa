/**
 * Os **destaques** do percurso: a melhor parcial e a maior subida.
 *
 * O vídeo já mostra o traçado, o HUD e o perfil. O que ele não fazia era
 * **contar a corrida**: quem assiste um Reel de treino quer saber onde o atleta
 * foi melhor e onde foi mais duro — é esse par de números que se comenta depois.
 *
 * A regra de honestidade é a mesma do HUD: nada é inventado.
 *
 * - **melhor parcial** só existe com hora no arquivo (sem `<time>` não há tempo
 *   de trecho, e a média do vídeo daria quilômetros por hora absurdos — foi
 *   assim que o HUD chegou a mostrar 3.137 km/h);
 * - **maior subida** só existe com altitude e com desnível de verdade (a mesma
 *   régua do perfil: `SUBIDA_MINIMA_M`);
 * - um trecho com metade dos pontos sem hora não vira parcial: o tempo medido
 *   ali seria chute.
 *
 * As parciais usam o **mesmo passo das marcas de km** desenhadas na linha
 * (`kmStep`): cada número que aparece no mapa é uma fronteira de parcial, e o
 * vídeo não fica com duas réguas diferentes.
 */

import { cumDoDesenho, totalDoDesenho, type Track } from "./geo";
import { elapsedAt, formatPace } from "./hud";
import { kmStep } from "./km-marks";
import { inclinacaoDaSubida, type TrailProfile } from "./profile";

/** Fração de pontos com hora que um trecho precisa ter para virar parcial. */
export const PARCIAL_COBERTURA = 0.9;

/** Abaixo disto não há parcial: um trecho de 800 m não tem "km mais rápido". */
export const PARCIAL_MINIMO_M = 2000;

/** Quantas parciais são necessárias para "a melhor" dizer alguma coisa. */
export const PARCIAIS_PARA_MELHOR = 3;

export type Parcial = {
  /** o km em que o trecho termina (a marca do mapa) */
  km: number;
  /** início e fim do trecho, 0..1 do percurso */
  ini: number;
  fim: number;
  /** duração do trecho, em segundos */
  segundos: number;
  /** segundos por quilômetro */
  ritmo: number;
};

export type Destaque = {
  tipo: "melhorKm" | "maiorSubida";
  /** onde do percurso o destaque acontece, 0..1 (o personagem chega ali) */
  em: number;
  /** título pequeno, em cima: "Melhor km" */
  titulo: string;
  /** o número grande: "4:12" */
  valor: string;
  /** a unidade, ao lado do número: "/km", "m", "km/h" */
  unidade: string;
  /** a linha de baixo: "km 7 de 21,1" */
  detalhe: string;
};

/** Número com uma casa e vírgula, como se escreve em português. */
const n1 = (x: number) => x.toFixed(1).replace(".", ",");

/** Quilômetro escrito sem casa quando é redondo ("km 7", e não "km 7,0"). */
const kmTxt = (km: number) => (Math.abs(km - Math.round(km)) < 0.05 ? String(Math.round(km)) : n1(km));

/**
 * As parciais do percurso, uma por trecho entre marcas de km.
 *
 * O tempo de cada fronteira sai de `elapsedAt`, que interpola a hora na
 * **distância** (não no índice) — o mesmo relógio que o HUD mostra, para o
 * vídeo não ter dois cronômetros.
 */
export function parciais(track: Track, times: number[] | null): Parcial[] {
  if (!times || times.length !== track.pts.length) return [];
  const total = totalDoDesenho(track);
  if (!(total >= PARCIAL_MINIMO_M)) return [];

  const cum = cumDoDesenho(track);
  const passo = kmStep(total, 12) * 1000;
  if (!(passo > 0)) return [];

  const quantos = Math.floor(total / passo);
  const out: Parcial[] = [];
  for (let k = 1; k <= quantos; k++) {
    const d0 = (k - 1) * passo;
    const d1 = k * passo;

    // cobertura: os pontos do trecho precisam ter hora
    let pontos = 0;
    let datados = 0;
    for (let i = 0; i < cum.length; i++) {
      const d = cum[i];
      if (d < d0 || d > d1) continue;
      pontos++;
      if (Number.isFinite(times[i])) datados++;
    }
    if (pontos === 0 || datados / pontos < PARCIAL_COBERTURA) continue;

    const a = elapsedAt(track.pts, cum, d0 / total, times);
    const b = elapsedAt(track.pts, cum, d1 / total, times);
    if (a === null || b === null) continue;
    const segundos = b - a;
    if (!(segundos > 0)) continue;

    out.push({
      km: k * (passo / 1000),
      ini: d0 / total,
      fim: Math.min(1, d1 / total),
      segundos,
      ritmo: segundos / (passo / 1000),
    });
  }
  return out;
}

/**
 * A melhor parcial — a mais rápida.
 *
 * Exige pelo menos `PARCIAIS_PARA_MELHOR`: com uma ou duas não existe "a
 * melhor", existe "a única".
 */
export function melhorParcial(ps: Parcial[]): Parcial | null {
  if (ps.length < PARCIAIS_PARA_MELHOR) return null;
  let melhor = ps[0];
  for (const p of ps) if (p.ritmo < melhor.ritmo) melhor = p;
  return melhor;
}

/**
 * Os destaques do percurso, em ordem de acontecimento.
 *
 * `pace` escolhe a unidade da parcial: a pé, min/km; de bike, km/h.
 */
export function destaques(input: {
  track: Track;
  times: number[] | null;
  perfil: TrailProfile | null;
  /** o vídeo está em ritmo (corrida/caminhada)? */
  pace: boolean;
}): Destaque[] {
  const { track, times, perfil, pace } = input;
  const totalM = totalDoDesenho(track);
  const totalKm = totalM / 1000;
  const out: Destaque[] = [];

  const melhor = melhorParcial(parciais(track, times));
  if (melhor) {
    const passo = kmStep(totalM, 12);
    out.push({
      tipo: "melhorKm",
      em: melhor.fim,
      titulo: passo > 1 ? "Melhor parcial" : "Melhor km",
      valor: pace ? formatPace(melhor.ritmo) : n1(3600 / melhor.ritmo),
      unidade: pace ? "/km" : "km/h",
      detalhe: `km ${kmTxt(melhor.km)} de ${n1(totalKm)}`,
    });
  }

  const subida = perfil?.maiorSubida ?? null;
  if (subida) {
    const inclinacao = inclinacaoDaSubida(perfil as TrailProfile, totalM);
    const km = subida.fim * totalKm;
    out.push({
      tipo: "maiorSubida",
      em: subida.fim,
      titulo: "Maior subida",
      valor: String(Math.round(subida.ganho)),
      unidade: "m",
      detalhe:
        inclinacao === null
          ? `km ${kmTxt(km)} de ${n1(totalKm)}`
          : `${n1(inclinacao)}% · km ${kmTxt(km)}`,
    });
  }

  // dois destaques no mesmo lugar do percurso não cabem na tela: o primeiro
  // (o mais cedo) fica
  out.sort((a, b) => a.em - b.em);
  return out.filter((d, i) => i === 0 || d.em - out[i - 1].em > 0.03);
}

/** Quanto antes do momento o destaque começa a entrar (e o quanto dura a entrada). */
export const DESTAQUE_ANTES_S = 0.25;
/** Quanto tempo ele fica inteiro na tela, contando do momento. */
export const DESTAQUE_FICA_S = 2.2;
/** Rampa de saída: o destaque some aos poucos, não pisca. */
export const DESTAQUE_FADE_S = 0.35;
/** Distância mínima (em segundos de vídeo) entre dois avisos. */
export const DESTAQUE_MIN_SEPARACAO_S = 0.9;

/**
 * Quanto do destaque está visível em `t` (0..1).
 *
 * A conta é em **segundos de vídeo**, e não em fração do percurso: o destaque é
 * um aviso, e na tela ele dura o mesmo tanto num clipe de 8 s e num de 40.
 * `em` é a fração do percurso e `percursoS` a duração do percurso no vídeo.
 */
export function janelaDoDestaque(
  t: number,
  em: number,
  percursoS: number,
  ficaS = DESTAQUE_FICA_S,
): number {
  if (!(percursoS > 0)) return 0;
  const desde = (t - em) * percursoS;
  const inicio = -DESTAQUE_ANTES_S;
  // num vídeo curto, dois destaques próximos dividem a tela: quem chama pode
  // encurtar a permanência (`ficaS`) para o segundo não nascer por cima do
  // primeiro
  const fim = Math.max(DESTAQUE_ANTES_S + 0.05, ficaS);
  if (desde < inicio || desde > fim) return 0;
  // a entrada termina **no momento** (em `from` o aviso já está inteiro) e a
  // saída é que se arrasta por `DESTAQUE_FADE_S`
  const entra = Math.min(1, (desde - inicio) / DESTAQUE_ANTES_S);
  const sai = Math.min(1, (fim - desde) / DESTAQUE_FADE_S);
  return Math.min(entra, sai);
}

/**
 * O destaque que está em cena em `t`, e com que força.
 *
 * Quando dois se sobrepõem (a melhor parcial no meio da maior subida), aparece
 * o que está **mais visível**; no empate, o mais cedo — assim a tela nunca
 * troca de aviso no meio de um.
 */
export function destaqueEmCena(
  lista: Destaque[],
  t: number,
  percursoS: number,
): { destaque: Destaque; alfa: number } | null {
  if (!(percursoS > 0)) return null;

  /*
   * Dois avisos a menos de um segundo de distância viram um pisca-pisca: fica o
   * primeiro. E cada um **cede a vez** ao seguinte — a permanência é o que
   * couber até a hora do próximo, então eles aparecem em sequência, nunca um
   * por cima do outro.
   */
  const mantidos: Destaque[] = [];
  for (const d of lista) {
    const ultimo = mantidos[mantidos.length - 1];
    if (ultimo && (d.em - ultimo.em) * percursoS < DESTAQUE_MIN_SEPARACAO_S) continue;
    mantidos.push(d);
  }

  let melhor: { destaque: Destaque; alfa: number } | null = null;
  for (let i = 0; i < mantidos.length; i++) {
    const d = mantidos[i];
    const proximo = mantidos[i + 1];
    const fica = proximo
      ? Math.min(DESTAQUE_FICA_S, (proximo.em - d.em) * percursoS)
      : DESTAQUE_FICA_S;
    const alfa = janelaDoDestaque(t, d.em, percursoS, fica);
    if (alfa <= 0.01) continue;
    if (!melhor || alfa > melhor.alfa + 1e-9) melhor = { destaque: d, alfa };
  }
  return melhor;
}
