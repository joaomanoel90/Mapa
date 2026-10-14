// @vitest-environment jsdom
/*
 * Teste de comportamento do painel de partida e chegada.
 *
 * O que interessa aqui é a foto do local: que o campo exista (é a forma de
 * anexar), que ela seja gravada no estado, e que um arquivo que não é imagem
 * seja recusado com o motivo na tela — em vez de o app fingir que aceitou.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EndpointEditor from "./EndpointEditor";
import { DEFAULT_ENDPOINTS, type Endpoints } from "../lib/endpoints";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let atual: Endpoints;

/** O mesmo vaivém do app: quem guarda o estado é o componente de cima. */
function Painel() {
  const [endpoints, setEndpoints] = useState<Endpoints>({ ...DEFAULT_ENDPOINTS });
  atual = endpoints;
  return <EndpointEditor endpoints={endpoints} onChange={setEndpoints} />;
}

beforeEach(() => {
  atual = { ...DEFAULT_ENDPOINTS };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Painel />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Abre uma das linhas (A ou B) do painel. */
const abrir = (qual: "a" | "b") => {
  const botoes = [...container.querySelectorAll("button")];
  const alvo = botoes.find((b) =>
    (b.textContent ?? "").includes(qual === "a" ? "Partida" : "Chegada"),
  );
  if (!alvo) throw new Error("linha não encontrada");
  act(() => alvo.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

const campoDeFoto = () => container.querySelector<HTMLInputElement>('input[type="file"]');

const escolher = async (file: File) => {
  const input = campoDeFoto();
  if (!input) throw new Error("campo de foto não encontrado");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("painel de partida e chegada", () => {
  it("mostra as duas linhas, com o padrão A/B", () => {
    expect(container.textContent).toContain("Partida (A)");
    expect(container.textContent).toContain("Chegada (B)");
    expect(container.textContent).toContain("padrão");
  });

  it("abre a linha e marca o local com emoji e nome", () => {
    abrir("a");
    const emoji = container.querySelector<HTMLInputElement>('input[maxlength="4"]');
    const nome = container.querySelector<HTMLInputElement>('input[maxlength="24"]');
    expect(emoji).not.toBeNull();
    expect(nome).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(emoji, "🏠");
      emoji!.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(nome, "Casa");
      nome!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(atual.a?.emoji).toBe("🏠");
    expect(atual.a?.label).toBe("Casa");
  });

  it("o campo de foto aparece na linha aberta", () => {
    abrir("a");
    expect(campoDeFoto()).not.toBeNull();
    expect(container.textContent).toContain("Foto do local");
  });

  it("recusa um arquivo que não é imagem, explicando por quê", async () => {
    // caminho que não depende de canvas: a recusa acontece antes de processar
    abrir("a");
    await escolher(new File(["x"], "nota.txt", { type: "text/plain" }));
    expect(container.textContent).toContain("não é uma imagem");
    expect(atual.a?.photo).toBeUndefined();
  });

  it("recusa imagem grande demais antes de tentar abrir", async () => {
    abrir("b");
    const gigante = new File([new Uint8Array(1)], "grande.jpg", { type: "image/jpeg" });
    Object.defineProperty(gigante, "size", { value: 40 * 1024 * 1024 });
    await escolher(gigante);
    expect(container.textContent).toContain("acima do limite");
    expect(atual.b?.photo).toBeUndefined();
  });

  it("escolher um arquivo inválido não apaga o local já marcado", async () => {
    abrir("a");
    act(() => {
      const emoji = container.querySelector<HTMLInputElement>('input[maxlength="4"]');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(emoji, "🏠");
      emoji!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await escolher(new File(["x"], "nota.txt", { type: "text/plain" }));
    expect(atual.a?.emoji).toBe("🏠");
  });
});
