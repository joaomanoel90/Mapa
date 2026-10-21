import { describe, expect, it } from "vitest";
import {
  CARTA_SECONDS,
  buildTimeline,
  cardStart,
  routeEnd,
  routeProgress,
  timelineOr,
  videoLength,
} from "./timeline";
import { RECAP_SECONDS } from "./recap";
import { openingSeconds } from "./camera";

describe("linha do tempo do vídeo", () => {
  it("separa voo, percurso e cartela — e as três somam o vídeo", () => {
    const tl = buildTimeline(20, { voo: true, cartela: true });
    expect(tl.voo).toBeCloseTo(openingSeconds(20), 6);
    expect(tl.cartela).toBeCloseTo(CARTA_SECONDS, 6);
    expect(tl.percurso).toBeCloseTo(20 - tl.voo - tl.cartela, 6);
    expect(tl.voo + tl.percurso + tl.cartela).toBeCloseTo(20, 6);
  });

  it("a cartela fica para depois do fim do percurso (o pedido do usuário)", () => {
    // antes ela entrava em 79% do percurso e cobria o fim do trajeto
    const tl = buildTimeline(20, { voo: true, cartela: true });
    expect(routeEnd(tl)).toBeCloseTo(20 - CARTA_SECONDS, 6);
  });

  it("sem voo e sem cartela, o percurso é o vídeo inteiro", () => {
    const tl = buildTimeline(14, { voo: false, cartela: false });
    expect(tl).toEqual({ voo: 0, percurso: 14, recap: 0, cartela: 0 });
  });

  it("em clipe curto, voo e cartela encolhem juntos (o percurso fica com 40%)", () => {
    const tl = buildTimeline(6, { voo: true, cartela: true });
    expect(tl.percurso).toBeCloseTo(2.4, 6);
    expect(tl.voo + tl.cartela).toBeCloseTo(3.6, 6);
    // a proporção entre os dois é a mesma de antes de encolher
    expect(tl.cartela / tl.voo).toBeCloseTo(CARTA_SECONDS / openingSeconds(6), 6);
  });

  it("o progresso do percurso espera o voo e para no fim dele", () => {
    const tl = buildTimeline(20, { voo: true, cartela: true });
    expect(routeProgress(tl, 0)).toBe(0);
    expect(routeProgress(tl, tl.voo)).toBe(0); // ainda na partida
    expect(routeProgress(tl, tl.voo + tl.percurso / 2)).toBeCloseTo(0.5, 6);
    expect(routeProgress(tl, routeEnd(tl))).toBe(1);
    expect(routeProgress(tl, 20)).toBe(1); // durante a cartela, o percurso está feito
  });

  it("duração inválida não quebra", () => {
    const tl = buildTimeline(0, { voo: true, cartela: true });
    expect(tl.percurso).toBeGreaterThan(0);
    expect(Number.isFinite(tl.voo)).toBe(true);
  });

  it("os melhores momentos somam tempo e não encurtam o percurso", () => {
    const semRecap = buildTimeline(20, { voo: true, cartela: true });
    const comRecap = buildTimeline(20, { voo: true, cartela: true, recap: true });
    // o percurso é o mesmo: o recap é acréscimo, não uma fatia
    expect(comRecap.percurso).toBeCloseTo(semRecap.percurso, 6);
    expect(comRecap.voo).toBeCloseTo(semRecap.voo, 6);
    expect(comRecap.cartela).toBeCloseTo(semRecap.cartela, 6);
    expect(comRecap.recap).toBeCloseTo(RECAP_SECONDS, 6);
    // e o arquivo fica 3,6 s mais longo
    expect(videoLength(comRecap)).toBeCloseTo(20 + RECAP_SECONDS, 6);
  });

  it("a cartela só começa depois dos melhores momentos", () => {
    const tl = buildTimeline(20, { voo: true, cartela: true, recap: true });
    // a chegada continua sendo o fim do percurso
    expect(routeEnd(tl)).toBeCloseTo(tl.voo + tl.percurso, 6);
    expect(cardStart(tl) - routeEnd(tl)).toBeCloseTo(RECAP_SECONDS, 6);
  });

  it("sem linha do tempo, o vídeo inteiro é percurso (a cartela reserva a fatia)", () => {
    expect(timelineOr(null, 14)).toEqual({
      voo: 0,
      percurso: 14 - CARTA_SECONDS,
      recap: 0,
      cartela: CARTA_SECONDS,
    });
    const tl = buildTimeline(14, { voo: true, cartela: true });
    expect(timelineOr(tl, 14)).toBe(tl);
  });
});
