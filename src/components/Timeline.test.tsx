// @vitest-environment jsdom
/*
 * A barra do tempo com a desaceleração nos pontos.
 *
 * Com a freada, o cursor da barra (relógio do vídeo) e a posição da personagem
 * na rota deixam de ser a mesma coisa — e a barra tem de saber disso: as
 * bolinhas das paradas marcam o **instante da passagem** (senão o cursor
 * cruzaria a bolinha antes de a personagem chegar no lugar) e a distância
 * percorrida / a próxima parada falam da **rota**, não do vídeo.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Timeline from "./Timeline";
import { buildTrack } from "../lib/geo";
import { sortPois, type Poi } from "../lib/pois";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRACK = buildTrack([
  { lat: -23.5, lng: -48.4 },
  { lat: -23.6, lng: -48.5 },
]);

const parada = (id: string, t: number): Poi => ({
  id,
  kind: "ponte",
  label: id,
  emoji: "🌉",
  color: "#38bdf8",
  t,
} as Poi);

const POIS: Poi[] = [parada("primeira", 0.2), parada("segunda", 0.8)];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function desenhar(props: Partial<Parameters<typeof Timeline>[0]> = {}) {
  act(() => {
    root.render(
      <Timeline
        progress={0}
        playing={false}
        duration={10}
        track={TRACK}
        emoji="🏃"
        accent="#a3e635"
        disabled={false}
        stops={POIS}
        onToggle={() => undefined}
        onSeek={() => undefined}
        onRestart={() => undefined}
        {...props}
      />,
    );
  });
  return host;
}

/** A posição (em %) de cada bolinha de parada na barra. */
const bolinhas = (h: HTMLElement) =>
  [...h.querySelectorAll("button[title]")]
    .filter((b) => (b.getAttribute("title") ?? "").includes("clique para ir até aqui"))
    .map((b) => ({
      titulo: b.getAttribute("title") ?? "",
      // o `left` é um `calc(8px + x * (100% - 16px))`: o x é o que interessa
      esquerda: Number(
        (b.getAttribute("style") ?? "").match(/calc\(8px\s*\+\s*([\d.]+)/)?.[1] ?? NaN,
      ),
    }));

describe("a barra do tempo com as paradas", () => {
  it("a bolinha da parada fica na posição dela na rota", () => {
    // sem a freada, o cursor do vídeo e a personagem andam juntos: a bolinha
    // marca a passagem no lugar de sempre
    const b = bolinhas(desenhar({ progress: 0.1 }));
    expect(b.map((x) => x.esquerda)).toEqual([0.2, 0.8]);
  });

  it("o clique na bolinha leva o vídeo até a passagem", () => {
    const buscados: number[] = [];
    const h = desenhar({ rota: 0.05, onSeek: (t) => buscados.push(t) });
    const alvo = [...h.querySelectorAll("button[title]")].find((b) =>
      (b.getAttribute("title") ?? "").includes("primeira"),
    ) as HTMLElement;
    act(() => alvo.click());
    expect(buscados).toEqual([0.2]);
  });

  it("a distância e a próxima parada falam da rota, não do vídeo", () => {
    /*
     * Na metade do vídeo com freada a personagem está bem atrás de metade da
     * rota (ela gastou tempo nas paradas). A barra tem de dizer a verdade da
     * rota: 10% andados, e a primeira parada a 10% de distância.
     */
    const h = desenhar({ progress: 0.5, rota: 0.1 });
    const texto = h.textContent ?? "";
    // 10% da rota (1,51 km de 15,08 km): o número é o da **rota**…
    expect(texto).toContain("1,51 km");
    expect(texto).toContain("15,08 km");
    // …a próxima parada também (a primeira ainda está à frente)…
    expect(texto).toContain("primeira");
    // …e o relógio continua sendo o do **vídeo** (metade)
    expect(texto).toContain("00:05 / 00:10");
  });

  it("já passou: a parada que ficou para trás some do aviso de próxima", () => {
    const h = desenhar({ progress: 0.9, rota: 0.5 });
    const texto = h.textContent ?? "";
    expect(texto).toContain("segunda");
    const proxima = texto.slice(texto.indexOf("Próxima parada"));
    expect(proxima).not.toContain("primeira");
  });

  it("as duas paradas aparecem marcadas quando a rota passa das duas", () => {
    const h = desenhar({ progress: 0.9, rota: 0.85 });
    const marcadas = h.querySelectorAll("button[title]");
    expect(marcadas.length).toBeGreaterThanOrEqual(2);
    expect(h.textContent).toContain("paradas visitadas");
  });

  it("a ordem das paradas na lista segue a rota", () => {
    expect(sortPois(POIS).map((p) => p.id)).toEqual(["primeira", "segunda"]);
  });
});
