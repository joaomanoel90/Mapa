// @vitest-environment jsdom
/*
 * A fronteira do mapa.
 *
 * O erro que o usuário viu — *"Algo travou no app — Cannot read properties of
 * undefined (reading 'lat')"* — chegou sem dizer onde e levou o app **inteiro**
 * junto (mapa, barra do tempo, rota, o botão de gravar). Aqui o contrato é:
 * só o mapa cai, o aviso diz em que ponto do percurso travou, um quadro ruim
 * não chega a incomodar (a fronteira retoma sozinha) e uma falha de verdade
 * para de piscar depois de `RETOMADAS` tentativas.
 *
 * O "mapa" de mentira **sempre** estoura enquanto `quebrado` for verdadeiro —
 * e não uma vez só: o React, com uma árvore concorrente, tenta o render uma
 * segunda vez antes de entregar o erro à fronteira, e um mapa que "quebra uma
 * vez só" acabava desenhando na segunda tentativa (o teste mediria a
 * recuperação do React, não a da fronteira).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CameraBoundary, { RETOMADAS } from "./CameraBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** o mapa está quebrado? enquanto sim, todo render estoura */
let quebrado = false;
/** quantas vezes o mapa foi **desenhado** (as tentativas que deram certo) */
let montagens = 0;
/** quantas vezes alguém tentou desenhar o mapa (inclusive as que estouraram) */
let tentativas = 0;

const ERRO = "Cannot read properties of undefined (reading 'lat')";

function MapaContado({ texto }: { texto: string }) {
  tentativas += 1;
  if (quebrado) throw new Error(ERRO);
  montagens += 1;
  return <div data-map>{texto}</div>;
}

let host: HTMLDivElement;
let root: Root;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  quebrado = false;
  montagens = 0;
  tentativas = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // o React já avisa no console; o teste não precisa do barulho
  erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  erros.mockRestore();
});

/** as props da fronteira que este teste usa */
type PropsDaFronteira = {
  onReiniciar?: () => void;
  onFalha?: (erro: Error) => void;
};

function desenhar(agora: number, props: PropsDaFronteira = {}) {
  try {
    act(() => {
      root.render(
        <CameraBoundary agora={agora} {...props}>
          <MapaContado texto={`quadro ${agora}`} />
        </CameraBoundary>,
      );
    });
  } catch (e) {
    /*
     * O React devolve o erro do render para quem chamou o `act`, mesmo com a
     * fronteira tendo pegado — é assim que ele avisa o teste. A fronteira já
     * fez o seu trabalho (o aviso está na tela), e é isso que o teste lê.
     */
    if (!(e instanceof Error) || e.message !== ERRO) throw e;
  }
}

const texto = () => host.textContent ?? "";
const temMapa = () => host.querySelector("[data-map]") !== null;
const aviso = () => host.querySelector("textarea")?.value ?? "";
const botao = (rotulo: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === rotulo);

describe("o mapa que trava no meio da animação", () => {
  it("um quadro ruim não interrompe o vídeo: o aviso sai quando o quadro anda", () => {
    quebrado = true;
    desenhar(0);
    // o mapa caiu, mas o aviso está no lugar dele — o app inteiro continua
    expect(temMapa()).toBe(false);
    expect(texto()).toContain("O mapa travou");
    expect(texto()).toContain(ERRO);
    const tentativasAteAqui = tentativas;

    // o quadro andou: a fronteira tenta de novo, e agora o mapa desenha
    quebrado = false;
    desenhar(0.1);
    expect(temMapa()).toBe(true);
    expect(montagens).toBe(1);
    expect(texto()).not.toContain("O mapa travou");
    expect(tentativas).toBeGreaterThan(tentativasAteAqui);
  });

  it("com o vídeo em pausa (o quadro não anda) quem decide é o usuário", () => {
    quebrado = true;
    desenhar(0.4);
    const tentativasAteAqui = tentativas;
    desenhar(0.4);
    desenhar(0.4);
    // `agora` não mudou: a fronteira não remonta o mapa sozinha
    expect(tentativas).toBe(tentativasAteAqui);
    expect(montagens).toBe(0);
    expect(texto()).toContain("O mapa travou");
  });

  it("falha de verdade para de piscar depois de RETOMADAS tentativas", () => {
    quebrado = true;
    desenhar(0);
    for (let i = 1; i <= RETOMADAS + 2; i++) desenhar(i / 100);
    const parou = tentativas;
    // o aviso fica de pé e a fronteira não insiste mais sozinha
    desenhar(0.9);
    desenhar(0.95);
    expect(tentativas).toBe(parou);
    expect(montagens).toBe(0);
    expect(temMapa()).toBe(false);
    expect(texto()).toContain("O mapa travou");
    // …mas ainda tentou algumas vezes antes de desistir
    expect(parou).toBeGreaterThanOrEqual(RETOMADAS);
  });

  it('"Tentar de novo" remonta o mapa e avisa o app', () => {
    quebrado = true;
    let reiniciou = 0;
    desenhar(0, { onReiniciar: () => (reiniciou += 1) });
    quebrado = false;
    const b = botao("Tentar de novo");
    expect(b).toBeDefined();
    act(() => b!.click());
    expect(reiniciou).toBe(1);
    expect(temMapa()).toBe(true);
    expect(texto()).not.toContain("O mapa travou");
  });

  it("o aviso diz em que ponto do percurso o mapa travou", () => {
    quebrado = true;
    desenhar(0.4213);
    expect(aviso()).toContain("No ponto 42.1% do percurso");
    expect(aviso()).toContain(`Mensagem: ${ERRO}`);
    expect(aviso()).toContain("Componentes:");
    // e a caixa é do mapa: sem o botão que recarrega a página inteira
    expect(texto()).toContain("O resto do app continua funcionando");
    expect(texto()).not.toContain("Recarregar o mapa");
  });

  it("avisa o app quando falha (para o diagnóstico)", () => {
    quebrado = true;
    const vistas: string[] = [];
    desenhar(0, { onFalha: (e) => vistas.push(e.message) });
    expect(vistas).toEqual([ERRO]);
  });
});
