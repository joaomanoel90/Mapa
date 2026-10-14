import { describe, expect, it } from "vitest";
import { buildTrack, fitZoom, boundsOf } from "./geo";
import {
  OPEN_CAP_S,
  STOP_BOOST,
  cameraTarget,
  openingProgress,
  openingSeconds,
  stopBoost,
  stopSpan,
  type CinematicConfig,
} from "./camera";

const W = 1280;
const H = 720;
const MAX_ZOOM = 19;

/** Traçado reto de ~11 km, do sul para o norte. */
const PTS = Array.from({ length: 400 }, (_, i) => ({
  lat: -23.6 + i * 0.00025,
  lng: -48.4,
}));
const track = buildTrack(PTS);
const fitZ = fitZoom(boundsOf(track.pts), W, H, 0.16);

const cine = (patch: Partial<CinematicConfig> = {}): CinematicConfig => ({
  opening: false,
  stops: false,
  stopTs: [],
  ...patch,
});

const alvo = (
  t: number,
  elapsed: number,
  patch: { cinematic?: Partial<CinematicConfig>; followZoom?: number; mode?: "fit" | "follow" } = {},
) =>
  cameraTarget({
    track,
    t,
    camera: {
      mode: patch.mode ?? "follow",
      followZoom: patch.followZoom ?? 16,
      cinematic: cine(patch.cinematic),
    },
    width: W,
    height: H,
    maxZoom: MAX_ZOOM,
    elapsed,
    duration: 14,
  });

describe("abertura", () => {
  it("dura pouco: tem teto e nunca come o vídeo inteiro", () => {
    expect(openingSeconds(14)).toBeCloseTo(2.6, 6);
    expect(openingSeconds(60)).toBe(OPEN_CAP_S);
    expect(openingSeconds(4)).toBeCloseTo(1, 6);
    expect(openingSeconds(0)).toBeGreaterThan(0);
  });

  it("começa na região inteira e termina pousando na rota", () => {
    expect(openingProgress(0, 14)).toBeCloseTo(0, 6);
    expect(openingProgress(openingSeconds(14), 14)).toBeCloseTo(1, 6);
    expect(openingProgress(99, 14)).toBe(1);
    // e é uma animação suave, sem degrau
    expect(openingProgress(0.5, 14)).toBeLessThan(0.5);
  });

  it("no primeiro quadro a câmera está na vista da rota toda", () => {
    const t0 = alvo(0, 0, { cinematic: { opening: true } });
    expect(t0.zoom).toBeCloseTo(fitZ, 6);
    expect(t0.opening).toBe(0);
    // bem mais afastada do que o zoom de acompanhamento
    expect(fitZ).toBeLessThan(15);
  });

  it("depois da abertura já está no zoom de acompanhamento, em cima do personagem", () => {
    const depois = alvo(0.5, 3, { cinematic: { opening: true } });
    expect(depois.opening).toBe(1);
    expect(depois.zoom).toBeCloseTo(16, 6);
    const meio = alvo(0.5, openingSeconds(14) / 2, { cinematic: { opening: true } });
    expect(meio.zoom).toBeGreaterThan(fitZ);
    expect(meio.zoom).toBeLessThan(16);
  });

  it("desligada, a câmera já começa no zoom de acompanhamento", () => {
    const t0 = alvo(0, 0, { cinematic: { opening: false } });
    expect(t0.zoom).toBeCloseTo(16, 6);
    expect(t0.opening).toBe(1);
  });
});

describe("aproximação nas paradas", () => {
  it("chega mais perto na parada e volta ao normal depois", () => {
    const parada = 0.5;
    const emCima = alvo(parada, 5, { cinematic: { stops: true, stopTs: [parada] } });
    const antes = alvo(0.1, 5, { cinematic: { stops: true, stopTs: [parada] } });
    expect(emCima.boost).toBeCloseTo(1, 6);
    expect(emCima.zoom).toBeCloseTo(16 + STOP_BOOST, 5);
    expect(antes.boost).toBe(0);
    expect(antes.zoom).toBeCloseTo(16, 6);

    // a transição é gradual: a meio caminho o zoom está entre os dois
    const meio = alvo(parada - stopSpan(14) / 2, 5, {
      cinematic: { stops: true, stopTs: [parada] },
    });
    expect(meio.boost).toBeGreaterThan(0);
    expect(meio.boost).toBeLessThan(1);
    expect(meio.zoom).toBeGreaterThan(16);
    expect(meio.zoom).toBeLessThan(16 + STOP_BOOST);
  });

  it("duas paradas vizinhas não somam zoom", () => {
    const duas = alvo(0.5, 5, { cinematic: { stops: true, stopTs: [0.5, 0.52] } });
    expect(duas.zoom).toBeCloseTo(16 + STOP_BOOST, 5);
  });

  it("não passa do zoom que o mapa serve", () => {
    const teto = alvo(0.5, 5, {
      cinematic: { stops: true, stopTs: [0.5] },
      followZoom: MAX_ZOOM,
    });
    expect(teto.zoom).toBeCloseTo(MAX_ZOOM, 6);
  });

  it("a janela da parada acompanha a duração do vídeo", () => {
    expect(stopSpan(14)).toBeGreaterThan(stopSpan(30));
    expect(stopBoost(0.5, [], 14)).toBe(0);
    expect(stopBoost(0.9, [0.5], 14)).toBe(0);
    expect(stopBoost(0.5, [Number.NaN, 0.5], 14)).toBeCloseTo(1, 6);
  });
});

describe("quando não vale", () => {
  it("no modo “Rota toda” nada muda, mesmo com tudo ligado", () => {
    const t = alvo(0.5, 0, {
      mode: "fit",
      cinematic: { opening: true, stops: true, stopTs: [0.5] },
    });
    expect(t.zoom).toBeCloseTo(fitZ, 6);
    expect(t.boost).toBe(0);
    expect(t.opening).toBe(1);
  });

  it("sem paradas marcadas não há aproximação nenhuma", () => {
    const t = alvo(0.5, 5, { cinematic: { stops: true, stopTs: [] } });
    expect(t.boost).toBe(0);
    expect(t.zoom).toBeCloseTo(16, 6);
  });

  it("o centro acompanha o personagem depois de pousar", () => {
    const inicio = alvo(0, 5, { cinematic: { opening: true } });
    const fim = alvo(1, 5, { cinematic: { opening: true } });
    expect(fim.lat).toBeGreaterThan(inicio.lat);
  });
});
