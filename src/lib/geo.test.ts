import { describe, expect, it } from "vitest";
import {
  SHARP_TURN_DEG,
  SMOOTH_PASSES,
  SMOOTH_WINDOW_M,
  TRACK_POINT_LIMIT,
  TURN_SPAN_M,
  bearing,
  buildTrack,
  cumulative,
  fitZoom,
  formatDistance,
  formatTime,
  haversine,
  measuredCumulative,
  nearestTOnTrack,
  nudge,
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
    expect(Math.abs(erro(a, b))).toBeLessThan(1.5);
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

  it("curva suave de verdade não é comida pelo filtro", () => {
    // 30 m de amplitude a cada 400 m: um desvio suave e legítimo (estrada de
    // serra, contorno de represa). O filtro tem que medir o mesmo que o arquivo.
    const suave: LatLng[] = Array.from({ length: 4275 }, (_, i) => {
      const s = i * 5;
      return { lat: (30 * Math.sin((2 * Math.PI * s) / 400)) * GRAU_POR_METRO, lng: s * GRAU_POR_METRO };
    });
    const verdade = cumulative(suave).at(-1) ?? 0;
    const medido = measuredCumulative(suave).at(-1) ?? 0;
    expect(Math.abs(erro(medido, verdade))).toBeLessThan(0.5);
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

  it("a janela é medida em metros: a mesma faixa de caminho, em qualquer densidade", () => {
    /*
     * Uma ondulação de 2 m de amplitude a cada 30 m — geometria de verdade, com
     * giro de ~24° por ponto (abaixo do limiar de curva). Uma média de ±8 **m**
     * de caminho corta a amplitude para ~1,2 m; uma média de "±2 pontos" corta
     * quase nada num arquivo denso e muito num arquivo esparso.
     */
    const ondulada = (passo: number): LatLng[] =>
      Array.from({ length: Math.floor(2000 / passo) + 1 }, (_, i) => {
        const s = i * passo;
        return { lat: 2 * GRAU_POR_METRO * Math.sin((2 * Math.PI * s) / 30), lng: s * GRAU_POR_METRO };
      });
    for (const passo of [0.5, 1, 2]) {
      const suave = smoothedPoints(ondulada(passo));
      const desvios = suave.slice(3, -3).map((p) => Math.abs(p.lat / GRAU_POR_METRO));
      const maxDesvio = Math.max(...desvios);
      // amaciou (não deixou os 2 m)
      expect(maxDesvio).toBeLessThan(1.5);
      // mas não apagou: a ondulação é a geometria, não ruído
      expect(maxDesvio).toBeGreaterThan(0.8);
    }
  });

  it("as constantes do filtro são as medidas", () => {
    // se alguém mexer nelas, os números deste arquivo deixam de valer
    expect(SMOOTH_WINDOW_M).toBe(8);
    expect(SHARP_TURN_DEG).toBe(50);
    expect(TURN_SPAN_M).toBe(20);
    expect(SMOOTH_PASSES).toBe(2);
  });
});
