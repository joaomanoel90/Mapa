/**
 * Ler o conteúdo de um arquivo escolhido pelo usuário — do jeito que funciona
 * em qualquer navegador.
 *
 * O caminho "moderno" (`file.text()`) existe desde 2019 e é o que o app usava.
 * Só que ele **não existe em todo navegador**: WebViews antigos de Android,
 * Safari de iOS até 13 e navegadores embutidos de aplicativos (o Instagram, o
 * WhatsApp, o Gmail) podem não ter. Onde ele falta, chamar `file.text()` lança
 * `TypeError: file.text is not a function` — e o app, que só tratava erro de
 * GPX, mostrava o aviso genérico *"Não foi possível ler o arquivo. Verifique se
 * é um GPX válido."*, culpando o arquivo por um problema do navegador.
 *
 * É exatamente o que o usuário viu: o GPX dele é válido (o arquivo de 456 KB,
 * 5.704 pontos, importa normalmente aqui), mas no aparelho dele não entrava.
 *
 * Aqui o `FileReader` — suportado desde o IE10 — é o caminho de reserva, e a
 * falha de cada um vem com o motivo certo.
 */

/** O arquivo chegou vazio (0 byte) — comum ao escolher direto da nuvem. */
export class ArquivoVazioError extends Error {
  constructor(nome: string) {
    super(
      `O arquivo "${nome}" chegou vazio (0 KB). Se ele está na nuvem (Drive, iCloud), ` +
        "abra e salve no aparelho primeiro; depois escolha de novo.",
    );
  }
}

/** Nenhum dos dois leitores funcionou. */
export class LeituraIndisponivelError extends Error {
  constructor(nome: string, motivo?: string) {
    super(
      `Não foi possível abrir o arquivo "${nome}" neste navegador` +
        (motivo ? ` (${motivo})` : "") +
        ". Se ele está na nuvem, salve no aparelho antes de escolher.",
    );
  }
}

/**
 * O texto do arquivo.
 *
 * - usa `file.text()` quando existe;
 * - cai para o `FileReader` quando não existe (ou quando o `text()` falha, o
 *   que acontece com alguns arquivos entregues por provedores de conteúdo do
 *   Android);
 * - recusa arquivo vazio com uma mensagem que diz o que fazer.
 */
export async function lerTextoDoArquivo(file: Blob, nome?: string): Promise<string> {
  const rotulo = nome ?? (file as Blob & { name?: string }).name ?? "arquivo";
  if (file.size === 0) throw new ArquivoVazioError(rotulo);

  const moderno = file as Blob & { text?: () => Promise<string> };
  if (typeof moderno.text === "function") {
    try {
      const texto = await moderno.text();
      /*
       * Arquivo que "existe" mas não entrega nada: o provedor de conteúdo do
       * Android faz isso quando a permissão expira no meio da leitura. Vale
       * tentar o outro caminho antes de desistir.
       */
      if (texto && texto.length > 0) return texto;
    } catch {
      /* segue para o FileReader */
    }
  }

  if (typeof FileReader === "undefined") {
    throw new LeituraIndisponivelError(rotulo, "sem FileReader");
  }

  return new Promise<string>((resolve, reject) => {
    let leitor: FileReader;
    try {
      leitor = new FileReader();
    } catch (err) {
      reject(new LeituraIndisponivelError(rotulo, err instanceof Error ? err.message : undefined));
      return;
    }
    leitor.onload = () => {
      const resultado = leitor.result;
      if (typeof resultado === "string" && resultado.length > 0) {
        resolve(resultado);
      } else {
        reject(new LeituraIndisponivelError(rotulo, "o arquivo não devolveu conteúdo"));
      }
    };
    leitor.onerror = () => {
      reject(new LeituraIndisponivelError(rotulo, leitor.error?.message ?? "erro de leitura"));
    };
    try {
      leitor.readAsText(file);
    } catch (err) {
      reject(new LeituraIndisponivelError(rotulo, err instanceof Error ? err.message : undefined));
    }
  });
}
