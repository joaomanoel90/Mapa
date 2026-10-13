import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatLng } from "./geo";
import {
  MAX_COORDS_PER_CALL,
  clearRouteCache,
  fetchRoute,
  isAbortError,
  legsFromRun,
  parseRun,
  planRuns,
  snapToRoad,
  splitIndices,
} from "./routing";

const A: LatLng = { lat: -23.49, lng: -48.41 };
const B: LatLng = { lat: -23.5, lng: -48.42 };
const CARRO = { profile: "car" as const, ignoreOneway: false };

/** Resposta no formato do OSRM. */
const osrmOk = (coords: [number, number][], distance = 1000) => ({
  code: "Ok",
  routes: [{ geometry: { coordinates: coords }, distance }],
});

const resposta = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** As paradas que o cliente pediu, lidas da própria URL. */
const coordsDaUrl = (url: string): LatLng[] => {
  const m = url.match(/\/([-\d.,;]+)\?/);
  if (!m) return [];
  return m[1].split(";").map((par) => {
    const [lng, lat] = par.split(",").map(Number);
    return { lat, lng };
  });
};

/**
 * OSRM de mentira: devolve as paradas pedidas como geometria da rota, com uma
 * perna de 100 m por trecho — o suficiente para conferir agrupamento, corte e
 * soma de distâncias.
 */
const eco = (url: string, perna = 100) => {
  const wps = coordsDaUrl(url);
  return resposta({
    code: "Ok",
    routes: [
      {
        geometry: { coordinates: wps.map((w) => [w.lng, w.lat]) },
        distance: perna * Math.max(0, wps.length - 1),
        legs: wps.slice(1).map(() => ({ distance: perna })),
      },
    ],
    waypoints: wps.map((w) => ({ location: [w.lng, w.lat] })),
  });
};

/** Pontos em linha, para testes de agrupamento. */
const fila = (n: number): LatLng[] =>
  Array.from({ length: n }, (_, i) => ({ lat: -23.5 + i * 0.001, lng: -48.4 }));

const abortError = () => Object.assign(new Error("cancelado"), { name: "AbortError" });

beforeEach(() => {
  // os caches são de módulo: sem isso um teste contaminaria o seguinte
  clearRouteCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAbortError", () => {
  it("reconhece cancelamento das duas formas que os navegadores usam", () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError({ code: 20 })).toBe(true); // DOMException legado
  });

  it("não confunde erro comum com cancelamento", () => {
    expect(isAbortError(new Error("rede caiu"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});

describe("fetchRoute", () => {
  it("não chama a rede no perfil livre (linha reta)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchRoute([A, B], { profile: "straight", ignoreOneway: false });
    expect(spy).not.toHaveBeenCalled();
    expect(r.source).toBe("direct");
    expect(r.points).toEqual([A, B]);
  });

  it("usa a geometria devolvida pelo servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(osrmOk([[0, 0], [0.5, 0.5], [1, 1]], 5000))),
    );
    const r = await fetchRoute([A, B], CARRO);
    expect(r.source).toBe("osrm");
    expect(r.distance).toBe(5000);
    expect(r.points).toHaveLength(3);
    // o OSRM devolve [lng, lat] e o app trabalha com {lat, lng}
    expect(r.points[1]).toEqual({ lat: 0.5, lng: 0.5 });
  });

  it("reaproveita o trecho já calculado", async () => {
    const spy = vi.fn(async () => resposta(osrmOk([[0, 0], [1, 1]])));
    vi.stubGlobal("fetch", spy);
    await fetchRoute([A, B], CARRO);
    const r2 = await fetchRoute([A, B], CARRO);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r2.reused).toBe(1);
  });

  it("cai para linha reta quando todos os servidores falham", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta({}, 500)));
    const r = await fetchRoute([A, B], CARRO);
    expect(r.source).toBe("direct");
    expect(r.points).toEqual([A, B]);
    expect(r.note).toMatch(/indispon[íi]vel/i);
  });

  it("trata 429 esperando e tentando de novo no mesmo servidor", async () => {
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamadas++;
        if (chamadas === 1) return resposta({}, 429, { "Retry-After": "0" });
        return resposta(osrmOk([[0, 0], [1, 1]], 1234));
      }),
    );
    const r = await fetchRoute([A, B], CARRO);
    expect(chamadas).toBe(2);
    expect(r.source).toBe("osrm");
    expect(r.distance).toBe(1234);
  });

  it("passa para o próximo servidor quando o primeiro insiste em 429", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("routing.openstreetmap.de")) {
          return resposta({}, 429, { "Retry-After": "0" });
        }
        return resposta(osrmOk([[0, 0], [1, 1]], 2000));
      }),
    );
    const r = await fetchRoute([A, B], CARRO);
    expect(r.source).toBe("osrm");
    expect(r.distance).toBe(2000);
    expect(urls.some((u) => u.includes("project-osrm.org"))).toBe(true);
  });

  it("monta a rota em trechos, sem repetir o ponto de junção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(osrmOk([[0, 0], [1, 1]]))));
    const C: LatLng = { lat: -23.51, lng: -48.43 };
    const r = await fetchRoute([A, B, C], CARRO);
    // a junção entre os dois trechos entra uma vez só: 2 + 1 ponto
    expect(r.points).toHaveLength(2);
    expect(r.points).toEqual([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ]);
  });

  it("agrupa as paradas: 200 pinos viram 3 requisições, não 199", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return eco(url);
      }),
    );
    const r = await fetchRoute(fila(200), CARRO);
    // 199 trechos em punhados de 99: 99 + 99 + 1
    expect(urls).toHaveLength(3);
    expect(Math.max(...urls.map((u) => coordsDaUrl(u).length))).toBeLessThanOrEqual(
      MAX_COORDS_PER_CALL,
    );
    expect(r.source).toBe("osrm");
    expect(r.distance).toBe(199 * 100);
    // uma ponta por parada: as junções entram uma vez só
    expect(r.points).toHaveLength(200);
  });

  it("não volta ao servidor para a rota que já está no cache", async () => {
    const spy = vi.fn(async (url: string) => eco(url));
    vi.stubGlobal("fetch", spy);
    const wps = fila(20);
    await fetchRoute(wps, CARRO);
    const chamadas = spy.mock.calls.length;
    expect(chamadas).toBe(1);

    const r = await fetchRoute(wps, CARRO);
    expect(spy).toHaveBeenCalledTimes(chamadas);
    expect(r.reused).toBe(19);
  });

  it("divide o punhado quando o servidor recusa a requisição inteira", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return coordsDaUrl(url).length > 4 ? resposta({ code: "InvalidQuery" }, 400) : eco(url);
      }),
    );
    const r = await fetchRoute(fila(7), CARRO);

    // o punhado inteiro é tentado nos dois servidores e recusado...
    expect(urls.filter((u) => coordsDaUrl(u).length === 7)).toHaveLength(2);
    // ...então ele se divide em duas metades, que passam
    expect(urls).toHaveLength(4);
    expect(r.source).toBe("osrm");
    expect(r.distance).toBe(6 * 100);
  });

  it("não divide o punhado quando o servidor está só limitando o uso (429)", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return resposta({ message: "limite" }, 429, { "Retry-After": "0" });
      }),
    );
    const r = await fetchRoute(fila(7), CARRO);
    // 2 tentativas por servidor, 2 servidores — e nenhuma requisição dividida
    expect(urls).toHaveLength(4);
    expect(new Set(urls.map((u) => coordsDaUrl(u).length))).toEqual(new Set([7]));
    expect(r.source).toBe("direct");
  });

  it("propaga cancelamento em vez de virar linha reta", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError();
      }),
    );
    await expect(fetchRoute([A, B], CARRO, ac.signal)).rejects.toThrow();
  });

  it("não guarda no cache um trecho cancelado", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError();
      }),
    );
    await expect(fetchRoute([A, B], CARRO, ac.signal)).rejects.toThrow();

    // a próxima tentativa precisa ir ao servidor, e não receber a linha reta
    const spy = vi.fn(async () => resposta(osrmOk([[0, 0], [1, 1]], 4000)));
    vi.stubGlobal("fetch", spy);
    const r = await fetchRoute([A, B], CARRO);
    expect(spy).toHaveBeenCalled();
    expect(r.distance).toBe(4000);
    expect(r.source).toBe("osrm");
  });
});

describe("snapToRoad", () => {
  const waypoint = (distance: number, name = "Rua das Flores") => ({
    code: "Ok",
    waypoints: [{ location: [-48.41, -23.49], distance, name }],
  });

  it("encaixa o ponto quando a rua está perto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(waypoint(12))));
    const r = await snapToRoad(A, CARRO);
    expect(r.snapped).toBe(true);
    expect(r.street).toBe("Rua das Flores");
    expect(r.point).toEqual({ lat: -23.49, lng: -48.41 });
  });

  it("mantém o clique original quando a rua está longe demais", async () => {
    // MAX_SNAP_METERS = 220
    vi.stubGlobal("fetch", vi.fn(async () => resposta(waypoint(900))));
    const r = await snapToRoad(A, CARRO);
    expect(r.snapped).toBe(false);
    expect(r.point).toEqual(A);
  });

  it("usa 'via sem nome' quando o servidor não informa a rua", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(waypoint(5, ""))));
    const r = await snapToRoad(A, CARRO);
    expect(r.snapped).toBe(true);
    expect(r.street).toBeUndefined();
  });

  it("não encaixa no perfil livre", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await snapToRoad(A, { profile: "straight", ignoreOneway: false });
    expect(spy).not.toHaveBeenCalled();
    expect(r.snapped).toBe(false);
  });

  it("devolve o ponto original quando a rede falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("sem rede");
      }),
    );
    const r = await snapToRoad(A, CARRO);
    expect(r.snapped).toBe(false);
    expect(r.point).toEqual(A);
  });

  it("propaga cancelamento", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError();
      }),
    );
    await expect(snapToRoad(A, CARRO, ac.signal)).rejects.toThrow();
  });
});

describe("roteamento em punhado", () => {
  it("agrupa só trechos seguidos que faltam", () => {
    expect(planRuns([true, true, true])).toEqual([{ from: 0, to: 2 }]);
    expect(planRuns([true, false, true, true])).toEqual([
      { from: 0, to: 0 },
      { from: 2, to: 3 },
    ]);
    expect(planRuns([false, false])).toEqual([]);
    expect(planRuns([])).toEqual([]);
  });

  it("respeita o limite de coordenadas por requisição", () => {
    const runs = planRuns(new Array(250).fill(true), 100);
    expect(runs.map((r) => r.to - r.from + 1)).toEqual([99, 99, 52]);
  });

  it("corta a geometria nas paradas", () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
      { lat: 4, lng: 4 },
    ];
    expect(splitIndices(pts, [pts[0], pts[2], pts[4]])).toEqual([0, 2, 4]);
    // sem parada no meio, os índices são as próprias pontas
    expect(splitIndices(pts, [pts[0], pts[4]])).toEqual([0, 4]);
  });

  it("reparte a distância total quando o servidor não manda legs", () => {
    const wps: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    const run = parseRun(
      {
        code: "Ok",
        routes: [{ geometry: { coordinates: [[0, 0], [1, 0], [3, 0]] }, distance: 900 }],
      },
      wps,
    );
    expect(run?.distances[0]).toBeCloseTo(300, 6); // trechos de 1 e 2 graus: 1/3 e 2/3
    expect(run?.distances[1]).toBeCloseTo(600, 6);
  });

  it("usa a distância de cada trecho quando o servidor manda legs", () => {
    const wps: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    const run = parseRun(
      {
        code: "Ok",
        routes: [
          {
            geometry: { coordinates: [[0, 0], [1, 0], [3, 0]] },
            distance: 900,
            legs: [{ distance: 111 }, { distance: 222 }],
          },
        ],
      },
      wps,
    );
    expect(run?.distances).toEqual([111, 222]);
  });

  it("junta os trechos de volta na geometria inteira", () => {
    const pts: LatLng[] = [0, 1, 2, 3, 4].map((i) => ({ lat: i, lng: i }));
    const legs = legsFromRun({
      points: pts,
      cuts: [pts[0], pts[2], pts[4]],
      distances: [10, 20],
    });
    expect(legs).toHaveLength(2);
    expect(legs[0].points).toEqual([pts[0], pts[1], pts[2]]);
    expect(legs[1].points).toEqual([pts[2], pts[3], pts[4]]);
    expect(legs.map((l) => l.distance)).toEqual([10, 20]);
    expect(legs.some((l) => l.direct)).toBe(false);
  });

  it("recusa resposta sem rota", () => {
    expect(parseRun({ code: "NoRoute" }, [A, B])).toBeNull();
    expect(parseRun({ code: "Ok", routes: [] }, [A, B])).toBeNull();
    expect(parseRun({ code: "Ok", routes: [{ geometry: { coordinates: [] } }] }, [A, B])).toBeNull();
    expect(parseRun(null, [A, B])).toBeNull();
  });
});
