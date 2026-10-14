// @vitest-environment jsdom
/*
 * Teste de comportamento do painel da cartela.
 *
 * Existe por causa de um bug de verdade: o campo era um componente declarado
 * **dentro** do componente do painel, então cada render criava um tipo novo, o
 * React desmontava a caixa de texto e o foco ia embora a cada tecla digitada.
 * Teste de função pura não pega isso — só renderizando e digitando.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EndCardPanel from "./EndCardPanel";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import { endCard, rideSummary, type CardFields } from "../lib/stats";
import type { LatLng } from "../lib/geo";

// o React 19 só deixa usar `act` se o ambiente se declarar como de teste
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.parse("2026-10-13T09:00:00Z");
const PONTOS: LatLng[] = [
  { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
  { lat: -23.51, lng: -48.41, ele: 842, t: T0 + 3600_000 },
];
const RESUMO = rideSummary(PONTOS, 71_030);

/**
 * O mesmo arranjo do app: quem guarda os ajustes é o componente de cima, e o
 * painel avisa o que mudou. É esse vaivém (digitar → sobe o estado → desce o
 * valor) que expunha o bug.
 */
function Painel() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  const cartela = endCard(
    {
      cardDistance: settings.cardDistance,
      cardElevation: settings.cardElevation,
      cardTime: settings.cardTime,
      cardNote: settings.cardNote,
    } satisfies CardFields,
    RESUMO,
  );
  return <EndCardPanel resumo={RESUMO} cartela={cartela} settings={settings} update={update} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Painel />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const campo = (rotulo: string): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`);
  if (!el) throw new Error(`campo "${rotulo}" não encontrado`);
  return el;
};

/**
 * Digita como o navegador digita: um caractere por vez, avisando o React a
 * cada um. Escrever `value` direto não serviria — o controle de valor do React
 * ignora mudanças que ele não viu acontecer.
 */
const digitar = (el: HTMLInputElement, texto: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const caractere of texto) {
    act(() => {
      setter.call(el, el.value + caractere);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
};

describe("campos da cartela", () => {
  it("mantém o foco no campo enquanto se digita", () => {
    const el = campo("Distância");
    el.focus();
    expect(document.activeElement).toBe(el);

    for (const texto of ["4", "49", "49 ", "49 k", "49 km"]) {
      setter(el, texto);
      expect(document.activeElement).toBe(el);
    }
    expect(el.value).toBe("49 km");
  });

  it("reaproveita o mesmo elemento em vez de recriá-lo", () => {
    // a causa do bug era justamente o React trocar o <input> por outro
    const antes = campo("Distância");
    antes.focus();
    digitar(antes, "49 km");
    expect(campo("Distância")).toBe(antes);
  });

  it("mostra no painel o que foi digitado", () => {
    const el = campo("Distância");
    el.focus();
    digitar(el, "49 km");
    expect(container.textContent).toContain("49 km");
    expect(container.textContent).toContain("aparece no fim do vídeo");
  });

  it("o botão copia os números do arquivo para os campos", () => {
    expect(campo("Distância").value).toBe("");
    const botao = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("usar os números do arquivo"),
    );
    expect(botao).toBeDefined();
    act(() => botao!.click());

    expect(campo("Distância").value).toBe("71,03 km");
    expect(campo("Elevação").value).toBe("+142 m");
    expect(campo("Tempo").value).toBe("1 h");
    expect(campo("Embaixo").value).toContain("2026");
  });

  it("a dica do arquivo aparece ao lado do campo, sem entrar nele", () => {
    expect(container.textContent).toContain("71,03 km");
    expect(campo("Distância").value).toBe("");
  });

  it("mostra a prévia só depois de algo ser escrito", () => {
    // a prévia é a fileira de números com o rótulo embaixo (o maiúsculo é do CSS)
    const previa = () =>
      [...container.querySelectorAll("div")].some(
        (d) => d.textContent === "distância" && d.previousElementSibling?.textContent === "49 km",
      );
    expect(container.textContent).toContain("não aparece");
    expect(previa()).toBe(false);

    const el = campo("Distância");
    el.focus();
    digitar(el, "49 km");

    expect(container.textContent).toContain("aparece no fim do vídeo");
    expect(previa()).toBe(true);
  });

  it("digitar em um campo não tira o foco nem apaga o que foi escrito no de cima", () => {
    const distancia = campo("Distância");
    distancia.focus();
    digitar(distancia, "49 km");

    const tempo = campo("Tempo");
    tempo.focus();
    digitar(tempo, "3 h");
    expect(document.activeElement).toBe(tempo);
    expect(campo("Distância").value).toBe("49 km");
  });
});

describe("foto do projeto", () => {
  const arquivo = (nome: string, tipo: string, conteudo = "x") =>
    new File([conteudo], nome, { type: tipo });

  /** Entrega um arquivo ao campo de foto, como o seletor do sistema faria. */
  const escolher = async (file: File) => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("campo de foto não encontrado");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("o campo existe e diz onde a foto aparece", () => {
    expect(container.textContent).toContain("Foto do projeto");
    expect(container.textContent).toContain("cartela final");
    // e avisa que ela não vai no link: melhor dizer onde se escolhe
    expect(container.textContent).toContain("não vai no link");
  });

  it("recusa um arquivo que não é imagem, explicando por quê", async () => {
    // caminho que não depende de canvas: a recusa acontece antes de processar
    await escolher(arquivo("nota.txt", "text/plain"));
    expect(container.textContent).toContain("não é uma imagem");
  });

  it("recusa imagem grande demais antes de tentar abrir", async () => {
    const gigante = new File([new Uint8Array(1)], "grande.jpg", { type: "image/jpeg" });
    Object.defineProperty(gigante, "size", { value: 40 * 1024 * 1024 });
    await escolher(gigante);
    expect(container.textContent).toContain("acima do limite");
  });
});

/** Escreve o valor de uma vez, como o `digitar` faz caractere a caractere. */
function setter(el: HTMLInputElement, texto: string) {
  const descritor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  act(() => {
    descritor.set!.call(el, texto);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
