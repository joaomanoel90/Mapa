// @vitest-environment jsdom
/*
 * O seletor de personagem e os **ícones animados**.
 *
 * O que interessa aqui não é a geometria (isso é `icones.test.ts`) e sim o que o
 * usuário vê: o grupo "Animados" existe, cada um aparece como **SVG animado** (e
 * não como o emoji parado do mesmo desenho), o emoji continua nos 144 do resto,
 * e clicar entrega o personagem certo para o app.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterPicker } from "./CharacterPicker";
import { CHARACTERS, type Character } from "../lib/characters";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function montar(onChange: (c: Character) => void = () => {}, value = "car") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CharacterPicker value={value} onChange={onChange} />));
}

/** Digita na busca como o navegador faria. */
function buscar(termo: string) {
  const input = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, termo);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botaoDo(nome: string): HTMLButtonElement {
  const alvo = Array.from(container.querySelectorAll("button")).find(
    (b) => b.getAttribute("title") === nome,
  );
  if (!alvo) throw new Error(`personagem "${nome}" não encontrado`);
  return alvo as HTMLButtonElement;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("o seletor e os ícones animados", () => {
  beforeEach(() => montar());

  it("tem o grupo Animados, com os nove desenhados", () => {
    const texto = container.textContent ?? "";
    expect(texto).toContain("Animados");
    expect(CHARACTERS.filter((c) => c.group === "Animados").length).toBeGreaterThanOrEqual(9);
  });

  it("o animado aparece como SVG (o emoji do mesmo desenho é a reserva)", () => {
    buscar("Caminhante animado");
    const botao = botaoDo("Caminhante animado");
    expect(botao.querySelector("svg")).not.toBeNull();
    // e não como texto solto do emoji
    expect(botao.textContent ?? "").not.toContain("🚶");
  });

  it("o SVG do seletor anima (é a diferença que ele oferece)", () => {
    buscar("Corredor animado");
    const svg = botaoDo("Corredor animado").querySelector("svg")!;
    expect(svg.querySelectorAll("animateTransform").length).toBeGreaterThan(0);
  });

  it("o personagem comum continua emoji, sem SVG", () => {
    buscar("Carro");
    const botao = botaoDo("Carro");
    expect(botao.querySelector("svg")).toBeNull();
    expect(botao.textContent ?? "").toContain("🚗");
  });

  it("clicar entrega o personagem animado com o id certo", () => {
    const recebidos: Character[] = [];
    act(() => root.unmount());
    container.remove();
    montar((c) => recebidos.push(c));
    buscar("Cavalo animado");
    act(() => botaoDo("Cavalo animado").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].id).toBe("anim-cavalo");
    // e ele traz o ícone: é o que faz o app desenhar vetor em vez de emoji
    expect(recebidos[0].icone).toBe("cavalo");
  });

  it("a busca acha o animado pelo nome, como qualquer outro", () => {
    buscar("animado");
    const nomes = Array.from(container.querySelectorAll("button")).map((b) =>
      b.getAttribute("title"),
    );
    // os nove desenhados aparecem juntos
    expect(nomes.filter((n) => n && n.includes("animado")).length).toBe(9);
  });

  it("escolhido, o animado fica marcado (o ✓ do selo)", () => {
    const animado = CHARACTERS.find((c) => c.id === "anim-peregrino")!;
    act(() => root.unmount());
    container.remove();
    montar(() => {}, animado.id);
    buscar("Peregrino animado");
    const botao = botaoDo("Peregrino animado");
    expect(botao.textContent ?? "").toContain("✓");
  });
});

describe("a miniatura dos animados não pesa", () => {
  it("nove SVGs no seletor: o painel abre sem travar", () => {
    vi.useFakeTimers();
    const t0 = performance.now();
    montar();
    buscar("animado");
    const decorrido = performance.now() - t0;
    vi.useRealTimers();
    // limiar folgado: o que se está guardando é o tamanho do SVG por ícone
    expect(decorrido).toBeLessThan(1500);
    expect(container.querySelectorAll("svg").length).toBe(9);
  });
});
