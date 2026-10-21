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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  blocos = { needed: 300, fits: true, sugestao: null },
  avisoSalvar = null,
  avisoRapido,
  onImportGpx = () => undefined,
  musica = null,
}: {
  inicial?: Partial<Settings>;
  cobertura?: { ele: number; time: number };
  blocos?: {
    needed: number;
    mapa?: number;
    relevo?: number;
    fits: boolean;
    sugestao: number | null;
    limite?: number;
    limiteComFolga?: number;
  };
  avisoSalvar?: string | null;
  /** `null` = o navegador suporta o ⚡; texto = motivo de não suportar */
  avisoRapido?: string | null;
  onImportGpx?: (f: File) => void;
  musica?: { nome: string; duracao: number } | null;
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
      blocos={blocos}
      onUseZoom={(z) => update("followZoom", z)}
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
      onImportGpx={onImportGpx}
      onExportGpx={nada}
      gpxMsg={null}
      avisoSalvar={avisoSalvar}
      avisoRapido={avisoRapido}
      resumo={{ distanceM: TRACK.total, elevation: null, time: null, points: TRACK.pts.length }}
          cartela={null}
      musica={musica}
      onMusica={nada}
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

describe("painel: aviso de gravação das preferências", () => {
  it("avisa quando a foto não pôde ser salva, sem esconder o porquê", () => {
    montar(<Painel avisoSalvar="A foto é grande demais para salvar as preferências." />);
    expect(container.textContent ?? "").toContain("A foto é grande demais");
  });

  it("sem problema, não mostra aviso nenhum", () => {
    montar(<Painel />);
    expect(container.textContent ?? "").not.toContain("grande demais");
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

  it("mostra quantos blocos de mapa a rota precisa", () => {
    montar(<Painel blocos={{ needed: 924, fits: true, sugestao: null }} />);
    expect(container.textContent ?? "").toContain("≈ 924 blocos de mapa");
  });

  it("avisa e oferece o zoom que cabe quando a rota é longa demais", () => {
    montar(<Painel blocos={{ needed: 7237, fits: false, sugestao: 13.5 }} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("7237 blocos de mapa");
    expect(texto).toContain("acima do limite");
    clicar(botao("Usar zoom"));
    // o botão aplica o zoom no mesmo estado que alimenta o controle
    expect(container.textContent ?? "").toContain("zoom 13.5");
  });

  it("quando nem o zoom mínimo cabe, manda para a câmera “Rota toda”", () => {
    montar(<Painel blocos={{ needed: 9000, fits: false, sugestao: null }} />);
    expect(container.textContent ?? "").toContain("Nem no zoom mínimo cabe");
    expect(container.textContent ?? "").toContain("Rota toda");
  });

  it("explica o que a câmera faz, e que no “Rota toda” ela não vale", () => {
    montar(<Painel />);
    clicar(botao("Câmera cinematográfica"));
    expect(container.textContent ?? "").toContain("Abertura sobrevoando a região");
    clicar(botao("Rota toda"));
    expect(container.textContent ?? "").toContain("Só vale na câmera");
  });
});

describe("painel: terceira pessoa", () => {
  it("nasce desligada e o clique liga", () => {
    montar(<Painel />);
    expect(botao("Terceira pessoa").getAttribute("aria-checked")).toBe("false");
    clicar(botao("Terceira pessoa"));
    expect(botao("Terceira pessoa").getAttribute("aria-checked")).toBe("true");
  });

  it("o giro do mapa só aparece depois de ligar a terceira pessoa", () => {
    montar(<Painel />);
    // desligada, o giro não é oferecido: seriam dois interruptores para a mesma
    // ideia, e o de baixo sozinho não faz nada
    expect(() => botao("Girar o mapa com o rumo")).toThrow();
    clicar(botao("Terceira pessoa"));
    expect(botao("Girar o mapa com o rumo").getAttribute("aria-checked")).toBe("false");
    clicar(botao("Girar o mapa com o rumo"));
    expect(botao("Girar o mapa com o rumo").getAttribute("aria-checked")).toBe("true");
  });

  it("a inclinação do horizonte vem ligada e pode ser desligada", () => {
    montar(<Painel />);
    clicar(botao("Terceira pessoa"));
    expect(botao("Inclinar o horizonte").getAttribute("aria-checked")).toBe("true");
    clicar(botao("Inclinar o horizonte"));
    expect(botao("Inclinar o horizonte").getAttribute("aria-checked")).toBe("false");
  });

  it("explica o que muda no quadro", () => {
    montar(<Painel />);
    clicar(botao("Terceira pessoa"));
    const texto = container.textContent ?? "";
    expect(texto).toContain("abaixo do centro");
    expect(texto).toContain("roda no rumo");
    expect(texto).toContain("horizonte");
  });

  it("no “Rota toda” avisa que ela não vale", () => {
    montar(<Painel inicial={{ cameraMode: "fit", thirdPerson: true }} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Só vale na câmera");
    expect(() => botao("Girar o mapa com o rumo")).toThrow();
  });
});

/*
 * O seletor de arquivo do GPX.
 *
 * Três defeitos somados deixavam o import impossível em parte dos aparelhos:
 *
 * 1. o botão chamava `input.click()` num input com `display: none` — e no Safari
 *    (iPhone/iPad) isso **não abre** o seletor. Nada acontecia: nem arquivo
 *    escolhido, nem mensagem;
 * 2. o `accept` filtrou o seletor. No Android ele filtra por **tipo MIME**, e um
 *    `.gpx` baixado do Strava chega como `application/octet-stream`, `text/plain`
 *    ou com o nome sem extensão — mesmo a lista larga deixava arquivo apagado em
 *    alguns aparelhos. Apagado é "escolhi e não abre";
 * 3. limpar o `value` do input no meio do `change` invalida o `File` recém
 *    escolhido no Safari do iPhone — a leitura falhava sem o usuário ter feito
 *    nada de errado.
 *
 * O conserto: quem abre o seletor é o **rótulo**, sem JavaScript no meio; o
 * input **não tem filtro** (quem valida o conteúdo é o `parseGpx`, com recado
 * claro); e o `value` é limpo no fim da fila, depois que o arquivo já foi lido.
 */
describe("painel: importar GPX", () => {
  const campo = () =>
    document.body.querySelector('input[type="file"]') as HTMLInputElement | null;

  it("o input existe, sem filtro de tipo e sem `display: none`", () => {
    montar(<Painel />);
    const input = campo();
    expect(input).not.toBeNull();
    // o que o Safari precisa: nada de `hidden`
    expect(input!.className).toContain("sr-only");
    expect(input!.className).not.toContain("hidden");
    /*
     * E o que o Android precisa: **nenhum filtro**. Qualquer lista de tipos
     * deixa de fora algum aparelho (MIME trocado, nome sem extensão, arquivo
     * vindo da nuvem) — e arquivo filtrado aparece apagado no seletor, que o
     * usuário lê como "não deixa abrir".
     */
    expect(input!.accept).toBe("");
  });

  it("clicar no rótulo ativa o input (quem abre o seletor é o navegador)", () => {
    montar(<Painel />);
    const input = campo()!;
    let ativado = 0;
    // o clique programático do rótulo é o que o navegador faz sozinho; aqui ele
    // é simulado para provar que o input está **dentro** dele
    input.addEventListener("click", () => {
      ativado++;
    });
    const rotulo = input.closest("label");
    expect(rotulo).not.toBeNull();
    expect((rotulo!.textContent ?? "")).toContain("Importar");
    act(() => rotulo!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(ativado).toBe(1);
  });

  it("escolher um arquivo entrega o `File` para o app", async () => {
    const recebidos: File[] = [];
    montar(<Painel onImportGpx={(f) => recebidos.push(f)} />);
    const input = campo()!;
    const arquivo = new File(["<gpx/>"], "rota.gpx", { type: "application/gpx+xml" });
    Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].name).toBe("rota.gpx");
    // e o campo é limpo, para dar para escolher o mesmo arquivo de novo —
    // no fim da fila, para não invalidar o `File` que acabou de ser lido
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("entrega arquivo sem extensão e sem tipo (o `StravaGPX` cru)", () => {
    const recebidos: File[] = [];
    montar(<Painel onImportGpx={(f) => recebidos.push(f)} />);
    const input = campo()!;
    // é como muitos aparelhos entregam o GPX: nome sem extensão, tipo vazio
    const arquivo = new File(["<gpx/>"], "StravaGPX", { type: "" });
    Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].name).toBe("StravaGPX");
  });
});

describe("painel: o ⚡ desligado diz se o navegador daria conta", () => {
  it("desligado num navegador capaz, oferece ligar ali mesmo", () => {
    montar(<Painel inicial={{ fastExport: false }} avisoRapido={null} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("mas este navegador suporta");
    expect(texto).not.toContain("não rodaria");
    clicar(botao("Ligar o ⚡"));
    expect(botao("Exportação rápida").getAttribute("aria-checked")).toBe("true");
    // o aviso de "desligado" some junto com o problema
    expect(container.textContent ?? "").not.toContain("Ligar o ⚡");
  });

  it("desligado num navegador sem WebCodecs, diz o motivo", () => {
    montar(
      <Painel
        inicial={{ fastExport: false }}
        avisoRapido="este navegador não tem WebCodecs (a exportação rápida precisa dele)"
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("não rodaria: este navegador não tem WebCodecs");
    expect(texto).not.toContain("Ligar o ⚡");
  });

  it("ligado, não repete a conversa do interruptor", () => {
    montar(<Painel avisoRapido={null} />);
    expect(container.textContent ?? "").not.toContain("mas este navegador suporta");
  });
});

describe("painel: o botão de gravar anuncia o motor", () => {
  it("com o ⚡ disponível, o botão promete a exportação rápida", () => {
    montar(<Painel avisoRapido={null} />);
    expect(botao("Gravar e baixar vídeo").textContent ?? "").toContain("(⚡)");
  });

  it("com o ⚡ desligado, o botão já diz que é tempo real", () => {
    montar(<Painel inicial={{ fastExport: false }} avisoRapido={null} />);
    expect(botao("Gravar em tempo real")).not.toBeNull();
    const textos = Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(textos.some((t) => t.includes("Gravar e baixar vídeo"))).toBe(false);
  });

  it("com o ⚡ recusado pelo navegador, também é tempo real", () => {
    montar(<Painel avisoRapido="este navegador não tem WebCodecs" />);
    expect(botao("Gravar em tempo real")).not.toBeNull();
  });
});

describe("painel: mapa em miniatura", () => {
  it("nasce ligado e o clique desliga", () => {
    montar(<Painel />);
    expect(botao("Mapa em miniatura").getAttribute("aria-checked")).toBe("true");
    // o texto diz onde ele aparece no vídeo
    expect(container.textContent ?? "").toContain("abaixo do título");
    // e não promete mapa de fundo: o canto é só o contorno
    expect(container.textContent ?? "").toContain("só o contorno");
    clicar(botao("Mapa em miniatura"));
    expect(botao("Mapa em miniatura").getAttribute("aria-checked")).toBe("false");
    expect(container.textContent ?? "").not.toContain("abaixo do título");
  });
});

describe("painel: avatar do personagem", () => {
  it("oferece a foto do avatar e explica que ela substitui o emoji", () => {
    montar(<Painel />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Avatar (no lugar do emoji)");
    expect(texto).toContain("vale o emoji do personagem escolhido");
    // o campo de foto é um input de arquivo dentro de um rótulo (o Safari
    // precisa disso) e aceita imagem
    const arquivo = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
    expect(arquivo).not.toBeNull();
  });
});

/*
 * O link da tabela de preços.
 *
 * O erro que ele evita é silencioso: o endereço é **relativo** e a página mora
 * em `public/`, que o Vite copia para o build. Se alguém mover o arquivo (ou
 * trocar o link por um caminho absoluto a partir da raiz do site), o painel no
 * Pages — que publica em `/Mapa/` — passa a abrir um 404 sem nenhum aviso.
 */
describe("painel: link da tabela de preços", () => {
  it("aponta para a página publicada, em caminho relativo", () => {
    montar(<Painel />);
    const link = Array.from(document.body.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("tabela de preços"),
    );
    expect(link).toBeDefined();
    // relativo: vale na máquina local, na prévia e em /Mapa/ no Pages
    expect(link!.getAttribute("href")).toBe("comercial/precos.html");
    expect(link!.getAttribute("target")).toBe("_blank");
    // e sem abrir a janela de origem para a página
    expect(link!.getAttribute("rel")).toContain("noopener");
  });
});

describe("painel: prévia de percurso", () => {
  /*
   * Sem hora no arquivo não existe ritmo nem relógio. O HUD do vídeo passa a
   * mostrar a inclinação do trecho (ou quanto falta) — e o painel **diz** isso,
   * porque um número diferente no anel, sem explicação, parece defeito.
   */
  it("avisa que o HUD vira prévia de percurso quando o arquivo não tem hora", () => {
    montar(<Painel cobertura={{ ele: 0, time: 0 }} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("prévia de percurso");
    expect(texto).toContain("Tempo inventado não entra no vídeo");
  });

  it("num arquivo com hora não há o que avisar", () => {
    montar(<Painel cobertura={{ ele: 1, time: 1 }} />);
    expect(container.textContent ?? "").not.toContain("prévia de percurso");
  });

  it("com o HUD desligado o aviso também sai", () => {
    montar(<Painel inicial={{ showHud: false }} cobertura={{ ele: 0, time: 0 }} />);
    expect(container.textContent ?? "").not.toContain("prévia de percurso");
  });
});

describe("painel: som do vídeo", () => {
  /*
   * O som tem duas camadas com origens diferentes: os pops são gerados pelo
   * app, a música é arquivo do usuário. O painel precisa dizer as duas coisas —
   * e o resumo no canto (mudo / pops / música + pops) é a leitura rápida do que
   * vai sair no arquivo.
   */
  it("nasce com os pops ligados", () => {
    montar(<Painel />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Pops na largada");
    expect(texto).toContain("pops");
  });

  it("sem pops e sem música, o vídeo é mudo", () => {
    montar(<Painel inicial={{ som: false }} />);
    expect(container.textContent ?? "").toContain("mudo");
  });

  it("o clique no interruptor desliga os pops", () => {
    montar(<Painel />);
    clicar(botao("Pops na largada"));
    expect(container.textContent ?? "").toContain("mudo");
  });

  it("com música escolhida, mostra nome, duração e volume", () => {
    montar(<Painel musica={{ nome: "trilha.mp3", duracao: 95 }} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("trilha.mp3");
    expect(texto).toContain("1:35");
    expect(texto).toContain("música + pops");
    expect(texto).toContain("Volume");
    // e avisa o que vai acontecer com uma faixa mais longa que o vídeo
    expect(texto).toContain("corta no fim");
  });

  it("a música vale só nesta sessão — o painel diz isso", () => {
    montar(<Painel />);
    expect(container.textContent ?? "").toContain("não fica salva");
  });
});

describe("painel: relevo", () => {
  /*
   * O sombreado vem de outro servidor, com o próprio teto — o painel mostra as
   * duas contas separadas, para o relevo não parecer que "gasta" o zoom.
   */
  it("oferece o interruptor desligado, com o que ele faz", () => {
    montar(<Painel />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Relevo (luz e sombra do terreno)");
    expect(texto).toContain("Não é 3D");
  });

  it("ligado, avisa que a sombra vem de outro servidor, com teto próprio", () => {
    montar(<Painel inicial={{ relevo: true }} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("sombra do mesmo pedaço");
    expect(texto).toContain("outro servidor, com o seu próprio teto");
    // e o número não é "o dobro": acima do z16 as sombras se repetem
    expect(texto).toContain("menos do que o dobro");
  });

  it("o contador separa o mapa do relevo, cada um no seu servidor", () => {
    montar(
      <Painel
        inicial={{ relevo: true }}
        blocos={{ needed: 1395, mapa: 1395, relevo: 229, fits: true, sugestao: null, limite: 1400 }}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("1395 blocos de mapa + 229 de relevo");
    // o total somado não aparece: cada servidor responde pelo seu
    expect(texto).not.toContain("1624");
  });

  it("acima do teto, diz o limite por servidor e oferece o zoom que cabe", () => {
    montar(
      <Painel
        inicial={{ relevo: true }}
        blocos={{
          needed: 1780,
          mapa: 1780,
          relevo: 640,
          fits: false,
          sugestao: 15,
          limite: 1400,
          limiteComFolga: 1540,
        }}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("1780 blocos de mapa + 640 de relevo");
    expect(texto).toContain("1400 por servidor, folga até 1540");
    expect(texto).toContain("Usar zoom 15");
  });

  it("na folga, avisa que passou do teto redondo mas cabe", () => {
    // 16 km no zoom 17: 1.490 blocos com a terceira pessoa inclinada — 6%
    // acima do 1.400, dentro da folga. Antes o zoom caía para 12.
    montar(
      <Painel
        inicial={{ relevo: true }}
        blocos={{
          needed: 1490,
          mapa: 1490,
          relevo: 181,
          fits: true,
          sugestao: null,
          limite: 1400,
          limiteComFolga: 1540,
        }}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("1490 blocos de mapa + 181 de relevo");
    expect(texto).toContain("dentro da folga do limite (1540 por servidor)");
  });

  it("no mapa Topo não há o que sombrear — e o painel explica", () => {
    montar(<Painel inicial={{ basemap: "topo", relevo: true }} />);
    expect(container.textContent ?? "").toContain("já traz o relevo");
    // e o interruptor aparece desligado: o vídeo não vai sombrear nada
    const toggle = botao("Relevo (luz e sombra do terreno)");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
