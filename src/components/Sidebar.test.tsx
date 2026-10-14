// @vitest-environment jsdom
/*
 * Teste do painel nas três novidades: cor da rota, marcas de km e câmera
 * cinematográfica.
 *
 * O que interessa aqui não é a função pura (isso é testado em `coloring`,
 * `km-marks` e `camera`), e sim o que o usuário vê: o interruptor existe, o
 * clique chega no estado, e — principalmente — **o painel avisa** quando o
 * arquivo não tem o dado. Escolher "inclinação" num traçado sem altitudes e não
 * ver nada acontecer, sem explicação, seria o pior desfecho.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Sidebar from "./Sidebar";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import { buildTrack } from "../lib/geo";
import { HOME_CITY } from "../lib/geocode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Traçado só com posições: sem elevação e sem hora, como uma rota traçada. */
const TRACK = buildTrack([
  { lat: -23.5, lng: -48.4 },
  { lat: -23.52, lng: -48.42 },
]);

/** O mesmo vaivém do app: quem guarda os ajustes é o componente de cima. */
function Painel({
  inicial,
  cobertura = { ele: 0, time: 0 },
}: {
  inicial?: Partial<Settings>;
  cobertura?: { ele: number; time: number };
}) {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...inicial });
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  const nada = () => undefined;
  return (
    <Sidebar
      settings={settings}
      update={update}
      waypoints={[]}
      distance={TRACK.total}
      routeSource="direct"
      city={HOME_CITY}
      onCity={nada}
      pois={[]}
      track={TRACK}
      cobertura={cobertura}
      progress={0}
      selectedPoi={null}
      poiMode={false}
      onTogglePoiMode={nada}
      onSelectPoi={nada}
      onAddPoi={nada}
      onUpdatePoi={nada}
      onRemovePoi={nada}
      onClearPois={nada}
      onNudgePoi={nada}
      onSnapPoi={nada}
      onZoomPoi={nada}
      endpoints={{ a: null, b: null }}
      onEndpoints={nada}
      loading={false}
      formats={[]}
      hasRoute
      maxZoom={19}
      onUndo={nada}
      onClear={nada}
      onFit={nada}
      onPreset={nada}
      onExport={nada}
      onReplay={nada}
      onImportGpx={nada}
      onExportGpx={nada}
      gpxMsg={null}
      resumo={{ distanceM: TRACK.total, elevation: null, time: null, points: TRACK.pts.length }}
      cartela={null}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

function montar(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}

/** Botões cujo texto casa com o rótulo (o Toggle é um `<button>`). */
function botao(rotulo: string): HTMLButtonElement {
  const alvo = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(rotulo),
  );
  if (!alvo) throw new Error(`botão "${rotulo}" não encontrado`);
  return alvo as HTMLButtonElement;
}

const clicar = (el: HTMLElement) =>
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("painel: cor da rota", () => {
  beforeEach(() => montar(<Painel />));

  it("oferece as três opções, com a sólida em uso", () => {
    const texto = container.textContent ?? "";
    expect(texto).toContain("Cor da rota");
    expect(texto).toContain("Sólida");
    expect(texto).toContain("Velocidade");
    expect(texto).toContain("Inclinação");
    expect(botao("Sólida").className).toContain("from-violet-500");
  });

  it("avisa que a inclinação precisa de elevação no arquivo", () => {
    clicar(botao("Inclinação"));
    expect(botao("Inclinação").className).toContain("from-violet-500");
    expect(container.textContent ?? "").toContain("não tem elevação");
  });

  it("avisa que a velocidade precisa de hora no arquivo", () => {
    clicar(botao("Velocidade"));
    expect(container.textContent ?? "").toContain("não tem hora");
  });

  it("não avisa nada na linha sólida", () => {
    expect(container.textContent ?? "").not.toContain("não tem");
  });

  it("num arquivo completo não há o que avisar", () => {
    act(() => root.unmount());
    container.remove();
    montar(<Painel inicial={{ colorBy: "slope" }} cobertura={{ ele: 1, time: 1 }} />);
    expect(container.textContent ?? "").not.toContain("não tem elevação");
  });

  it("num arquivo pela metade diz quanto falta", () => {
    act(() => root.unmount());
    container.remove();
    montar(<Painel inicial={{ colorBy: "slope" }} cobertura={{ ele: 0.3, time: 1 }} />);
    expect(container.textContent ?? "").toContain("30% dos pontos têm elevação");
  });
});

describe("painel: marcas de km e câmera cinematográfica", () => {
  it("as duas nascem desligadas e o clique liga", () => {
    montar(<Painel />);
    expect(botao("Marcas de km").getAttribute("aria-checked")).toBe("false");
    clicar(botao("Marcas de km"));
    expect(botao("Marcas de km").getAttribute("aria-checked")).toBe("true");
    expect(botao("Câmera cinematográfica").getAttribute("aria-checked")).toBe("false");
    clicar(botao("Câmera cinematográfica"));
    expect(botao("Câmera cinematográfica").getAttribute("aria-checked")).toBe("true");
  });

  it("explica o que a câmera faz, e que no “Rota toda” ela não vale", () => {
    montar(<Painel />);
    clicar(botao("Câmera cinematográfica"));
    expect(container.textContent ?? "").toContain("Abertura sobrevoando a região");
    clicar(botao("Rota toda"));
    expect(container.textContent ?? "").toContain("Só vale na câmera");
  });
});
