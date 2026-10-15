import { describe, expect, it } from "vitest";
import { buildTrack, fitZoom, boundsOf } from "./geo";
import {
  CHASE_ZOOM,
  OPEN_CAP_S,
  STOP_BOOST,
  cameraTarget,
  openingProgress,
  openingSeconds,
  stopBoost,
  stopFocus,
  stopSpan,
  zoomEfetivo,
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
  patch: {
    cinematic?: Partial<CinematicConfig>;
    followZoom?: number;
    mode?: "fit" | "follow";
    chase?: { gira: boolean };
  } = {},
  extra: { routeSeconds?: number; stopPos?: (ts: number) => { lat: number; lng: number } | null } = {},
) =>
  cameraTarget({
    track,
    t,
    camera: {
      mode: patch.mode ?? "follow",
      followZoom: patch.followZoom ?? 16,
      cinematic: cine(patch.cinematic),
      chase: patch.chase,
    },
    width: W,
    height: H,
    maxZoom: MAX_ZOOM,
    elapsed,
    duration: 14,
    ...extra,
  });

/** Onde o traçado está no progresso `ts` (a parada do teste). */
const ponto = (ts: number) => {
  const pts = track.pts;
  const i = Math.min(pts.length - 1, Math.max(0, Math.round(ts * (pts.length - 1))));
  return { lat: pts[i].lat, lng: pts[i].lng };
};

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

describe("foco na parada (9:16)", () => {
  const PARADA = 0.5;
  const posParada = ponto(PARADA);

  it("leva a parada ao centro no momento da passagem", () => {
    // o personagem continua sendo o alvo padrão; a parada vira o alvo quando
    // ela é o assunto do quadro. No 9:16 o quadro é estreito: com o personagem
    // sempre no centro, a parada (e a foto com o nome) saía pela borda.
    const emCima = alvo(PARADA, 5, { cinematic: { stops: true, stopTs: [PARADA] } }, {
      stopPos: ponto,
    });
    const semFoco = alvo(PARADA, 5, {}, { stopPos: ponto });
    expect(emCima.lat).toBeCloseTo(posParada.lat, 9);
    expect(emCima.lng).toBeCloseTo(posParada.lng, 9);
    // e é mesmo diferente de seguir o personagem
    expect(Math.abs(emCima.lat - semFoco.lat)).toBeGreaterThan(1e-6);
  });

  it("no meio do caminho entre personagem e parada, se aproximando", () => {
    const ts = PARADA - stopSpan(14) * 0.5; // meia janela antes
    const meia = alvo(ts, 5, { cinematic: { stops: true, stopTs: [PARADA] } }, { stopPos: ponto });
    const posPersonagem = ponto(ts);
    expect(meia.boost).toBeCloseTo(0.5, 6);
    // fica entre os dois — nem no personagem, nem na parada
    expect(meia.lat).toBeGreaterThan(Math.min(posPersonagem.lat, posParada.lat));
    expect(meia.lat).toBeLessThan(Math.max(posPersonagem.lat, posParada.lat));
  });

  it("a janela do foco é medida no percurso, não no vídeo", () => {
    // com um vídeo de 20 s e 13 s de percurso, a mesma parada tem que ser
    // focada na mesma fração do percurso (é o que o vídeo mostra)
    const cineStops = { stops: true, stopTs: [PARADA] };
    const videoLongo = alvo(PARADA, 5, { cinematic: cineStops }, { routeSeconds: 20, stopPos: ponto });
    const percursoCurto = alvo(PARADA, 5, { cinematic: cineStops }, { routeSeconds: 10, stopPos: ponto });
    expect(videoLongo.boost).toBeCloseTo(1, 6);
    expect(percursoCurto.boost).toBeCloseTo(1, 6);
    // e a janela acompanha o percurso: meia janela antes, a força é a mesma
    const meiaLongo = alvo(PARADA - stopSpan(20) * 0.5, 5, { cinematic: cineStops }, {
      routeSeconds: 20,
      stopPos: ponto,
    });
    const meiaCurto = alvo(PARADA - stopSpan(10) * 0.5, 5, { cinematic: cineStops }, {
      routeSeconds: 10,
      stopPos: ponto,
    });
    expect(meiaLongo.boost).toBeCloseTo(meiaCurto.boost, 6);
  });

  it("sem saber onde a parada está, não há deslocamento (mas o zoom de ênfase fica)", () => {
    // `stopPos` é o que permite ir até a parada; sem ele, o comportamento é o
    // antigo — e nenhum teste depende de geografia
    const semPonto = alvo(PARADA, 5, { cinematic: { stops: true, stopTs: [PARADA] } });
    const semNada = alvo(PARADA, 5, {});
    expect(semPonto.boost).toBeCloseTo(1, 6);
    expect(semPonto.zoom).toBeGreaterThan(semNada.zoom);
    expect(semPonto.lat).toBeCloseTo(semNada.lat, 9);
  });

  it("`stopFocus` diz qual parada está focada (e `stopBoost` continua valendo)", () => {
    const entre = stopFocus(PARADA, [0.2, PARADA], 14);
    expect(entre.ts).toBe(PARADA);
    expect(entre.forca).toBeCloseTo(1, 6);
    expect(stopFocus(0.9, [0.2, PARADA], 14)).toEqual({ forca: 0, ts: null });
    expect(stopBoost(PARADA, [PARADA], 14)).toBeCloseTo(1, 6);
  });
});

/* ------------------------------------------------------------------ */
/* Chegada com ênfase e terceira pessoa                                */
/* ------------------------------------------------------------------ */

describe("a chegada tem o seu momento de câmera", () => {
  it("com `chegada`, o fim do percurso aproxima como uma parada", () => {
    const sem = alvo(1, 20, { cinematic: { stops: true, stopTs: [0.5] } });
    const com = alvo(1, 20, { cinematic: { stops: true, stopTs: [0.5], chegada: true } });
    expect(sem.boost).toBe(0);
    expect(com.boost).toBeCloseTo(1, 2);
    expect(com.zoom).toBeCloseTo(sem.zoom + STOP_BOOST, 2);
  });

  it("e o ênfase da chegada só aparece perto do fim", () => {
    const meio = alvo(0.5, 20, { cinematic: { stops: true, stopTs: [], chegada: true } });
    expect(meio.boost).toBe(0);
    const chegando = alvo(
      0.97,
      20,
      { cinematic: { stops: true, stopTs: [], chegada: true } },
      { routeSeconds: 20 },
    );
    expect(chegando.boost).toBeGreaterThan(0.5);
  });

  it("desligado, nada muda", () => {
    const a = alvo(1, 20, { cinematic: { stops: true, stopTs: [0.5], chegada: false } });
    const b = alvo(1, 20, { cinematic: { stops: true, stopTs: [0.5] } });
    expect(a.zoom).toBe(b.zoom);
  });
});

describe("terceira pessoa", () => {
  it("a câmera chega mais perto (é o que dá o “atrás”)", () => {
    expect(zoomEfetivo({ followZoom: 16 })).toBe(16);
    expect(zoomEfetivo({ followZoom: 16, chase: { gira: false } })).toBeCloseTo(16 + CHASE_ZOOM, 6);
  });

  it("e o alvo segue o personagem, como no acompanhamento de sempre", () => {
    const normal = alvo(0.4, 6, { cinematic: { stops: true, stopTs: [] } });
    const terceira = alvo(0.4, 6, {
      cinematic: { stops: true, stopTs: [] },
      chase: { gira: true },
    });
    expect(terceira.lat).toBeCloseTo(normal.lat, 6);
    expect(terceira.lng).toBeCloseTo(normal.lng, 6);
    expect(terceira.zoom).toBeCloseTo(normal.zoom + CHASE_ZOOM, 6);
  });
});
