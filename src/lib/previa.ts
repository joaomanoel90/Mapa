/**
 * Quanto do mapa a prévia espera antes de começar a andar.
 *
 * O pedido do usuário: *"será que é possível entender a rota, baixar todo o mapa
 * necessário para depois criar o vídeo"*. O vídeo já fazia isso (o `warmup`
 * baixa tudo antes de gravar). A prévia não: ela tocava enquanto os blocos
 * chegavam, e o mapa ia aparecendo aos pedaços na frente de quem olhava.
 *
 * A espera é só do **começo**: os blocos de toda a animação são alguns milhares
 * (uma rota de 21 km em 9:16 pede ~600, com paradas), e esperar todos seria um
 * minuto de tela parada. Depois que os primeiros chegam, a prévia anda e o resto
 * continua chegando — o mesmo comportamento de sempre, só sem o buraco no
 * começo.
 */

/** Fração dos blocos da animação que a prévia espera antes de tocar. */
export const PREVIA_ESSENCIAL = 0.15;

/** Piso: numa rota curta, espera pelo menos esta quantidade. */
export const PREVIA_MINIMO = 40;

/** Teto de espera (ms): rede ruim não pode deixar a prévia parada para sempre. */
export const PREVIA_ESPERA_MS = 12000;

/** Quantos blocos precisam estar prontos antes de a prévia começar. */
export function blocosEssenciais(total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(total, Math.max(PREVIA_MINIMO, Math.ceil(total * PREVIA_ESSENCIAL)));
}
