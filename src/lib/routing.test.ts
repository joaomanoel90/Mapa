import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatLng } from "./geo";
import { clearRouteCache, fetchRoute, isAbortError, snapToRoad } from "./routing";

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
    // dois trechos de [{0,0},{1,1}] unidos: 2 + 1 pontos, sem duplicar a junção
    expect(r.points).toHaveLength(3);
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
