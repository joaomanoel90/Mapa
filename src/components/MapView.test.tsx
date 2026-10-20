// @vitest-environment jsdom
/*
 * O interruptor do rastro vale para a **prévia**, e não só para o vídeo.
 *
 * O defeito: `MapView` criava e redesenhava a trilha sempre, sem receber o
 * ajuste do painel. Com o rastro desligado, a tela continuava mostrando uma
 * linha sólida da cor do trajeto correndo junto do personagem — e numa rota
 * longa, quase reta e vista de longe, ela se confunde com a linha pontilhada.
 *
 * Aqui a prova é a chamada que cria a polyline da trilha (a única com
 * `weight: 5` e sem tracejado): desligado, ela não acontece; ligado, sim.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polyline } from "leaflet";
import MapView from "./MapView";
import { buildTrack } from "../lib/geo";
import { findCharacter } from "../lib/characters";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** O mapa do Leaflet precisa de um observador de tamanho que o jsdom não tem. */
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

/**
 * O Leaflet desenha as linhas num canvas (`preferCanvas`), e o jsdom não tem
 * canvas. Um contexto de mentira (qualquer propriedade é uma função) basta para
 * ele medir e traçar sem estourar.
 */
const ctx2d = new Proxy(
  { canvas: {} },
  {
    get: (alvo, prop) => (prop in alvo ? (alvo as Record<string, unknown>)[prop as string] : () => undefined),
    set: () => true,
  },
);
HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;

/**
 * O Leaflet exporta um objeto congelado (não dá para `vi.spyOn`), então a
 * polyline é interceptada no módulo: as criadas pela trilha (espessura 5 e sem
 * tracejado) ficam numa lista para o teste conferir.
 */
const criadas = vi.hoisted(() => ({ trilhas: [] as unknown[] }));

vi.mock("leaflet", async (importOriginal) => {
  const real = await importOriginal<typeof import("leaflet")>();
  const polyline = ((latlngs: unknown, opts?: { weight?: number; dashArray?: string }) => {
    const linha = (real as unknown as { polyline: (a: unknown, o?: unknown) => unknown }).polyline(
      latlngs,
      opts,
    );
    if (opts?.weight === 5 && !opts?.dashArray) criadas.trilhas.push(linha);
    return linha;
  }) as unknown as typeof real.polyline;
  return { ...real, default: { ...(real as unknown as object), polyline }, polyline };
});

const TRACK = buildTrack([
  { lat: -23.5, lng: -48.4 },
  { lat: -23.52, lng: -48.42 },
]);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let trilhas: Polyline[] = [];

beforeEach(() => {
  criadas.trilhas = [];
  trilhas = criadas.trilhas as Polyline[];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

const nada = () => undefined;

function montar(showTraveled: boolean) {
  act(() =>
    root!.render(
      <MapView
        waypoints={[]}
        track={TRACK}
        progress={0.5}
        playing={false}
        character={findCharacter("bike")}
        rotate={false}
        accent="#a3e635"
        basemap="dark"
        follow
        followZoom={16}
        thirdPerson={false}
        showRoute
        showTraveled={showTraveled}
        onAddPoint={nada}
        onMovePoint={nada}
        onRemovePoint={nada}
        selectedWp={null}
        onSelectPoint={nada}
        endpoints={{ a: null, b: null }}
        pois={[]}
        showStops={false}
        selectedPoi={null}
        poiMode={false}
        onSelectPoi={nada}
        onAddPoiAt={nada}
        onMovePoi={nada}
        onPlacePoi={nada}
        onDropPoi={nada}
      />,
    ),
  );
}

describe("prévia: rastro percorrido", () => {
  it("desligado, não desenha a trilha", () => {
    montar(false);
    expect(trilhas).toHaveLength(0);
  });

  it("ligado, a trilha existe e cresce com o progresso", () => {
    montar(true);
    expect(trilhas).toHaveLength(1);
    expect(trilhas[0].getLatLngs().length).toBeGreaterThan(0);
  });

  it("desligar depois de ligado tira a trilha do mapa", () => {
    montar(true);
    const linha = trilhas[0];
    const noMapa = () => Boolean((linha as unknown as { _map?: unknown })._map);
    expect(noMapa()).toBe(true);
    montar(false);
    expect(noMapa()).toBe(false);
  });
});
