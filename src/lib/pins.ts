/**
 * Como desenhar os pinos do traçado.
 *
 * Um pino comum é um marcador do Leaflet com alça de arrasto, ou seja, um
 * elemento no DOM. Alguns milhares deles travam o arrasto e a rolagem, então
 * a partir de `PIN_DOT_LIMIT` os pinos viram pontos desenhados no canvas
 * (baratos: milhares cabem) e só os que importam continuam marcadores de
 * verdade — a partida, a chegada e o pino escolhido.
 *
 * O pino escolhido vira marcador ao ser clicado, e é assim que se arrasta um
 * ponto específico quando a rota tem milhares deles.
 */
export const PIN_DOT_LIMIT = 150;

/** Com esta quantidade de pinos, o mapa desenha pontos em vez de marcadores. */
export function pinsAsDots(count: number): boolean {
  return count > PIN_DOT_LIMIT;
}

/** Este pino continua sendo um marcador arrastável? */
export function keepsMarker(index: number, count: number, selected: number | null): boolean {
  return index === 0 || index === count - 1 || index === selected;
}
