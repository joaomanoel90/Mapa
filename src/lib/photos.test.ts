import { describe, expect, it, vi } from "vitest";
import {
  PHOTO_MAX_CHARS,
  PHOTO_MAX_PX,
  PhotoCache,
  checkImageFile,
  coverSquare,
  estimateBytes,
  fitSize,
  formatBytes,
  isPhotoDataUrl,
  photoSources,
  type PhotoImage,
} from "./photos";

const imagem = (width: number, height: number) =>
  ({ width, height }) as unknown as PhotoImage;

describe("tamanho alvo da foto", () => {
  it("reduz pelo lado maior, mantendo a proporção", () => {
    expect(fitSize(4000, 3000, 640)).toEqual({ w: 640, h: 480 });
    expect(fitSize(3000, 4000, 640)).toEqual({ w: 480, h: 640 });
    expect(fitSize(1000, 1000, 640)).toEqual({ w: 640, h: 640 });
  });

  it("não aumenta uma foto pequena", () => {
    expect(fitSize(320, 200, 640)).toEqual({ w: 320, h: 200 });
    expect(fitSize(640, 480, 640)).toEqual({ w: 640, h: 480 });
  });

  it("aguenta medidas esquisitas sem devolver zero", () => {
    // imagem panorâmica muito estreita e imagem de 1 px
    const panoramica = fitSize(8000, 40, 640);
    expect(panoramica.w).toBe(640);
    expect(panoramica.h).toBeGreaterThanOrEqual(1);
    expect(fitSize(1, 1, 640)).toEqual({ w: 1, h: 1 });
    expect(fitSize(0, 0, 640)).toEqual({ w: 1, h: 1 });
  });

  it("o teto é 640 px — o suficiente para a cartela e a etiqueta", () => {
    expect(PHOTO_MAX_PX).toBe(640);
  });
});

describe("tamanho em bytes", () => {
  it("conta os bytes de um data URL", () => {
    // 8 caracteres base64 = 6 bytes
    expect(estimateBytes("data:image/jpeg;base64,AAAAAAAA")).toBe(6);
    // com enchimento: 4 caracteres válidos + "=" = 3 bytes
    expect(estimateBytes("data:image/jpeg;base64,AAA=")).toBe(2);
    expect(estimateBytes("data:image/jpeg;base64,AA==")).toBe(1);
  });

  it("não inventa número sem base64", () => {
    expect(estimateBytes("nem-url")).toBe(0);
    expect(estimateBytes("")).toBe(0);
  });

  it("escreve legível, com vírgula decimal", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1,0 KB");
    expect(formatBytes(68 * 1024)).toBe("68 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("recorte quadrado", () => {
  it("recorta o centro da foto deitada e da em pé", () => {
    expect(coverSquare(1000, 500)).toEqual({ sx: 250, sy: 0, size: 500 });
    expect(coverSquare(500, 1000)).toEqual({ sx: 0, sy: 250, size: 500 });
    expect(coverSquare(800, 800)).toEqual({ sx: 0, sy: 0, size: 800 });
  });

  it("nunca devolve medida zerada", () => {
    expect(coverSquare(0, 0).size).toBe(1);
  });
});

describe("validação do arquivo", () => {
  it("aceita imagem dentro do limite", () => {
    expect(checkImageFile({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(checkImageFile({ type: "image/png", size: 500 })).toBeNull();
  });

  it("recusa o que não é imagem, o gigante e o vazio", () => {
    expect(checkImageFile({ type: "application/pdf", size: 1000 })).toContain("não é uma imagem");
    expect(checkImageFile({ type: "image/jpeg", size: 40 * 1024 * 1024 })).toContain("acima do limite");
    expect(checkImageFile({ type: "image/jpeg", size: 0 })).toContain("vazio");
  });

  it("a lista de fotos junta cartela, paradas e partida/chegada", () => {
    // era aqui que a foto de A/B se perdia: a lista era montada à mão e elas
    // ficavam de fora, então o desenho nunca as encontrava no cache
    const cartela = "data:image/jpeg;base64,CARD";
    const parada1 = "data:image/jpeg;base64,P1";
    const partida = "data:image/jpeg;base64,A";
    const chegada = "data:image/jpeg;base64,B";
    const lista = photoSources(
      [cartela],
      [parada1, undefined, ""],
      [partida, null],
      [chegada],
    );
    expect(lista).toEqual([cartela, parada1, partida, chegada]);
  });

  it("a lista não repete a mesma foto e ignora o que não é foto", () => {
    // a mesma foto numa parada e na partida é decodificada uma vez só
    expect(photoSources(["x"], ["x", "y"], [null, undefined, ""])).toEqual(["x", "y"]);
    expect(photoSources()).toEqual([]);
  });

  it("reconhece um data URL de imagem e recusa o resto", () => {
    expect(isPhotoDataUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isPhotoDataUrl("data:image/png;base64,AA==")).toBe(true);
    expect(isPhotoDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isPhotoDataUrl("https://exemplo.com/foto.jpg")).toBe(false);
    expect(isPhotoDataUrl("")).toBe(false);
    expect(isPhotoDataUrl(null)).toBe(false);
    // acima do teto de texto: protege o localStorage
    expect(isPhotoDataUrl(`data:image/jpeg;base64,${"A".repeat(PHOTO_MAX_CHARS)}`)).toBe(false);
  });
});

describe("cache de fotos", () => {
  it("decodifica uma vez só, mesmo pedindo várias", async () => {
    const decodificar = vi.fn(async () => imagem(640, 480));
    const cache = new PhotoCache(decodificar);
    await Promise.all([cache.load("foto"), cache.load("foto"), cache.load("foto")]);
    expect(decodificar).toHaveBeenCalledTimes(1);
    expect(cache.get("foto")).not.toBeNull();
  });

  it("antes de decodificar, `get` devolve null (o desenho segue sem a foto)", () => {
    const cache = new PhotoCache(async () => imagem(100, 100));
    expect(cache.get("foto")).toBeNull();
    expect(cache.has("foto")).toBe(false);
  });

  it("foto que falha não fica pendente para sempre", async () => {
    const cache = new PhotoCache(async () => {
      throw new Error("arquivo corrompido");
    });
    await cache.load("ruim");
    expect(cache.has("ruim")).toBe(true);
    expect(cache.get("ruim")).toBeNull();
    expect(cache.falhas).toBe(1);
  });

  it("`ready` espera as fotos pedidas, sem repetir nem pedir o vazio", async () => {
    const decodificar = vi.fn(async () => imagem(640, 640));
    const cache = new PhotoCache(decodificar);
    await cache.ready(["a", null, undefined, "b", "a"]);
    expect(decodificar).toHaveBeenCalledTimes(2);
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("b")).not.toBeNull();
  });

  it("uma foto que nunca resolve não trava a exportação (prazo)", async () => {
    // este é o caso que importa: sem prazo, o vídeo nunca começaria a gravar
    const travada = new Promise<PhotoImage | null>(() => undefined);
    const cache = new PhotoCache(() => travada);
    const t0 = Date.now();
    await cache.ready(["travada"], 40);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(cache.get("travada")).toBeNull();
  });

  it("sem foto nenhuma, `ready` não faz nada", async () => {
    const decodificar = vi.fn(async () => imagem(10, 10));
    const cache = new PhotoCache(decodificar);
    await cache.ready([null, undefined]);
    expect(decodificar).not.toHaveBeenCalled();
  });
});
