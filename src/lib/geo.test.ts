import { describe, expect, it } from "vitest";
import {
  SHARP_TURN_DEG,
  SMOOTH_PASSES,
  SMOOTH_WINDOW_M,
  TRACK_POINT_LIMIT,
  TURN_SPAN_M,
  bearing,
  buildTrack,
  completarTrilha,
  cumulative,
  fitZoom,
  formatDistance,
  formatTime,
  haversine,
  measuredCumulative,
  nearestTOnTrack,
  nudge,
  pontoValido,
  project,
  sampleTrack,
  smoothedPoints,
  unproject,
  visibleRuns,
  type LatLng,
} from "./geo";

describe("haversine", () => {
  it("mede um grau de latitude (~111 km)", () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("é zero para o mesmo ponto", () => {
    expect(haversine({ lat: -23.5, lng: -48.4 }, { lat: -23.5, lng: -48.4 })).toBe(0);
  });

  it("é simétrica", () => {
    const a = { lat: -23.5613, lng: -46.6565 };
    const b = { lat: -22.9711, lng: -43.1822 };
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
  });
});

describe("bearing", () => {
  it("aponta para o norte", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 4);
  });

  it("aponta para o leste", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 4);
  });

  it("aponta para o sul", () => {
    expect(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }))).toBeCloseTo(180, 4);
  });
});

describe("buildTrack", () => {
  it("acumula distância a partir de zero", () => {
    const t = buildTrack([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 2, lng: 0 },
    ]);
    expect(t.cum[0]).toBe(0);
    expect(t.cum).toHaveLength(3);
    expect(t.total).toBeCloseTo(t.cum[2], 6);
    // a distância acumulada nunca diminui
    for (let i = 1; i < t.cum.length; i++) {
      expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1]);
    }
  });

  it("aguenta lista vazia e lista de um ponto", () => {
    // cum sempre começa em 0, mesmo sem pontos — sampleTrack nem chega a usá-lo
    expect(buildTrack([])).toEqual({ pts: [], cum: [0], total: 0 });
    const one = buildTrack([{ lat: 1, lng: 2 }]);
    expect(one.total).toBe(0);
    expect(one.pts).toHaveLength(1);
  });

  it("reduz trilhas muito longas preservando as pontas", () => {
    const input = Array.from({ length: TRACK_POINT_LIMIT + 500 }, (_, i) => ({
      lat: -23 + i * 0.0001,
      lng: -48,
    }));
    const t = buildTrack(input);
    expect(t.pts.length).toBeLessThanOrEqual(TRACK_POINT_LIMIT);
    expect(t.pts.length).toBeLessThan(input.length);
    expect(t.pts[0]).toEqual(input[0]);
    expect(t.pts[t.pts.length - 1]).toEqual(input[input.length - 1]);
  });

  it("deixa passar intacta uma trilha de GPS comum", () => {
    // uma pedalada de 1 h a 1 ponto/s dá ~3.600 pontos: antes isso era
    // decimado para 1.200 e a rota ficava angulosa
    const pedalada = Array.from({ length: 3600 }, (_, i) => ({
      lat: -23.5 + Math.sin(i / 200) * 0.02,
      lng: -48.4 + Math.cos(i / 200) * 0.02,
    }));
    expect(buildTrack(pedalada).pts).toHaveLength(3600);
  });

  it("o teto comporta arquivos de GPS longos", () => {
    expect(TRACK_POINT_LIMIT).toBeGreaterThanOrEqual(10_000);
  });
});

describe("sampleTrack", () => {
  const track = buildTrack([
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ]);

  it("devolve as pontas em t=0 e t=1", () => {
    expect(sampleTrack(track, 0).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(track, 1).pos).toEqual({ lat: 1, lng: 0 });
  });

  it("interpola no meio", () => {
    const mid = sampleTrack(track, 0.5).pos;
    expect(mid.lat).toBeCloseTo(0.5, 6);
    expect(mid.lng).toBeCloseTo(0, 6);
  });

  it("prende t fora de 0..1", () => {
    expect(sampleTrack(track, -5).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(track, 9).pos).toEqual({ lat: 1, lng: 0 });
  });

  it("trata t inválido sem quebrar", () => {
    expect(sampleTrack(track, NaN).pos).toEqual({ lat: 0, lng: 0 });
  });

  it("não quebra com trilha vazia ou de um ponto", () => {
    expect(sampleTrack(buildTrack([]), 0.5).pos).toEqual({ lat: 0, lng: 0 });
    expect(sampleTrack(buildTrack([{ lat: 5, lng: 6 }]), 0.5).pos).toEqual({ lat: 5, lng: 6 });
  });
});

describe("fitZoom", () => {
  it("aproxima mais quando a área é menor", () => {
    const small = fitZoom({ north: 1, south: 0, east: 1, west: 0 }, 1280, 720);
    const large = fitZoom({ north: 40, south: -40, east: 40, west: -40 }, 1280, 720);
    expect(small).toBeGreaterThan(large);
  });

  it("encaixa uma área larga melhor num quadro largo", () => {
    const wide = { north: 0.1, south: -0.1, east: 10, west: -10 };
    expect(fitZoom(wide, 1280, 720)).toBeGreaterThan(fitZoom(wide, 720, 1280));
  });

  it("encaixa uma área alta melhor num quadro em pé", () => {
    const tall = { north: 10, south: -10, east: 0.1, west: -0.1 };
    expect(fitZoom(tall, 720, 1280)).toBeGreaterThan(fitZoom(tall, 1280, 720));
  });

  it("nunca devolve zoom negativo", () => {
    const mundo = { north: 85, south: -85, east: 180, west: -180 };
    expect(fitZoom(mundo, 320, 200)).toBeGreaterThanOrEqual(0);
  });
});

describe("nearestTOnTrack", () => {
  const track = buildTrack([
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ]);

  it("encontra o ponto sobre a linha", () => {
    const r = nearestTOnTrack(track, { lat: 0.5, lng: 0 });
    expect(r.t).toBeCloseTo(0.5, 3);
    expect(r.offset).toBeLessThan(1);
  });

  it("mede o afastamento de um ponto fora da linha", () => {
    const r = nearestTOnTrack(track, { lat: 0.5, lng: 0.01 });
    expect(r.offset).toBeGreaterThan(500);
    expect(r.t).toBeCloseTo(0.5, 2);
  });
});

describe("nudge", () => {
  it("desloca ~1000 m para o norte", () => {
    const p = nudge({ lat: 0, lng: 0 }, 0, 1000);
    expect(p.lat).toBeCloseTo(1000 / 111320, 6);
    expect(p.lng).toBeCloseTo(0, 9);
  });

  it("é reversível", () => {
    const p = nudge(nudge({ lat: -23.5, lng: -48.4 }, 250, 0), -250, 0);
    expect(p.lat).toBeCloseTo(-23.5, 9);
    expect(p.lng).toBeCloseTo(-48.4, 9);
  });
});

describe("formatadores", () => {
  it("formata distância em metros e quilômetros", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toMatch(/^1 km$/);
    expect(formatDistance(1500)).toMatch(/^1[.,]5 km$/);
  });

  it("devolve travessão para distância inválida", () => {
    expect(formatDistance(NaN)).toBe("—");
    expect(formatDistance(Infinity)).toBe("—");
  });

  it("formata tempo como mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(-5)).toBe("00:00");
  });
});

describe("unproject", () => {
  it("é o inverso exato de project", () => {
    for (const [lat, lng, z] of [
      [-23.4903, -48.4128, 16],
      [0, 0, 0],
      [51.5074, -0.1278, 12],
      [-33.8688, 151.2093, 9],
      [64.1466, -21.9426, 18],
    ] as [number, number, number][]) {
      const p = project(lat, lng, z);
      const volta = unproject(p.x, p.y, z);
      expect(volta.lat).toBeCloseTo(lat, 6);
      expect(volta.lng).toBeCloseTo(lng, 6);
    }
  });

  it("devolve o ponto certo nos cantos do mundo", () => {
    const n = 256 * Math.pow(2, 3);
    expect(unproject(0, 0, 3).lng).toBeCloseTo(-180, 6);
    expect(unproject(n, 0, 3).lng).toBeCloseTo(180, 6);
    // y=0 é o topo do Mercator, y=n é a base
    expect(unproject(0, 0, 3).lat).toBeGreaterThan(85);
    expect(unproject(0, n, 3).lat).toBeLessThan(-85);
  });

  it("acompanha o zoom", () => {
    const z10 = project(-23.5, -48.4, 10);
    const z16 = project(-23.5, -48.4, 16);
    // no mesmo pixel do mundo, cada zoom aponta para um lugar diferente
    expect(unproject(z10.x, z10.y, 10).lat).toBeCloseTo(-23.5, 6);
    expect(unproject(z16.x, z16.y, 16).lat).toBeCloseTo(-23.5, 6);
  });
});

describe("visibleRuns", () => {
  /** Linha reta com n pontos, de oeste para leste. */
  const linha = (n: number, lngIni = 0, lngFim = 1): LatLng[] =>
    Array.from({ length: n }, (_, i) => ({
      lat: 0,
      lng: lngIni + ((lngFim - lngIni) * i) / (n - 1),
    }));

  const janela = (oeste: number, leste: number, sul = -1, norte = 1) => ({
    north: norte,
    south: sul,
    east: leste,
    west: oeste,
  });

  it("devolve tudo quando a janela cobre o traçado", () => {
    expect(visibleRuns(linha(10), janela(-1, 2))).toEqual([[0, 9]]);
  });

  it("devolve nada quando o traçado está fora", () => {
    expect(visibleRuns(linha(10), janela(50, 60))).toEqual([]);
  });

  it("recorta a faixa de índices que aparece", () => {
    const runs = visibleRuns(linha(101), janela(0.4, 0.6));
    expect(runs).toHaveLength(1);
    const [ini, fim] = runs[0];
    // o índice 40 está em lng 0,4 e o 60 em 0,6
    expect(ini).toBeGreaterThanOrEqual(39);
    expect(ini).toBeLessThanOrEqual(40);
    expect(fim).toBeGreaterThanOrEqual(60);
    expect(fim).toBeLessThanOrEqual(61);
  });

  it("inclui o segmento que atravessa a janela com as pontas fora", () => {
    // dois pontos distantes: nenhum está dentro, mas a linha entre eles cruza
    const pts = [
      { lat: 0, lng: -10 },
      { lat: 0, lng: 10 },
    ];
    expect(visibleRuns(pts, janela(-1, 1))).toEqual([[0, 1]]);
  });

  it("devolve várias faixas quando o traçado sai e volta", () => {
    // "U": entra, sai pela direita, volta
    const pts: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.5 },
      { lat: 50, lng: 0.5 },
      { lat: 50, lng: 1.5 },
      { lat: 0, lng: 1.5 },
      { lat: 0, lng: 0.5 },
    ];
    const runs = visibleRuns(pts, janela(-1, 1));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    // as pontas de cada faixa são índices válidos, em ordem crescente
    let anterior = -1;
    for (const [ini, fim] of runs) {
      expect(ini).toBeGreaterThanOrEqual(0);
      expect(fim).toBeLessThan(pts.length);
      expect(ini).toBeLessThanOrEqual(fim);
      expect(ini).toBeGreaterThan(anterior);
      anterior = ini;
    }
  });

  it("respeita o índice final (trecho percorrido)", () => {
    const runs = visibleRuns(linha(100), janela(-1, 2), 30);
    expect(runs).toEqual([[0, 30]]);
    // nenhuma faixa passa do limite pedido
    for (const [, fim] of runs) expect(fim).toBeLessThanOrEqual(30);
  });

  it("devolve tudo com a janela do mundo inteiro", () => {
    expect(visibleRuns(linha(10), janela(-180, 180, -90, 90))).toEqual([[0, 9]]);
  });

  it("considera as quatro bordas da caixa", () => {
    const pts = linha(10); // lat 0, lng 0..1
    expect(visibleRuns(pts, janela(0.5, 2, 10, 20))).toEqual([]); // acima
    expect(visibleRuns(pts, janela(0.5, 2, -20, -10))).toEqual([]); // abaixo
    expect(visibleRuns(pts, janela(5, 6))).toEqual([]); // à direita
    expect(visibleRuns(pts, janela(-2, -1))).toEqual([]); // à esquerda
  });

  it("aguenta entradas degeneradas", () => {
    expect(visibleRuns([], janela(-1, 1))).toEqual([]);
    expect(visibleRuns([{ lat: 0, lng: 0 }], janela(-1, 1))).toEqual([]);
    expect(visibleRuns(linha(2), janela(-1, 1), 0)).toEqual([]);
  });

  it("todas as faixas são válidas para desenhar", () => {
    const pts = linha(1000);
    const runs = visibleRuns(pts, janela(0.2, 0.3));
    expect(runs.length).toBeGreaterThan(0);
    for (const [ini, fim] of runs) {
      expect(pts[ini]).toBeDefined();
      expect(pts[fim]).toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Medida do arquivo: o ruído do GPS infla a distância                */
/* ------------------------------------------------------------------ */

const GRAU_POR_METRO = 1 / 111_320;

/** Reta para leste, com um ponto a cada `passoM` metros. */
function reta(metros: number, passoM: number): LatLng[] {
  return Array.from({ length: Math.floor(metros / passoM) + 1 }, (_, i) => ({
    lat: 0,
    lng: i * passoM * GRAU_POR_METRO,
  }));
}

/**
 * Rua de cidade: 90° a cada `segM` metros.
 *
 * Não é um traçado de GPS — é o caso em que a **curva é verdade**, e não ruído.
 */
function ruaDeCidade(metros: number, passoM: number, segM: number): LatLng[] {
  const pts: LatLng[] = [];
  const passosPorTrecho = Math.max(1, Math.round(segM / passoM));
  let lat = 0;
  let lng = 0;
  let dir = 0;
  for (let i = 0; i * passoM <= metros; i++) {
    pts.push({ lat, lng });
    if (dir % 2 === 0) lng += passoM * GRAU_POR_METRO;
    else lat += passoM * GRAU_POR_METRO;
    if ((i + 1) % passosPorTrecho === 0) dir++;
  }
  return pts;
}

/**
 * Rua de cidade com **esquina arredondada** (raio `raio`), que é como esquina de
 * rua é de verdade.
 *
 * É o caso que separa os dois defeitos do filtro: a janela larga atravessando a
 * curva (distância inventada) e a guarda cega para a boca da curva (distância
 * comida). Pontos de 10° no arco, como num arquivo real.
 */
function ruaArredondada(metros: number, passoM: number, segM: number, raio: number): LatLng[] {
  const pts: LatLng[] = [{ lat: 0, lng: 0 }];
  let lat = 0;
  let lng = 0;
  let rumo = 0;
  const anda = (graus: number, d: number) => {
    const rad = (graus * Math.PI) / 180;
    lng += Math.sin(rad) * d * GRAU_POR_METRO;
    lat += Math.cos(rad) * d * GRAU_POR_METRO;
    pts.push({ lat, lng });
  };
  const arco = (Math.PI * raio) / 2;
  let percorrido = 0;
  while (percorrido < metros) {
    const retas = Math.max(1, Math.round((segM - arco) / passoM));
    for (let i = 0; i < retas && percorrido < metros; i++) {
      anda(rumo, passoM);
      percorrido += passoM;
    }
    for (let a = 0; a < 90 && percorrido < metros; a += 10) {
      const d = arco / 9;
      anda(rumo + a, d);
      percorrido += d;
    }
    rumo += 90;
  }
  return pts;
}

/**
 * Ruído de GPS correlacionado (AR(1)).
 *
 * O erro do GPS **não** é independente ponto a ponto: ele vagueia. É esse
 * vaivém lento que infla a soma, e é o que os aplicativos de treino filtram.
 * Semente fixa para o teste não piscar.
 */
function comRuido(pts: LatLng[], sigmaM: number, semente = 42, rho = 0.85): LatLng[] {
  let estado = semente;
  const rnd = () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const inova = Math.sqrt(1 - rho * rho);
  let aLat = 0;
  let aLng = 0;
  return pts.map((p) => {
    // o erro é por **amostra** (não por metro): 1 Hz e 10 Hz erram igual
    aLat = aLat * rho + gauss() * sigmaM * inova * GRAU_POR_METRO;
    aLng = aLng * rho + gauss() * sigmaM * inova * GRAU_POR_METRO;
    return { lat: p.lat + aLat, lng: p.lng + aLng };
  });
}

const erro = (medido: number, verdade: number) => (medido / verdade - 1) * 100;

describe("medida do arquivo (filtro de GPS)", () => {
  it("numa reta limpa, mede exatamente o mesmo", () => {
    // a média de pontos que estão numa reta cai na própria reta: nada muda
    const limpa = reta(21_370, 5);
    const verdade = cumulative(limpa).at(-1) ?? 0;
    expect(measuredCumulative(limpa).at(-1) ?? 0).toBeCloseTo(verdade, 6);
    expect(buildTrack(limpa).total).toBeCloseTo(verdade, 6);
  });

  it("sem filtro o ruído infla a distância; com filtro, quase não", () => {
    // é o defeito do vídeo: 21,37 km no Strava viravam ~21,8 km aqui, e o ritmo
    // saía 4:56 em vez de 5:02
    const limpa = reta(21_370, 5);
    const verdade = cumulative(limpa).at(-1) ?? 0;
    const suja = comRuido(limpa, 2.0);
    const cru = cumulative(suja).at(-1) ?? 0;
    const filtrado = measuredCumulative(suja).at(-1) ?? 0;

    // o cenário tem o defeito (senão o teste não teria dentes)
    expect(erro(cru, verdade)).toBeGreaterThan(1.5);
    // e o filtro tira a maior parte dele
    expect(Math.abs(erro(filtrado, verdade))).toBeLessThan(1.2);
    expect(erro(filtrado, verdade)).toBeLessThan(erro(cru, verdade) / 2);
  });

  it("quanto mais ruído, mais o filtro trabalha", () => {
    const limpa = reta(21_370, 5);
    const verdade = cumulative(limpa).at(-1) ?? 0;
    for (const sigma of [1.0, 2.0, 3.0]) {
      const suja = comRuido(limpa, sigma, 7 + sigma * 10);
      const cru = erro(cumulative(suja).at(-1) ?? 0, verdade);
      const filtrado = erro(measuredCumulative(suja).at(-1) ?? 0, verdade);
      expect(cru).toBeGreaterThan(0);
      expect(filtrado).toBeLessThan(cru);
      expect(Math.abs(filtrado)).toBeLessThan(3);
    }
  });

  it("não come esquina de rua: curva de 90° é caminho, não ruído", () => {
    // a média móvel sozinha cortava a esquina e a rua de cidade media 2,1% menos
    const rua = ruaDeCidade(21_370, 5, 120);
    const verdade = cumulative(rua).at(-1) ?? 0;
    expect(measuredCumulative(rua).at(-1) ?? 0).toBeCloseTo(verdade, 6);
  });

  it("e resolve os dois ao mesmo tempo: rua com ruído", () => {
    const rua = ruaDeCidade(21_370, 5, 120);
    const verdade = cumulative(rua).at(-1) ?? 0;
    const suja = comRuido(rua, 2.5, 11);
    const cru = erro(cumulative(suja).at(-1) ?? 0, verdade);
    const filtrado = erro(measuredCumulative(suja).at(-1) ?? 0, verdade);
    expect(cru).toBeGreaterThan(1.5); // o ruído infla, como sempre
    expect(Math.abs(filtrado)).toBeLessThan(2.5);
    expect(filtrado).toBeLessThan(cru);
  });

  it("preserva as pontas e a elevação", () => {
    const pts = reta(1000, 5).map((p, i) => ({ ...p, ele: 700 + i }));
    const suave = smoothedPoints(pts);
    expect(suave[0]).toEqual(pts[0]);
    expect(suave.at(-1)).toEqual(pts.at(-1));
    expect(suave[7].ele).toBe(pts[7].ele);
  });

  it("a janela é medida em metros, não em pontos: densidade não muda a medida", () => {
    const denso = comRuido(reta(10_000, 2.5), 2.5, 5);
    const esparso = comRuido(reta(10_000, 10), 2.5, 5);
    const a = measuredCumulative(denso).at(-1) ?? 0;
    const b = measuredCumulative(esparso).at(-1) ?? 0;
    // 1 Hz e 10 Hz do mesmo percurso medem quase a mesma coisa
    expect(Math.abs(erro(a, b))).toBeLessThan(0.5);
  });

  it("o desenho continua sendo o arquivo, ponto a ponto", () => {
    const suja = comRuido(reta(5000, 5), 2);
    const t = buildTrack(suja);
    expect(t.pts).toHaveLength(suja.length);
    // exatamente as mesmas coordenadas do arquivo (nada suavizado no desenho)
    expect(t.pts[10]).toEqual(suja[10]);
    expect(t.pts.at(-1)).toEqual(suja.at(-1));
    // e o `cum` acompanha os pontos do desenho
    expect(t.cum).toHaveLength(t.pts.length);
    expect(t.cum[0]).toBe(0);
    for (let i = 1; i < t.cum.length; i++) {
      expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1]);
    }
  });

  it("pontas, listas curtas e janela zero não quebram", () => {
    expect(smoothedPoints([])).toEqual([]);
    expect(smoothedPoints([{ lat: 1, lng: 2 }])).toEqual([{ lat: 1, lng: 2 }]);
    const dois = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }];
    expect(smoothedPoints(dois)).toEqual(dois);
    // janela zero = sem filtro
    const suja = comRuido(reta(1000, 5), 2);
    expect(measuredCumulative(suja, 0).at(-1) ?? 0).toBeCloseTo(cumulative(suja).at(-1) ?? 0, 6);
  });

  it("curva de serra e esquina arredondada ficam inteiras", () => {
    // o que **não** pode ser comido: curva apertada de verdade
    const serra: LatLng[] = [{ lat: 0, lng: 0 }];
    {
      let lat = 0;
      let lng = 0;
      for (let a = 0; a < 180; a += 5) {
        const d = (2 * Math.PI * 20 * 5) / 360; // raio de 20 m, meia-volta
        const rad = (a * Math.PI) / 180;
        lng += Math.sin(rad) * d * GRAU_POR_METRO;
        lat += Math.cos(rad) * d * GRAU_POR_METRO;
        serra.push({ lat, lng });
      }
    }
    const vSerra = cumulative(serra).at(-1) ?? 0;
    expect(Math.abs(erro(measuredCumulative(serra).at(-1) ?? 0, vSerra))).toBeLessThan(0.05);

    // e a rua com esquina arredondada de raio 25 m (a boca da curva inclusive)
    const rua = ruaArredondada(5000, 5, 150, 25);
    const vRua = cumulative(rua).at(-1) ?? 0;
    for (const janela of [8, 20, 32, 50]) {
      expect(erro(measuredCumulative(rua, janela).at(-1) ?? 0, vRua)).toBeCloseTo(0, 2);
    }
  });

  it("o preço da janela de 50 m: serpentina longa e suave mede um pouco menos", () => {
    /*
     * 30 m de amplitude a cada 400 m é estrada sinuosa (raio ~600 m), e a janela
     * de 50 m corta 1,5% dela. Com a janela antiga de 8 m o erro era 0,04%, mas
     * a média não tirava o vaivém do GPS — e no arquivo real isso valia 0,8% de
     * distância, muito mais do que custa aqui. Fica registrado como limite.
     */
    const suave: LatLng[] = Array.from({ length: 4275 }, (_, i) => {
      const s = i * 5;
      return { lat: (30 * Math.sin((2 * Math.PI * s) / 400)) * GRAU_POR_METRO, lng: s * GRAU_POR_METRO };
    });
    const verdade = cumulative(suave).at(-1) ?? 0;
    const medido = measuredCumulative(suave).at(-1) ?? 0;
    expect(erro(medido, verdade)).toBeGreaterThan(-2);
    expect(erro(medido, verdade)).toBeLessThan(-1);
  });

  it("o vaivém do GPS não é confundido com curva (é para isso que o span é de 40 m)", () => {
    /*
     * Num arquivo denso com ruído grande, o giro medido num span curto é mentira
     * do sinal, e a guarda de curva acaba preservando o vaivém — o filtro para de
     * filtrar. Medido nesta mesma reta (um ponto a cada 2,5 m, ruído de ±2,5 m
     * correlacionado), com o span de 20 m o filtro media **+1,2%**; com 40 m,
     * −0,05%. É o span que separa as duas coisas: o erro do rumo cai com a
     * distância, o giro de uma curva de verdade não.
     */
    const suja = comRuido(reta(10_000, 2.5), 2.5, 99, 0.85);
    const medido = measuredCumulative(suja).at(-1) ?? 0;
    expect(Math.abs(erro(medido, 10_000))).toBeLessThan(0.5);
  });

  it("buildTrack mede com o filtro: é a distância que vai para o vídeo", () => {
    // sem este teste, `buildTrack` podia voltar a somar cru e o vídeo inteiro
    // (ritmo, distância do HUD, marcas de km) voltaria a mentir 2% para cima
    const limpa = reta(21_370, 5);
    const verdade = cumulative(limpa).at(-1) ?? 0;
    const suja = comRuido(limpa, 2.0);
    const t = buildTrack(suja);
    expect(t.total).toBeCloseTo(measuredCumulative(suja).at(-1) ?? 0, 6);
    expect(t.total).toBeLessThan((cumulative(suja).at(-1) ?? 0) - 100);
    expect(Math.abs(erro(t.total, verdade))).toBeLessThan(1.2);
  });

  it("a janela não atravessa a esquina: sem isso a rua limpa media 2,5% a mais", () => {
    /*
     * O defeito medido: perto de uma esquina, a média pegava pontos dos dois
     * lados dela e o traçado "estourava" ali — numa rua de cidade limpa (90° a
     * cada 200 m) a janela de 32 m inventava **+2,5%** de distância, sem uma
     * curva a mais para justificar. Travando a janela no ponto preservado, a
     * mesma rua mede exatamente o que o arquivo diz, em qualquer janela.
     */
    const rua = ruaArredondada(6000, 5, 200, 25);
    const verdade = cumulative(rua).at(-1) ?? 0;
    for (const janela of [8, 16, 32, 50]) {
      const medido = measuredCumulative(rua, janela).at(-1) ?? 0;
      expect(erro(medido, verdade)).toBeCloseTo(0, 2);
    }
  });

  it("o ponto da curva fica exatamente onde o arquivo pôs", () => {
    // a guarda preserva a coordenada; quem gira é só a vizinhança
    const rua = ruaArredondada(2000, 5, 200, 25);
    const suave = smoothedPoints(rua);
    const cum = cumulative(rua);
    let preservados = 0;
    for (const i of rua.map((_, k) => k)) {
      void cum;
      if (suave[i].lat === rua[i].lat && suave[i].lng === rua[i].lng) preservados++;
    }
    // retas e curvas têm pontos fixos; o que não pode é nenhum (a guarda morta)
    expect(preservados).toBeGreaterThan(rua.length * 0.2);
    expect(suave[0]).toEqual(rua[0]);
    expect(suave.at(-1)).toEqual(rua.at(-1));
  });

  it("as constantes do filtro são as medidas", () => {
    // se alguém mexer nelas, os números deste arquivo deixam de valer
    expect(SMOOTH_WINDOW_M).toBe(50);
    expect(SHARP_TURN_DEG).toBe(30);
    expect(TURN_SPAN_M).toBe(40);
    expect(SMOOTH_PASSES).toBe(2);
  });
});

/**
 * O ponto que chegou de fora sem coordenada.
 *
 * Foi este o erro que o usuário viu, sem saber de onde vinha: *"Algo travou no
 * app — Cannot read properties of undefined (reading 'lat')"*. O Leaflet lê
 * `.lat` direto de tudo que recebe, e um ponto faltando derruba o app inteiro —
 * então quem desenha pergunta antes, e o traçado não deixa passar.
 */
describe("o ponto que pode ser desenhado", () => {
  it("recusa o que não é coordenada", () => {
    expect(pontoValido(undefined)).toBe(false);
    expect(pontoValido(null)).toBe(false);
    expect(pontoValido({ lat: NaN, lng: -48 })).toBe(false);
    expect(pontoValido({ lat: -23, lng: Infinity })).toBe(false);
    expect(pontoValido({ lat: 91, lng: 0 })).toBe(false);
    expect(pontoValido({ lat: 0, lng: 200 })).toBe(false);
    // coordenada que veio como texto (JSON, link compartilhado): o ">="
    // sozinho aceitaria, porque ele converte a string em número
    expect(pontoValido({ lat: "-23.5", lng: -48.4 } as unknown as LatLng)).toBe(false);
    expect(pontoValido({ lat: -23.5, lng: "-48.4" } as unknown as LatLng)).toBe(false);
  });

  it("aceita a rota do usuário", () => {
    // o km 0 da Maratona de São Paulo, o ponto de partida do vídeo dele
    expect(pontoValido({ lat: -23.5505, lng: -46.6333 })).toBe(true);
    expect(pontoValido({ lat: -23.5505, lng: -46.6333, ele: 760 })).toBe(true);
    expect(pontoValido({ lat: 0, lng: 0 })).toBe(true);
  });
});

describe("o traçado joga fora o ponto estragado", () => {
  const bons: LatLng[] = [
    { lat: -23.5, lng: -48.4 },
    { lat: -23.51, lng: -48.41 },
    { lat: -23.52, lng: -48.42 },
  ];

  it("o ponto sem coordenada não entra nem desloca os outros", () => {
    const estragado = [
      bons[0],
      undefined as unknown as LatLng,
      { lat: NaN, lng: NaN } as LatLng,
      bons[1],
      bons[2],
    ];
    const t = buildTrack(estragado);
    expect(t.pts).toEqual(bons);
    expect(t.cum.length).toBe(3);
    // a medida é a mesma do traçado limpo: o ponto estragado não entra na conta
    expect(t.total).toBeCloseTo(buildTrack(bons).total, 6);
  });

  it("todos estragados: traçado vazio, sem estourar", () => {
    const t = buildTrack([
      undefined as unknown as LatLng,
      { lat: NaN, lng: 0 } as LatLng,
    ]);
    expect(t.pts).toEqual([]);
    expect(t.total).toBe(0);
    // e a amostra do traçado vazio continua respondendo (nada de `undefined.lat`)
    expect(sampleTrack(t, 0.5).pos).toEqual({ lat: 0, lng: 0 });
  });
});

/**
 * A trilha desenhada no mapa da prévia.
 *
 * Foi **esta** a linha do erro que o usuário viu, no rastro do "Copiar
 * detalhes": `setLatLngs` da trilha percorrida → `_projectLatlngs` → *"Cannot
 * read properties of undefined (reading 'lat')"*. A lista era cortada no ponto
 * atual, mas quando o índice **pulava à frente** (arrastar a barra, recomeçar, um
 * engasgo do navegador) o `length` era esticado e os pontos que faltavam viravam
 * **buracos** — e o Leaflet estoura ao projetar um buraco.
 */
describe("a trilha percorrida", () => {
  const rota: LatLng[] = Array.from({ length: 200 }, (_, i) => ({
    lat: -23.5 + i * 0.0001,
    lng: -48.4,
  }));
  const criar = (p: LatLng): LatLng => ({ ...p });
  /** nenhum índice vazio: `length` esticado deixa buracos que o Leaflet não lê */
  const buracos = (l: LatLng[]) => l.filter((_, i) => !(i in l)).length;

  it("anda para a frente um ponto por vez", () => {
    const pontos = rota.slice(0, 2).map(criar);
    completarTrilha(pontos, rota, 5, { lat: -23.4, lng: -48.4 }, criar);
    expect(pontos.length).toBe(7);
    expect(buracos(pontos)).toBe(0);
    expect(pontos.slice(0, 6)).toEqual(rota.slice(0, 6));
    // a ponta é o personagem, dentro do trecho
    expect(pontos[6]).toEqual({ lat: -23.4, lng: -48.4 });
  });

  it("um pulo à frente completa com o traçado, sem buraco", () => {
    const pontos = rota.slice(0, 3).map(criar);
    // a barra do tempo foi arrastada: o índice salta de 2 para 150
    completarTrilha(pontos, rota, 150, { lat: -23.4, lng: -48.4 }, criar);
    expect(pontos.length).toBe(152);
    expect(buracos(pontos)).toBe(0);
    expect(pontos.every(pontoValido)).toBe(true);
    expect(pontos[100]).toEqual(rota[100]);
    expect(pontos[151]).toEqual({ lat: -23.4, lng: -48.4 });
  });

  it("voltar atrás corta a trilha", () => {
    const pontos = rota.map(criar);
    completarTrilha(pontos, rota, 4, { lat: -23.4, lng: -48.4 }, criar);
    expect(pontos.length).toBe(6);
    expect(buracos(pontos)).toBe(0);
    expect(pontos[4]).toEqual(rota[4]);
  });

  it("índice fora da rota fica preso nas pontas", () => {
    const inicio: LatLng[] = [];
    completarTrilha(inicio, rota, -5, { lat: -23.4, lng: -48.4 }, criar);
    expect(inicio.length).toBe(2);
    expect(buracos(inicio)).toBe(0);

    const fim = rota.slice(0, 5).map(criar);
    completarTrilha(fim, rota, 9999, { lat: -23.4, lng: -48.4 }, criar);
    expect(fim.length).toBe(rota.length + 1);
    expect(buracos(fim)).toBe(0);
    expect(fim.every(pontoValido)).toBe(true);
  });

  it("índice que não é número não estoura", () => {
    const pontos = rota.slice(0, 3).map(criar);
    completarTrilha(pontos, rota, NaN, { lat: -23.4, lng: -48.4 }, criar);
    expect(pontos.length).toBe(2);
    expect(buracos(pontos)).toBe(0);
  });
});
