import { describe, expect, it } from "vitest";
import { buildTrack, fitZoom, boundsOf } from "./geo";
import {
  CHASE_ZOOM,
  OPEN_CAP_S,
  RAIO_DO_PAR,
  STOP_BOOST,
  boostQueCabe,
  cameraTarget,
  janelaDaEnfase,
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
  });

  it("já está andando no primeiro quadro", () => {
    /*
     * A curva antiga (`easeInOutCubic`) partia do repouso: no primeiro quadro a
     * câmera estava parada, e no feed é esse quadro que aparece antes do play.
     * O pedido é que o vídeo abra em movimento.
     */
    const total = openingSeconds(14);
    const quadro = 1 / 30;
    const andou = openingProgress(quadro, 14) - openingProgress(0, 14);
    // velocidade do primeiro quadro, comparada com a média do voo (era ~8% dela)
    const velocidade = andou / quadro;
    const media = 1 / total;
    expect(velocidade).toBeGreaterThan(media * 0.95);
    expect(andou).toBeGreaterThan(0);
    // e o mesmo vale olhando o alvo da câmera: o zoom já mudou no primeiro quadro
    const z0 = alvo(0, 0, { cinematic: { opening: true } }).zoom;
    const z1 = alvo(0, quadro, { cinematic: { opening: true } }).zoom;
    expect(z1 - z0).toBeGreaterThan(0.02);
    expect(total).toBeGreaterThan(quadro);
  });

  it("a curva é monótona e não passa do fim", () => {
    // sem ida e volta e sem estourar: o voo nunca anda para trás nem passa do
    // enquadramento de acompanhamento
    let anterior = -1;
    for (let i = 0; i <= 200; i++) {
      const p = openingProgress((i / 200) * openingSeconds(14), 14);
      expect(p).toBeGreaterThanOrEqual(anterior);
      expect(p).toBeLessThanOrEqual(1 + 1e-9);
      anterior = p;
    }
  });

  it("chega devagar: o pouso não é um corte", () => {
    const total = openingSeconds(14);
    const quadro = 1 / 30;
    const ultimoPasso = 1 - openingProgress(total - quadro, 14);
    // no último quadro anda menos de um quinto do que andou no primeiro
    const primeiroPasso = openingProgress(quadro, 14);
    expect(ultimoPasso).toBeLessThan(primeiroPasso / 5);
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

  it("a aproximação é forte o bastante para o ponto chegar perto", () => {
    /*
     * O pedido: "a visão cinematográfica mais perto do ponto com um zoom". O
     * número tem de ser **absoluto** aqui — um teste que só compare com
     * `STOP_BOOST` passa com qualquer valor, inclusive com uma aproximação que
     * não se percebe (era 1,4: 1,4x mais perto, que o usuário não viu).
     */
    expect(STOP_BOOST).toBeGreaterThanOrEqual(2);
    const emCima = alvo(0.5, 5, { cinematic: { stops: true, stopTs: [0.5] } });
    // cada nível de zoom dobra a escala: 2 níveis = 4x maior na tela
    expect(emCima.zoom - 16).toBeGreaterThanOrEqual(2);
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

  it("com muitas paradas a janela encolhe — e sobra rota sem ênfase entre elas", () => {
    /*
     * O caso que o usuário viu ("a parada cinematográfica está sendo muito antes
     * do ponto"): oito paradas numa rota de 21 km e um vídeo de 14 s (percurso de
     * 7,2 s). A janela pedida (~1,6 s de percurso) dava **12% da rota** — 2,5 km
     * de cada lado, mais largo que a distância entre as paradas. Medido na
     * bancada: o zoom entrava em 2,6 s e ia até o fim do vídeo, com o máximo em
     * todas as paradas e ~56% de zoom ainda entre elas — a visão aproximada já
     * estava na tela muito antes de o personagem chegar em qualquer ponto.
     *
     * Com o teto pela contagem, cada parada ocupa ~4% de cada lado e o zoom
     * **volta a zero** no meio do caminho entre duas paradas.
     */
    const percurso = 7.2;
    const oito = Array.from({ length: 8 }, (_, i) => (i + 1) / 9);
    const janela = janelaDaEnfase(percurso, oito.length);
    expect(janela).toBeLessThan(stopSpan(percurso)); // era a pedida: 12% da rota
    expect(2 * janela).toBeLessThan(1 / oito.length); // e cabe entre duas paradas

    // em cima do ponto, a ênfase é inteira
    expect(stopFocus(oito[0], oito, percurso).forca).toBeCloseTo(1, 6);
    // no meio do caminho, nenhuma — nem no foco, nem no zoom da câmera
    const meio = (oito[0] + oito[1]) / 2;
    const entre = stopFocus(meio, oito, percurso);
    expect(entre.forca).toBe(0);
    expect(entre.ts).toBeNull();
    const alvoEntre = alvo(meio, 5, { cinematic: { stops: true, stopTs: oito } });
    expect(alvoEntre.boost).toBe(0);
    expect(alvoEntre.zoom).toBeCloseTo(16, 6);
  });

  it("com poucas paradas a janela é a pedida (a ênfase não muda)", () => {
    // sem vizinha de quem se aproximar, uma parada (ou duas) não muda nada
    expect(janelaDaEnfase(7.2, 1)).toBeCloseTo(stopSpan(7.2), 9);
    expect(janelaDaEnfase(7.2, 2)).toBeCloseTo(stopSpan(7.2), 9);
    // e a chegada conta como parada: oito paradas mais a chegada = nove janelas
    expect(janelaDaEnfase(7.2, 9)).toBeLessThan(janelaDaEnfase(7.2, 8));
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

describe("o ganho de zoom da parada cabe no quadro", () => {
  /* 720x1280 como no vídeo do usuário; a linha está na latitude de São Paulo */
  const W2 = 720;
  const H2 = 1280;
  const SP = -23.5;
  const camera = { followZoom: 15, chase: { gira: false } };

  it("na linha, é o ganho cheio (nada muda no caso comum)", () => {
    for (const m of [0, 5, 20]) {
      expect(boostQueCabe(camera, W2, H2, m, SP)).toBeCloseTo(STOP_BOOST, 6);
    }
  });

  it("longe da linha, o ganho encolhe até o personagem caber no quadro", () => {
    /*
     * Medido: com 300 m entre o personagem e o pino, em 720x1280, o quadro
     * aguenta ~1,1 nível a mais de zoom (o ganho cheio é 2,2). Foi assim que o
     * vídeo do usuário perdeu o personagem na parada: o pino da capela está a
     * centenas de metros da linha, e o ganho cheio punha o personagem fora da
     * tela.
     */
    const b300 = boostQueCabe(camera, W2, H2, 300, SP);
    expect(b300).toBeGreaterThan(0);
    expect(b300).toBeLessThan(STOP_BOOST);
    // e o que sobra é exatamente o que cabe: a distância vira o raio reservado
    const base = 15 + CHASE_ZOOM;
    const metrosPorPixel = (156543.0339 * Math.cos((SP * Math.PI) / 180)) / 2 ** (base + b300);
    expect(300 / metrosPorPixel).toBeCloseTo(RAIO_DO_PAR * W2, 0);
  });

  it("nunca fica abaixo do zoom normal (a ênfase não afasta a câmera)", () => {
    // pino a 5 km da linha: não cabe nenhum ganho — e o zoom fica o de sempre
    expect(boostQueCabe(camera, W2, H2, 5000, SP)).toBe(0);
  });

  it("quem manda é o menor lado do quadro (é ele que o personagem atravessa)", () => {
    // retrato é limitado pela largura, paisagem pela altura: os dois têm 720 no
    // menor lado e cabem o mesmo zoom
    expect(boostQueCabe(camera, 1280, 720, 300, SP)).toBeCloseTo(
      boostQueCabe(camera, W2, H2, 300, SP),
      9,
    );
    // num quadro maior (1080x1080) cabe mais
    expect(boostQueCabe(camera, 1080, 1080, 300, SP)).toBeGreaterThan(
      boostQueCabe(camera, W2, H2, 300, SP),
    );
  });
});
