/**
 * Fotos do projeto: nas paradas do percurso e na cartela final.
 *
 * Duas decisões que valem explicação, porque não são óbvias:
 *
 * 1. **A foto é reduzida antes de ser guardada.** Uma foto de celular tem
 *    4.000 px de lado e 4 MB. Guardada como veio, ela estouraria o
 *    `localStorage` (que tem ~5 MB para tudo) e cada quadro do vídeo desenharia
 *    uma imagem gigante reduzida na hora. Aqui ela é redesenhada num canvas com
 *    no máximo 640 px de lado e vira JPEG — o suficiente para a cartela e para a
 *    etiqueta da parada, que são pequenas na tela.
 * 2. **A foto não entra no link compartilhado.** O permalink é uma descrição
 *    compacta da cena (polyline + ajustes); uma foto de 640 px vira ~70 KB de
 *    texto, e uma por parada faria um link que ninguém consegue enviar por
 *    mensagem. Quem abre o link vê a mesma cena, sem as fotos — e a tela avisa
 *    isso onde a foto é escolhida.
 *
 * As contas que dá para conferir sem navegador (tamanho alvo, bytes, recorte
 * quadrado) ficam aqui como funções puras; só a parte que depende de canvas
 * (`downscaleImage`) toca o navegador.
 */

/** Lado maior de uma foto guardada, em pixels. */
export const PHOTO_MAX_PX = 640;

/** Qualidade do JPEG gerado (0..1). */
export const PHOTO_QUALITY = 0.82;

/** Teto do arquivo aceito — acima disso a aba trava ao decodificar. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/** Teto do texto guardado (data URL) — protege o `localStorage`. */
export const PHOTO_MAX_CHARS = 400_000;

/** Quanto tempo o vídeo espera pelas fotos antes de seguir sem elas. */
export const PHOTO_WAIT_MS = 5_000;

/** Imagem já decodificada, pronta para `drawImage`. */
export type PhotoImage = HTMLImageElement | ImageBitmap;

/**
 * O que o renderizador enxerga das fotos.
 *
 * É uma interface (e não o cache inteiro) porque o desenho só precisa olhar:
 * ou a foto está pronta, ou não está — e não estando, o desenho simplesmente
 * não a mostra, em vez de esperar.
 */
export type PhotoLookup = {
  get(src: string | null | undefined): PhotoImage | null;
};

/* ------------------------------------------------------------------ */
/* Contas puras                                                        */
/* ------------------------------------------------------------------ */

/** Reduz `w×h` para caber em `max` no lado maior, sem esticar além do original. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const largura = Math.max(1, Math.round(w));
  const altura = Math.max(1, Math.round(h));
  const maior = Math.max(largura, altura);
  if (!(maior > max)) return { w: largura, h: altura };
  const f = max / maior;
  return { w: Math.max(1, Math.round(largura * f)), h: Math.max(1, Math.round(altura * f)) };
}

/**
 * Bytes aproximados de um data URL.
 *
 * Cada 4 caracteres base64 são 3 bytes, e o `=` do fim não conta. Não é para
 * ser exato: é para a tela dizer "≈ 68 KB" e o aviso de foto grande fazer
 * sentido sem precisar decodificar.
 */
export function estimateBytes(dataUrl: string): number {
  const virgula = dataUrl.indexOf(",");
  if (virgula < 0) return 0;
  const corpo = dataUrl.slice(virgula + 1).trim();
  const enchimento = corpo.endsWith("==") ? 2 : corpo.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((corpo.length * 3) / 4) - enchimento);
}

/** "68 KB", "1,2 MB" — para a tela, com vírgula decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1).replace(".", ",") : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Recorte quadrado centralizado (o que o `drawImage` precisa para preencher um
 * círculo ou um quadrado sem distorcer).
 *
 * O renderizador usa isto tanto no avatar da cartela (círculo) quanto na foto
 * polaroide da parada (quadrado): previsível, sem esticar a foto.
 */
export function coverSquare(w: number, h: number): { sx: number; sy: number; size: number } {
  const largura = Math.max(1, w);
  const altura = Math.max(1, h);
  const size = Math.min(largura, altura);
  return {
    sx: (largura - size) / 2,
    sy: (altura - size) / 2,
    size,
  };
}

/** O arquivo pode ser usado como foto? Devolve o motivo quando não pode. */
export function checkImageFile(file: { type?: string; size?: number }): string | null {
  const tipo = file.type ?? "";
  if (!tipo.startsWith("image/")) {
    return "Este arquivo não é uma imagem. Use JPG, PNG ou WebP.";
  }
  const tamanho = file.size ?? 0;
  if (tamanho > PHOTO_MAX_BYTES) {
    return `A imagem tem ${formatBytes(tamanho)} — acima do limite de ${formatBytes(PHOTO_MAX_BYTES)}.`;
  }
  if (tamanho === 0) return "O arquivo está vazio.";
  return null;
}

/** O texto guardado parece uma foto válida? (data URL de imagem, dentro do teto) */
export function isPhotoDataUrl(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  if (valor.length === 0 || valor.length > PHOTO_MAX_CHARS) return false;
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(valor);
}

/* ------------------------------------------------------------------ */
/* Navegador: decodificar e reduzir                                    */
/* ------------------------------------------------------------------ */

/** Decodifica um data URL numa imagem pronta para desenhar. */
async function decodeDataUrl(src: string): Promise<PhotoImage | null> {
  const img = new Image();
  img.src = src;
  try {
    // `decode()` resolve quando a imagem está pronta para o canvas; sem ele, o
    // primeiro quadro sairia vazio e o vídeo começaria sem a foto
    if (typeof img.decode === "function") await img.decode();
    else await new Promise<void>((ok, erro) => {
      img.onload = () => ok();
      img.onerror = () => erro(new Error("não decodificou"));
    });
    return img;
  } catch {
    return null;
  }
}

/**
 * Reduz a foto escolhida e devolve um data URL JPEG.
 *
 * `createImageBitmap` é preferido porque respeita a orientação EXIF da câmera
 * (`imageOrientation: "from-image"`) — sem isso, foto de celular deitado
 * apareceria girada. Quando o navegador não tem, cai para `<img>` + canvas.
 */
export async function downscaleImage(
  file: Blob,
  max = PHOTO_MAX_PX,
  qualidade = PHOTO_QUALITY,
): Promise<string> {
  const fonte = await abrirImagem(file);
  const { w, h } = fitSize(fonte.width, fonte.height, max);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador não conseguiu preparar a imagem.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte.imagem as CanvasImageSource, 0, 0, w, h);
  liberar(fonte);

  const url = canvas.toDataURL("image/jpeg", qualidade);
  if (!isPhotoDataUrl(url)) {
    throw new Error("A imagem não pôde ser convertida. Tente outra foto.");
  }
  return url;
}

type Fonte = { imagem: PhotoImage; width: number; height: number; fechar?: () => void };

async function abrirImagem(file: Blob): Promise<Fonte> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { imagem: bmp, width: bmp.width, height: bmp.height, fechar: () => bmp.close() };
    } catch {
      // formato que o navegador não abriu direto: tenta pelo <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((ok, erro) => {
      img.onload = () => ok();
      img.onerror = () => erro(new Error("não foi possível abrir a imagem"));
    });
    return {
      imagem: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      fechar: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function liberar(f: Fonte) {
  try {
    f.fechar?.();
  } catch {
    /* nada a fazer */
  }
}

/**
 * Todas as fotos que o vídeo pode desenhar, sem repetição.
 *
 * Existe porque essa lista já foi montada à mão no app, e a mão esqueceu as
 * fotos de partida e chegada: elas ficavam fora do cache, o desenho pedia a
 * imagem, recebia `null` — e a foto nunca aparecia no vídeo, enquanto as das
 * paradas apareciam normalmente. Uma função só, testada, evita o esquecimento.
 */
export function photoSources(
  ...listas: (string | null | undefined)[][]
): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const lista of listas) {
    for (const src of lista) {
      if (!src || vistas.has(src)) continue;
      vistas.add(src);
      out.push(src);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cache de fotos prontas                                              */
/* ------------------------------------------------------------------ */

/**
 * Guarda as fotos **já decodificadas** por data URL.
 *
 * O desenho do vídeo é síncrono e roda 30 vezes por segundo: não dá para
 * esperar imagem dentro do laço. Aqui a decodificação acontece uma vez, e o
 * desenho só consulta (`get`) — quem não estiver pronto simplesmente não
 * aparece naquele quadro.
 *
 * O decodificador é injetável para os testes: em jsdom não existe canvas nem
 * `Image` de verdade, e o que interessa testar é a lógica do cache (pedir uma
 * vez, guardar o resultado, não travar esperando para sempre).
 */
export class PhotoCache implements PhotoLookup {
  private prontas = new Map<string, PhotoImage | null>();
  private pendentes = new Map<string, Promise<void>>();
  private decodificar: (src: string) => Promise<PhotoImage | null>;

  constructor(decodificar: (src: string) => Promise<PhotoImage | null> = decodeDataUrl) {
    this.decodificar = decodificar;
  }

  /** A foto está pronta? Devolve a imagem ou `null` (inclusive se falhou). */
  get(src: string | null | undefined): PhotoImage | null {
    if (!src) return null;
    return this.prontas.get(src) ?? null;
  }

  /** Já tentou decodificar (com ou sem sucesso)? */
  has(src: string | null | undefined): boolean {
    return Boolean(src) && this.prontas.has(src as string);
  }

  /** Decodifica uma foto (uma vez só) e guarda o resultado — bom ou ruim. */
  load(src: string): Promise<void> {
    if (this.prontas.has(src)) return Promise.resolve();
    const emAndamento = this.pendentes.get(src);
    if (emAndamento) return emAndamento;
    const p = this.decodificar(src)
      .catch(() => null)
      .then((img) => {
        this.prontas.set(src, img);
        this.pendentes.delete(src);
      });
    this.pendentes.set(src, p);
    return p;
  }

  /**
   * Espera as fotos pedidas antes de gravar — **com prazo**.
   *
   * Sem o prazo, uma foto corrompida (ou um navegador que nunca resolve o
   * `decode`) travaria a exportação inteira em silêncio. Melhor gravar sem a
   * foto do que não gravar.
   */
  async ready(sources: (string | null | undefined)[], timeoutMs = PHOTO_WAIT_MS): Promise<void> {
    const lista = [...new Set(sources.filter((s): s is string => Boolean(s)))];
    if (lista.length === 0) return;
    const todas = Promise.all(lista.map((s) => this.load(s)));
    if (timeoutMs <= 0) {
      await todas;
      return;
    }
    await Promise.race([
      todas,
      new Promise<void>((ok) => setTimeout(ok, timeoutMs)),
    ]);
  }

  /** Quantas fotos falharam (para a tela poder avisar). */
  get falhas(): number {
    let n = 0;
    for (const v of this.prontas.values()) if (!v) n++;
    return n;
  }
}
