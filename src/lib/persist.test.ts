import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import {
  decodeSettings,
  loadEndpoints,
  loadSettings,
  saveEndpoints,
  saveSettings,
} from "./persist";

/** Armazenamento de mentira que estoura quando o texto passa de `limite`. */
function storageComLimite(limite = Infinity) {
  const dados = new Map<string, string>();
  return {
    dados,
    setItem(chave: string, valor: string) {
      if (valor.length > limite) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      dados.set(chave, valor);
    },
    getItem(chave: string) {
      return dados.get(chave) ?? null;
    },
  };
}

const FOTO = "data:image/jpeg;base64," + "A".repeat(2000);
const comFoto: Settings = { ...DEFAULT_SETTINGS, cardPhoto: FOTO, title: "Pedal" };

describe("gravar preferências", () => {
  it("grava normalmente quando cabe", () => {
    const s = storageComLimite();
    expect(saveSettings(s, comFoto)).toBe("ok");
    expect(s.getItem("rotacast:settings")).toContain("Pedal");
  });

  it("quando a foto não cabe, grava o resto e diz o que fez", () => {
    // a cota estoura por causa da foto: o usuário não pode perder os ajustes
    const s = storageComLimite(1500);
    const resultado = saveSettings(s, comFoto);
    expect(resultado).toBe("sem-foto");
    const guardado = JSON.parse(s.getItem("rotacast:settings") as string) as Settings;
    expect(guardado.cardPhoto).toBe("");
    expect(guardado.title).toBe("Pedal");
  });

  it("avisa quando nem sem a foto coube", () => {
    const s = storageComLimite(10);
    expect(saveSettings(s, comFoto)).toBe("falhou");
  });

  it("o logo também sai quando é ele que estoura a cota", () => {
    // uma imagem só, sem foto do projeto: o logo tem o mesmo tratamento
    const comLogo: Settings = { ...DEFAULT_SETTINGS, logo: FOTO, title: "Pedal" };
    const s = storageComLimite(1500);
    expect(saveSettings(s, comLogo)).toBe("sem-foto");
    const guardado = JSON.parse(s.getItem("rotacast:settings") as string) as Settings;
    expect(guardado.logo).toBe("");
    expect(guardado.title).toBe("Pedal");
  });

  it("com foto e logo, os dois saem antes de desistir dos ajustes", () => {
    const s = storageComLimite(1500);
    const ambos: Settings = { ...DEFAULT_SETTINGS, cardPhoto: FOTO, logo: FOTO, title: "Pedal" };
    expect(saveSettings(s, ambos)).toBe("sem-foto");
    const guardado = JSON.parse(s.getItem("rotacast:settings") as string) as Settings;
    expect(guardado.cardPhoto).toBe("");
    expect(guardado.logo).toBe("");
    expect(guardado.title).toBe("Pedal");
  });

  it("sem foto, um estouro de cota é falha mesmo", () => {
    const s = storageComLimite(10);
    expect(saveSettings(s, DEFAULT_SETTINGS)).toBe("falhou");
  });
});

describe("gravar partida e chegada", () => {
  const comFotoNosLocais = {
    a: { emoji: "🏠", label: "Casa", photo: FOTO },
    b: { emoji: "💦", label: "Cachoeira", photo: FOTO },
  };

  it("grava os dois locais quando cabe", () => {
    const s = storageComLimite();
    expect(saveEndpoints(s, comFotoNosLocais)).toBe("ok");
    expect(s.getItem("rotacast:endpoints")).toContain("Cachoeira");
  });

  it("quando as fotos não cabem, guarda os locais sem elas e diz o que fez", () => {
    // perder emoji e nome em silêncio seria pior do que perder só as fotos
    const s = storageComLimite(120);
    expect(saveEndpoints(s, comFotoNosLocais)).toBe("sem-foto");
    const guardado = JSON.parse(s.getItem("rotacast:endpoints") as string);
    expect(guardado.a).toEqual({ emoji: "🏠", label: "Casa" });
    expect(guardado.b).toEqual({ emoji: "💦", label: "Cachoeira" });
  });

  it("avisa quando nem sem as fotos coube", () => {
    const s = storageComLimite(5);
    expect(saveEndpoints(s, comFotoNosLocais)).toBe("falhou");
  });

  it("sem foto, um estouro de cota é falha mesmo", () => {
    const s = storageComLimite(5);
    expect(
      saveEndpoints(s, { a: { emoji: "🏠", label: "Casa" }, b: null }),
    ).toBe("falhou");
  });

  it("lê de volta o que foi guardado, já saneado", () => {
    const s = storageComLimite();
    saveEndpoints(s, comFotoNosLocais);
    const lido = loadEndpoints(s);
    expect(lido.a?.photo).toBe(FOTO);
    expect(lido.b?.label).toBe("Cachoeira");
  });

  it("lixo guardado não impede o app de abrir", () => {
    const s = storageComLimite();
    s.setItem("rotacast:endpoints", "{nem json é");
    expect(loadEndpoints(s)).toEqual({ a: null, b: null });
    s.setItem("rotacast:endpoints", JSON.stringify({ a: { emoji: 1 }, b: "x" }));
    expect(loadEndpoints(s)).toEqual({ a: null, b: null });
  });
});

describe("ler preferências", () => {
  it("lê e saneia o que estava guardado", () => {
    const s = storageComLimite();
    saveSettings(s, comFoto);
    const lido = loadSettings(s);
    expect(lido.title).toBe("Pedal");
    expect(lido.cardPhoto).toBe(FOTO);
  });

  it("texto corrompido não impede o app de abrir", () => {
    expect(decodeSettings("{isso não é json")).toEqual({});
    expect(decodeSettings("[]")).toEqual({});
    expect(decodeSettings("42")).toEqual({});
    expect(decodeSettings(null)).toEqual({});
    expect(decodeSettings("")).toEqual({});
  });

  it("descarta ajustes inválidos do que veio guardado", () => {
    const lido = decodeSettings(
      JSON.stringify({ basemap: "carto", duration: 900, cardPhoto: "não é foto" }),
    );
    expect(lido.basemap).toBeUndefined(); // estilo que não existe mais
    expect(lido.duration).toBeUndefined(); // fora da faixa
    expect(lido.cardPhoto).toBeUndefined(); // não é data URL de imagem
  });
});
