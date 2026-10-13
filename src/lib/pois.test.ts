import { describe, expect, it } from "vitest";
import { buildTrack } from "./geo";
import {
  isOffRoute,
  kindById,
  makePoi,
  nextFreeT,
  nextPoiId,
  poiOffset,
  snapPoiToRoute,
  sortPois,
  type Poi,
} from "./pois";

describe("nextPoiId", () => {
  it("nunca repete", () => {
    const ids = new Set(Array.from({ length: 500 }, () => nextPoiId()));
    expect(ids.size).toBe(500);
  });
});

describe("makePoi", () => {
  it("usa emoji, cor e nome do tipo escolhido", () => {
    const igreja = kindById("igreja");
    const poi = makePoi("igreja", 0.5);
    expect(poi.emoji).toBe(igreja.emoji);
    expect(poi.color).toBe(igreja.color);
    expect(poi.label).toBe(igreja.name);
  });

  it("prende o gatilho entre 0,01 e 0,99", () => {
    expect(makePoi("praia", -3).t).toBe(0.01);
    expect(makePoi("praia", 42).t).toBe(0.99);
    expect(makePoi("praia", 0.5).t).toBe(0.5);
  });

  it("aceita id explícito", () => {
    // é assim que o App evita sortear o id dentro do updater do React
    expect(makePoi("ponte", 0.5, undefined, undefined, "poi-fixo-1").id).toBe("poi-fixo-1");
  });

  it("é determinístico com id explícito (seguro sob StrictMode)", () => {
    // O StrictMode executa o updater do React duas vezes em desenvolvimento.
    // Com o id vindo de fora, as duas execuções produzem exatamente a mesma
    // parada — e a que fica na lista é a que ficou selecionada.
    const args = ["igreja", 0.33, "Igreja Matriz", { lat: -23.5, lng: -48.4 }, "poi-fixo-2"] as const;
    expect(makePoi(...args)).toEqual(makePoi(...args));
  });

  it("sorteia id quando nenhum é informado", () => {
    expect(makePoi("ponte", 0.5).id).toBeTruthy();
    expect(makePoi("ponte", 0.5).id).not.toBe(makePoi("ponte", 0.5).id);
  });

  it("cai no primeiro tipo quando o id é desconhecido", () => {
    expect(makePoi("nao-existe", 0.5).emoji).toBe(kindById("nao-existe").emoji);
  });

  it("guarda a posição quando a parada fica fora da rota", () => {
    const poi = makePoi("cachoeira", 0.4, "Cachoeira do Salto", { lat: -23.5, lng: -48.4 });
    expect(poi.pos).toEqual({ lat: -23.5, lng: -48.4 });
    expect(poi.label).toBe("Cachoeira do Salto");
  });
});

describe("nextFreeT", () => {
  it("começa no meio quando não há paradas", () => {
    expect(nextFreeT([])).toBe(0.5);
  });

  it("escolhe o meio do maior vão livre", () => {
    expect(nextFreeT([makePoi("ponte", 0.5)])).toBe(0.25);
  });

  it("prefere o vão à direita quando ele é maior", () => {
    const t = nextFreeT([makePoi("ponte", 0.2)]);
    // vãos: 0→0.2 e 0.2→1 (0.8 é o maior) → meio dele é 0.6
    expect(t).toBeCloseTo(0.6, 6);
  });

  it("fica dentro dos limites mesmo com muitas paradas", () => {
    const many: Poi[] = Array.from({ length: 40 }, (_, i) => makePoi("ponte", (i + 1) / 41));
    const t = nextFreeT(many);
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(0.99);
  });
});

describe("sortPois", () => {
  it("ordena por gatilho sem alterar a lista original", () => {
    const list = [makePoi("ponte", 0.8), makePoi("ponte", 0.1), makePoi("ponte", 0.5)];
    const sorted = sortPois(list);
    expect(sorted.map((p) => p.t)).toEqual([0.1, 0.5, 0.8]);
    expect(list.map((p) => p.t)).toEqual([0.8, 0.1, 0.5]);
  });
});

describe("posição da parada em relação à rota", () => {
  const track = buildTrack([
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ]);

  it("considera offset zero quando a parada está colada na rota", () => {
    expect(poiOffset(makePoi("ponte", 0.5), track)).toBe(0);
    expect(isOffRoute(makePoi("ponte", 0.5), track)).toBe(false);
  });

  it("mede o afastamento de uma parada fora da rota", () => {
    const longe = makePoi("cachoeira", 0.5, undefined, { lat: 0.5, lng: 0.05 });
    expect(poiOffset(longe, track)).toBeGreaterThan(5000);
    expect(isOffRoute(longe, track)).toBe(true);
  });

  it("não marca como fora da rota um desvio pequeno (~11 m)", () => {
    const perto = makePoi("ponte", 0.5, undefined, { lat: 0.5, lng: 0.0001 });
    expect(isOffRoute(perto, track)).toBe(false);
  });

  it("snapPoiToRoute cola a parada de volta", () => {
    const longe = makePoi("cachoeira", 0.5, undefined, { lat: 0.5, lng: 0.05 });
    const colada = snapPoiToRoute(longe);
    expect(colada.pos).toBeUndefined();
    expect(poiOffset(colada, track)).toBe(0);
  });
});
