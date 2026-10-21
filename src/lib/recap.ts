/**
 * Os **melhores momentos** do percurso, no fim do vídeo.
 *
 * O vídeo já tem três formas de contar o que aconteceu: os avisos no meio do
 * percurso (melhor parcial, maior subida), a cartela com os números e o
 * traçado em si. Falta a que as pessoas fazem à mão quando editam: **rever os
 * momentos**, um atrás do outro, no fim.
 *
 * Aqui eles são textos curtos — um título, um número e uma linha — desenhados
 * com o mapa parado na chegada. Nada de blocos novos, nada de mexer na câmera:
 * o recap é o intervalo entre o fim do percurso e a cartela, e só existe quando
 * o arquivo tem o que relembrar.
 */

import { formatDistance, type Track } from "./geo";
import type { Destaque } from "./highlights";

/**
 * Quanto tempo o bloco de melhores momentos ocupa.
 *
 * É **somado** ao vídeo (por cima da duração escolhida no painel), e não
 * tirado do percurso: encurtar o percurso para caber o recap seria tirar o que
 * o usuário pediu para ver. Quatro momentos de 0,9 s.
 */
export const RECAP_SECONDS = 3.6;

/** Quantos momentos cabem no bloco (os primeiros; o resto fica de fora). */
export const RECAP_MAX_MOMENTOS = 4;

export type RecapMoment = {
  /** etiqueta pequena em cima: "Largada", "Melhor km", "Chegada" */
  titulo: string;
  /** o número grande */
  valor: string;
  /** a unidade ao lado do número ("" = nenhuma) */
  unidade: string;
  /** a linha de baixo */
  detalhe: string;
};

/** "07:12" — a hora do dia, com dois dígitos. */
function horaDoDia(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Duração legível a partir de segundos: "3 h 19", "42 min". */
function duracaoTxt(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/**
 * Os momentos do recap, na ordem em que aconteceram.
 *
 * Só entra o que o arquivo tem: sem hora não há largada nem melhor km; sem
 * elevação não há maior subida. Com menos de **dois** momentos não há recap —
 * um cartão sozinho não é um resumo, é a cartela de novo.
 */
export function momentosDoRecap(input: {
  track: Track;
  /** hora de cada ponto (ou `null` quando o arquivo não tem) */
  times: number[] | null;
  /** os destaques que o vídeo já mostra no meio do percurso */
  destaques: Destaque[];
}): RecapMoment[] {
  const { track, times, destaques } = input;
  const out: RecapMoment[] = [];
  const horas = times && times.length === track.pts.length && times.length > 0 ? times : null;
  const comHoras = horas !== null;

  if (comHoras) {
    out.push({
      titulo: "Largada",
      valor: horaDoDia(horas![0]),
      unidade: "",
      detalhe: "começo do percurso",
    });
  }

  // a chegada e a largada têm lugar garantido; os destaques ficam com o resto
  const espacoDosDestaques = RECAP_MAX_MOMENTOS - (comHoras ? 1 : 0) - 1;
  for (const d of destaques.slice(0, Math.max(0, espacoDosDestaques))) {
    if (d.tipo !== "melhorKm" && d.tipo !== "maiorSubida") continue;
    out.push({
      titulo: d.titulo,
      valor: d.valor,
      unidade: d.unidade,
      detalhe: d.detalhe,
    });
  }

  // a chegada fecha o resumo; sem hora, o número é a distância
  const fim = horas ? horas[horas.length - 1] : null;
  out.push({
    titulo: "Chegada",
    valor: formatDistance(track.total),
    unidade: "",
    detalhe:
      fim !== null
        ? `${horaDoDia(fim)} · ${duracaoTxt((fim - horas![0]) / 1000)}`
        : "fim do percurso",
  });

  return out.length >= 2 ? out : [];
}

/**
 * Qual momento está em cena e com que opacidade.
 *
 * Os momentos se dividem igualmente no bloco (`RECAP_SECONDS`); a troca tem
 * uma rampa curta de entrada e saída, para o cartão não piscar de um para o
 * outro.
 */
export function momentoNaTela(
  momentos: RecapMoment[] | null | undefined,
  /** segundos desde o início do bloco (0..RECAP_SECONDS) */
  desde: number,
  segundosDoBloco: number,
): { momento: RecapMoment; indice: number; total: number; alfa: number } | null {
  if (!momentos || momentos.length < 2 || !(segundosDoBloco > 0)) return null;
  if (desde < 0 || desde > segundosDoBloco) return null;

  const passo = segundosDoBloco / momentos.length;
  const indice = Math.min(momentos.length - 1, Math.floor(desde / passo));
  const dentro = (desde - indice * passo) / passo;
  const rampa = 0.16;
  const alfa = Math.max(0, Math.min(1, dentro / rampa, (1 - dentro) / rampa));
  return { momento: momentos[indice], indice, total: momentos.length, alfa };
}
