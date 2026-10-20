// @vitest-environment jsdom
/*
 * O painel do fim da gravação quando o ⚡ estava **desligado**.
 *
 * A gravação do usuário saiu em tempo real com 65% de cadência e o painel só
 * dizia "a exportação rápida está desligada no painel". O que faltava era a
 * consequência e a saída: o mesmo navegador suportava o ⚡, e ligar o
 * interruptor resolvia. Aqui se prova que o painel oferece isso — e que, quando
 * o navegador é que não dá conta, ele não promete um botão que não resolveria.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ExportModal from "./ExportModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const nada = () => undefined;

function montar(props: Partial<React.ComponentProps<typeof ExportModal>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ExportModal
        phase="done"
        progress={1}
        canvasRef={{ current: null }}
        ext="mp4"
        fps={30}
        fpsPedido={60}
        width={720}
        height={1280}
        duration={20}
        onCancel={nada}
        onClose={nada}
        onDownload={nada}
        onRetry={nada}
        {...props}
      />,
    ),
  );
}

function botao(rotulo: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(rotulo),
    ) as HTMLButtonElement | undefined) ?? null
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("painel do fim: ⚡ desligado no painel", () => {
  it("diz que o navegador suporta e oferece ligar e gravar de novo", () => {
    let ligou = 0;
    montar({ rapidoDesligado: true, avisoMotor: null, onLigarRapido: () => ligou++ });
    const texto = container.textContent ?? "";
    expect(texto).toContain("desligado no painel");
    expect(texto).toContain("Este navegador suporta a exportação rápida");
    expect(texto).toContain("saiu em tempo real só por causa do interruptor");
    expect(texto).toContain("a 60 quadros por segundo");
    const botaoLigar = botao("Ligar e gravar de novo");
    expect(botaoLigar).not.toBeNull();
    act(() => botaoLigar!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(ligou).toBe(1);
  });

  it("sem suporte no navegador, não promete o botão", () => {
    montar({
      rapidoDesligado: true,
      avisoMotor: "este navegador não tem WebCodecs",
      onLigarRapido: nada,
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Neste navegador ele também não rodaria");
    expect(texto).toContain("este navegador não tem WebCodecs");
    expect(botao("Ligar e gravar de novo")).toBeNull();
  });

  it("ligado mas recusado pelo navegador, mantém o aviso de indisponível", () => {
    montar({ rapidoDesligado: false, avisoMotor: "este navegador não codifica H.264" });
    const texto = container.textContent ?? "";
    expect(texto).toContain("⚡ indisponível: este navegador não codifica H.264");
    expect(texto).not.toContain("desligado no painel");
    expect(botao("Ligar e gravar de novo")).toBeNull();
  });

  it("com o ⚡ rodando, não há aviso nenhum", () => {
    montar({ rapidoDesligado: false, avisoMotor: null });
    expect(container.textContent ?? "").not.toContain("⚡");
  });
});

describe("painel do fim: rota longa", () => {
  it("diz em que zoom o vídeo saiu quando o app ajustou a câmera", () => {
    montar({
      avisoRota:
        "Rota longa: esta rota precisaria de 27441 blocos no zoom escolhido. " +
        "O vídeo saiu no zoom 9, que é o que cabe nos servidores gratuitos.",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("🗺️ Rota longa");
    expect(texto).toContain("no zoom 9");
    expect(texto).toContain("blocos");
  });

  it("sem ajuste de câmera, não inventa aviso", () => {
    montar({ avisoRota: null });
    expect(container.textContent ?? "").not.toContain("Rota longa");
  });
});
