// @vitest-environment jsdom
/*
 * O aviso de erro — o texto que o usuário copia, e a fronteira do app inteiro.
 *
 * A queixa foi justamente a falta de informação: "Algo travou no app" com uma
 * mensagem solta. O que resolve o problema na próxima vez é o **rastro** (a
 * linha do arquivo) e o caminho dos componentes, à mão num toque.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary, { copiarTexto, detalhesDoErro, ErroAviso } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ERRO = new Error("Cannot read properties of undefined (reading 'lat')");
ERRO.stack = "Error: Cannot read properties of undefined (reading 'lat')\n    at MapView.tsx:466";

describe("detalhesDoErro", () => {
  it("junta mensagem, rastro, componentes e navegador", () => {
    const t = detalhesDoErro(ERRO, "    at MapView\n    at main");
    expect(t).toContain("RotaCast — 20");
    expect(t).toContain("Mensagem: Cannot read properties of undefined (reading 'lat')");
    expect(t).toContain("Rastro:\nError: Cannot read properties of undefined");
    expect(t).toContain("at MapView.tsx:466");
    expect(t).toContain("Componentes:\n    at MapView");
    expect(t).toContain(`Navegador: ${navigator.userAgent}`);
  });

  it("funciona sem o caminho dos componentes", () => {
    const t = detalhesDoErro(ERRO);
    expect(t).toContain("Mensagem:");
    expect(t).not.toContain("Componentes:");
  });

  it("erro sem mensagem não vira linha vazia", () => {
    expect(detalhesDoErro(new Error(""))).toContain("Mensagem: (sem mensagem)");
  });

  it("sem erro, texto nenhum", () => {
    expect(detalhesDoErro(null)).toBe("");
  });
});

describe("copiarTexto", () => {
  it("usa a área de transferência quando ela existe", async () => {
    const writeText = vi.fn<(t: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await expect(copiarTexto("oi")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("oi");
  });

  it("sem clipboard (origem sem TLS, iframe) devolve false sem estourar", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await expect(copiarTexto("oi")).resolves.toBe(false);
  });
});

let host: HTMLDivElement;
let root: Root;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  quebrado = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  erros.mockRestore();
});

/** o app está quebrado? enquanto sim, desenhar estoura */
let quebrado = false;

function TalvezQuebre() {
  if (quebrado) throw ERRO;
  return <div data-ok>rota no ar</div>;
}

function desenhar() {
  try {
    act(() => {
      root.render(
        <ErrorBoundary>
          <TalvezQuebre />
        </ErrorBoundary>,
      );
    });
  } catch (e) {
    if (e !== ERRO) throw e;
  }
}

describe("a fronteira do app inteiro", () => {
  it("mostra o aviso com o rastro e o botão de recarregar", () => {
    quebrado = true;
    desenhar();
    const t = host.textContent ?? "";
    expect(t).toContain("Algo travou no app");
    expect(t).toContain("Cannot read properties of undefined (reading 'lat')");
    expect(t).toContain("Recarregar o mapa");
    const caixa = host.querySelector("textarea");
    expect(caixa?.value).toContain("MapView.tsx:466");
    expect(caixa?.value).toContain("Componentes:");
  });

  it('"Tentar de novo" volta para a tela normal', () => {
    quebrado = true;
    desenhar();
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === "Tentar de novo");
    expect(b).toBeDefined();
    // o app por baixo já está bom de novo (era um quadro só)
    quebrado = false;
    act(() => b!.click());
    expect(host.querySelector("[data-ok]")).not.toBeNull();
    expect(host.textContent).not.toContain("Algo travou no app");
  });

  it("sem erro, é só um pedaço invisível da árvore", () => {
    desenhar();
    expect(host.querySelector("[data-ok]")).not.toBeNull();
    expect(host.textContent).toBe("rota no ar");
  });
});

describe("a caixa compacta (o mapa)", () => {
  it("não oferece recarregar a página: o resto do app está de pé", () => {
    act(() => {
      root.render(
        <ErroAviso
          compacto
          titulo="O mapa travou"
          mensagem={ERRO.message}
          texto="detalhes"
          onTentar={() => undefined}
        />,
      );
    });
    const t = host.textContent ?? "";
    expect(t).toContain("O mapa travou");
    expect(t).toContain("O resto do app continua funcionando");
    expect(t).toContain("Tentar de novo");
    expect(t).not.toContain("Recarregar o mapa");
  });
});
