// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ArquivoVazioError,
  LeituraIndisponivelError,
  lerTextoDoArquivo,
} from "./files";
import { parseGpx } from "./gpx";

/**
 * O leitor de arquivo.
 *
 * O `jsdom` **não tem** `Blob.prototype.text()` — o que faz dele um retrato
 * fiel dos navegadores onde o import do usuário falhava: WebView antigo de
 * Android, iOS até 13, navegador embutido de aplicativo. Antes, ali, o app
 * chamava `file.text()` direto e mostrava *"Não foi possível ler o arquivo.
 * Verifique se é um GPX válido."* para um GPX perfeitamente válido.
 */
describe("lerTextoDoArquivo", () => {
  const ler = (texto: string, nome = "rota.gpx", tipo = "application/gpx+xml") =>
    new File([texto], nome, { type: tipo });

  it("lê pelo FileReader quando o navegador não tem `file.text()`", async () => {
    const arquivo = ler("<gpx><trk/></gpx>");
    // confirma que o cenário é o do defeito: sem o caminho moderno
    expect((arquivo as unknown as { text?: unknown }).text).toBeUndefined();
    expect(await lerTextoDoArquivo(arquivo)).toBe("<gpx><trk/></gpx>");
  });

  it("usa o caminho moderno quando ele existe", async () => {
    const arquivo = ler("<gpx/>");
    let chamado = 0;
    (arquivo as unknown as { text: () => Promise<string> }).text = async () => {
      chamado++;
      return "<gpx modo=\"moderno\"/>";
    };
    expect(await lerTextoDoArquivo(arquivo)).toBe("<gpx modo=\"moderno\"/>");
    expect(chamado).toBe(1);
  });

  it("cai para o FileReader quando o caminho moderno falha", async () => {
    const arquivo = ler("<gpx/>");
    (arquivo as unknown as { text: () => Promise<string> }).text = async () => {
      throw new Error("NotReadableError");
    };
    expect(await lerTextoDoArquivo(arquivo)).toBe("<gpx/>");
  });

  it("cai para o FileReader quando o caminho moderno devolve vazio", async () => {
    const arquivo = ler("<gpx/>");
    (arquivo as unknown as { text: () => Promise<string> }).text = async () => "";
    expect(await lerTextoDoArquivo(arquivo)).toBe("<gpx/>");
  });

  it("arquivo de 0 byte diz o que fazer, em vez de culpar o formato", async () => {
    const vazio = new File([], "rota.gpx", { type: "application/gpx+xml" });
    await expect(lerTextoDoArquivo(vazio)).rejects.toBeInstanceOf(ArquivoVazioError);
    await expect(lerTextoDoArquivo(vazio)).rejects.toThrow(/chegou vazio/i);
    await expect(lerTextoDoArquivo(vazio)).rejects.toThrow(/nuvem/i);
  });

  it("sem leitor nenhum, o erro fala do navegador (e não do arquivo)", async () => {
    const arquivo = ler("<gpx/>");
    const antes = globalThis.FileReader;
    // @ts-expect-error: simula navegador sem FileReader
    delete globalThis.FileReader;
    try {
      const erro = await lerTextoDoArquivo(arquivo).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(LeituraIndisponivelError);
      expect((erro as Error).message).toContain("neste navegador");
    } finally {
      globalThis.FileReader = antes;
    }
  });

  it("o nome do arquivo aparece na mensagem de erro", async () => {
    const vazio = new File([], "Maratona SP.gpx");
    await expect(lerTextoDoArquivo(vazio)).rejects.toThrow(/Maratona SP\.gpx/);
  });
});

/**
 * O caminho inteiro do import, no cenário do defeito.
 *
 * Um `File` sem `.text()` (como no navegador do usuário) passa pelo
 * `FileReader`, vira XML e o `parseGpx` devolve o traçado — com o GPX real que
 * está no repositório (5.704 pontos, 21,4 km).
 */
describe("o GPX do usuário, lido do jeito antigo", () => {
  it("importa os 5.704 pontos mesmo sem `file.text()`", async () => {
    const xml = readFileSync("Maratona_internacional_de_São_Paulo.gpx", "utf8");
    const arquivo = new File([xml], "Maratona_internacional_de_São_Paulo.gpx", {
      type: "application/gpx+xml",
    });
    expect((arquivo as unknown as { text?: unknown }).text).toBeUndefined();

    const texto = await lerTextoDoArquivo(arquivo);
    const dados = parseGpx(texto);

    expect(dados.points.length).toBe(5704);
    expect(dados.name).toBe("Maratona internacional de São Paulo");
    expect(dados.segments).toBe(1);
  }, 30_000);
});
