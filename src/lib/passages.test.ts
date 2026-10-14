import { describe, expect, it } from "vitest";
import { buildTrack, type LatLng } from "./geo";
import type { Poi } from "./pois";
import {
  PASSAGE_RADIUS_M,
  countFor,
  countPassed,
  mapPassages,
  passageTimes,
  passagesOf,
  stopPassages,
} from "./passages";

/* ------------------------------------------------------------------ */
/* Rotas sintéticas                                                    */
/* ------------------------------------------------------------------ */

/** Rota ao longo de um meridiano, com `passo` graus por ponto. */
function linha(n: number, passo = 0.001, base = -23.5): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: base + i * passo, lng: -48.4 }));
}

/** Ida e volta pelo mesmo caminho: sobe até o meio e volta. */
function idaEVolta(n = 40, altura = 0.001): LatLng[] {
  const subida = linha(n, altura);
  return [...subida, ...subida.slice(0, -1).reverse()];
}

/** Mesma quantidade de pontos, mas a volta por uma rua 300 m ao lado. */
function idaEVoltaRuaParalela(n = 40, altura = 0.001): LatLng[] {
  const subida = linha(n, altura);
  const descida = subida
    .slice(0, -1)
    .reverse()
    .map((p) => ({ lat: p.lat, lng: p.lng + 0.003 })); // ~300 m a leste
  return [...subida, ...descida];
}

/**
 * O meio exato do percurso de ida e volta: fica no meio do trecho entre dois
 * pontos, então a passagem cai em t = 0,25 (e 0,75 na volta).
 */
const MEIO_DO_PERCURSO = { lat: -23.5 + 19.5 * 0.001, lng: -48.4 };

const poi = (extra: Partial<Poi> = {}): Poi => ({
  id: "p1",
  emoji: "💦",
  label: "Cachoeira",
  color: "#22d3ee",
  t: 0.5,
  ...extra,
});

/** Distância aproximada em metros entre dois pontos (para montar os testes). */
const metros = (a: number, b: number) => Math.abs(a - b);

describe("passagens: ida e volta pelo mesmo caminho", () => {
  const track = buildTrack(idaEVolta());
  const perto = { lat: -23.5 + 10 * 0.001, lng: -48.4 }; // ponto do meio da subida

  it("encontra duas passagens na metade do percurso", () => {
    const p = passagesOf(track, perto);
    expect(p.length).toBe(2);
    expect(p[0].t).toBeLessThan(p[1].t);
  });

  it("a ida passa na metade do percurso e a volta na outra metade", () => {
    const p = passagesOf(track, MEIO_DO_PERCURSO);
    expect(p[0].t).toBeCloseTo(0.25, 2);
    expect(p[1].t).toBeCloseTo(0.75, 2);
  });

  it("as duas passagens estão praticamente em cima do lugar", () => {
    const p = passagesOf(track, perto);
    for (const x of p) expect(x.dist).toBeLessThan(1);
  });

  it("a parada no meio da ida aparece duas vezes no vídeo", () => {
    const passagens = stopPassages(track, poi({ t: 0.25 }));
    expect(passagens.length).toBe(2);
  });

  it("as duas passagens ficam a mais de 500 m uma da outra ao longo da rota (não são a mesma)", () => {
    // o vídeo mostra de novo porque são momentos distintos do percurso
    const p = passagesOf(track, perto);
    expect(metros(p[0].t, p[1].t) * track.total).toBeGreaterThan(500);
  });
});

describe("passagens: casos que não podem contar duas vezes", () => {
  it("parada no ponto de retorno (o extremo da ida) conta uma vez só", () => {
    // aqui a distância nunca sai do raio no meio: a volta acontece em cima da parada
    const track = buildTrack(idaEVolta());
    const extremo = { lat: -23.5 + 39 * 0.001, lng: -48.4 };
    expect(passagesOf(track, extremo).length).toBe(1);
  });

  it("parada na largada de uma ida e volta conta duas: a partida e o retorno", () => {
    // quem sai de casa e volta para casa passa por casa duas vezes — e as duas
    // devem aparecer, uma no comecinho do vídeo e outra no fim
    const track = buildTrack(idaEVolta());
    const p = passagesOf(track, { lat: -23.5, lng: -48.4 });
    expect(p.map((x) => x.t)).toEqual([0, 1]);
  });

  it("rua paralela a 300 m NÃO conta como a mesma parada", () => {
    // o raio de 40 m é o que separa "mesmo lugar na volta" de "rua do lado"
    const track = buildTrack(idaEVoltaRuaParalela());
    const naSubida = { lat: -23.5 + 10 * 0.001, lng: -48.4 };
    expect(passagesOf(track, naSubida).length).toBe(1);
  });

  it("ida e volta no mesmo asfalto, com o GPS errando 15 m, ainda conta duas vezes", () => {
    // o erro de GPS é o motivo de o raio não ser zero
    const subida = linha(40, 0.001);
    const descida = subida
      .slice(0, -1)
      .reverse()
      .map((p) => ({ lat: p.lat + 0.00013, lng: p.lng })); // ~15 m ao norte
    const track = buildTrack([...subida, ...descida]);
    const noMeio = { lat: -23.5 + 10 * 0.001, lng: -48.4 };
    expect(passagesOf(track, noMeio).length).toBe(2);
  });
});

describe("passagens: rota de laço", () => {
  it("um circuito que passa duas vezes pelo mesmo lugar conta duas passagens", () => {
    // volta quadrada: sobe, cruza, desce e volta — o primeiro ponto é visitado
    // no começo e no fim do laço
    const pts: LatLng[] = [
      { lat: -23.5, lng: -48.4 },
      { lat: -23.49, lng: -48.4 },
      { lat: -23.49, lng: -48.39 },
      { lat: -23.49, lng: -48.38 },
      { lat: -23.5, lng: -48.38 },
      { lat: -23.5, lng: -48.39 },
      { lat: -23.5, lng: -48.4 },
    ];
    const track = buildTrack(pts);
    // a esquina da largada é passada na partida e na chegada
    const esquina = passagesOf(track, { lat: -23.5, lng: -48.4 });
    expect(esquina.length).toBe(2);
    expect(esquina[0].t).toBeCloseTo(0, 2);
    expect(esquina[1].t).toBeCloseTo(1, 2);
  });
});

describe("passagens: parada fora da rota", () => {
  it("a 200 m da linha, a parada mantém o comportamento antigo (o t onde foi criada)", () => {
    // sem isso, uma parada marcada longe do trajeto nunca apareceria
    const track = buildTrack(idaEVolta());
    const longe = { lat: -23.5 + 10 * 0.001, lng: -48.4 + 0.002 }; // ~200 m a leste
    expect(passagesOf(track, longe).length).toBe(0);
    expect(stopPassages(track, poi({ t: 0.25, pos: longe }))).toEqual([0.25]);
  });

  it("a 30 m da linha (dentro do raio), a volta conta de novo", () => {
    const track = buildTrack(idaEVolta());
    const quase = { lat: -23.5 + 10 * 0.001, lng: -48.4 + 0.0003 }; // ~30 m a leste
    expect(passagesOf(track, quase).length).toBe(2);
  });
});

describe("passagens: o que alimenta o desenho", () => {
  const track = buildTrack(idaEVolta());
  const paradas = [
    poi({ id: "a", t: 0.25 }),
    // posição marcada no ponto 8 da subida — o t correspondente é ~0,1
    poi({ id: "b", t: 0.1, pos: { lat: -23.5 + 8 * 0.001, lng: -48.4 } }),
  ];

  it("mapa por id, com uma lista para cada parada", () => {
    const m = mapPassages(track, paradas);
    expect(Object.keys(m).sort()).toEqual(["a", "b"]);
    expect(m.a.length).toBe(2);
    expect(m.b.length).toBe(2);
  });

  it("as passagens vêm em ordem de percurso para a câmera", () => {
    const m = mapPassages(track, paradas);
    const ts = passageTimes(paradas, m);
    expect(ts.length).toBe(4);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts); // crescente
    expect(ts[0]).toBeCloseTo(0.1, 2);
  });

  it("contador: conta passagens, e sabe quantas são a mais que paradas", () => {
    const m = mapPassages(track, paradas);
    const noComeco = countPassed(paradas, m, 0.15);
    expect(noComeco).toEqual({ passed: 1, total: 4, extras: 2 });
    const noFim = countPassed(paradas, m, 1);
    expect(noFim.passed).toBe(4);
  });

  it("sem passagens calculadas, tudo se comporta como antes (uma por parada)", () => {
    expect(countFor(paradas[0], undefined)).toBe(1);
    expect(countPassed(paradas, undefined, 1)).toEqual({
      passed: 2,
      total: 2,
      extras: 0,
    });
    expect(passageTimes(paradas, undefined)).toEqual([0.25, 0.1].sort((a, b) => a - b));
  });

  it("o raio padrão é 40 m", () => {
    expect(PASSAGE_RADIUS_M).toBe(40);
  });
});
