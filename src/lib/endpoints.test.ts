import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENDPOINTS,
  hasEndpointMarks,
  hasMark,
  hasText,
  mergeSharedEndpoints,
  sanitizeEndpoints,
  sanitizeMark,
  type Endpoints,
} from "./endpoints";

const FOTO = `data:image/jpeg;base64,${"A".repeat(40)}`;

describe("sanear partida e chegada", () => {
  it("aceita um local com emoji e nome", () => {
    expect(sanitizeMark({ emoji: "🏠", label: "Casa" })).toEqual({
      emoji: "🏠",
      label: "Casa",
    });
  });

  it("mantém a foto quando ela é uma imagem de verdade", () => {
    expect(sanitizeMark({ emoji: "🏠", label: "Casa", photo: FOTO })).toEqual({
      emoji: "🏠",
      label: "Casa",
      photo: FOTO,
    });
  });

  it("descarta foto que não é imagem guardada (URL externa, svg, número)", () => {
    // a foto é desenhada no canvas e guardada no localStorage: nenhum dos dois
    // aceita qualquer coisa
    for (const photo of ["https://x.com/a.jpg", "data:image/svg+xml;base64,AA", 42, ""]) {
      expect(sanitizeMark({ emoji: "🏠", label: "Casa", photo })).toEqual({
        emoji: "🏠",
        label: "Casa",
      });
    }
  });

  it("uma partida só com foto continua sendo um lugar marcado", () => {
    // sem isso, a foto de quem não escreveu nome nem emoji seria descartada ao
    // recarregar a página — e o pino voltaria a ser um "A" anônimo
    const soFoto = sanitizeMark({ emoji: "", label: "", photo: FOTO });
    expect(soFoto).toEqual({ emoji: "", label: "", photo: FOTO });
    expect(hasMark(soFoto)).toBe(true);
    expect(hasText(soFoto)).toBe(false);
    expect(hasEndpointMarks({ a: soFoto, b: null })).toBe(true);
  });

  it("local sem nada não é um local", () => {
    expect(sanitizeMark({ emoji: "", label: "" })).toBeNull();
    expect(sanitizeMark(null)).toBeNull();
    expect(sanitizeMark("Casa")).toBeNull();
    expect(sanitizeMark(undefined)).toBeNull();
  });

  it("lê o objeto inteiro, com ou sem locais", () => {
    expect(sanitizeEndpoints(null)).toEqual({ a: null, b: null });
    expect(sanitizeEndpoints({ a: { emoji: "🏠", label: "Casa" }, b: null })).toEqual({
      a: { emoji: "🏠", label: "Casa" },
      b: null,
    });
    expect(hasEndpointMarks(DEFAULT_ENDPOINTS)).toBe(false);
    expect(hasEndpointMarks({ a: { emoji: "🏠", label: "" }, b: null })).toBe(true);
  });
});

describe("partida e chegada vindas de um link", () => {
  const meuLocal: Endpoints = {
    a: { emoji: "🏠", label: "Casa", photo: FOTO },
    b: null,
  };

  it("o link não apaga a foto do MESMO lugar", () => {
    // o link traz emoji e nome, mas não a foto: se o lugar é o mesmo, a foto
    // escolhida aqui tem de continuar
    const doLink: Endpoints = { a: { emoji: "🏠", label: "Casa" }, b: null };
    const resultado = mergeSharedEndpoints(meuLocal, doLink);
    expect(resultado.a).toEqual({ emoji: "🏠", label: "Casa", photo: FOTO });
  });

  it("ignora diferença de espaço no nome do lugar", () => {
    const doLink: Endpoints = { a: { emoji: " 🏠 ", label: " Casa " }, b: null };
    expect(mergeSharedEndpoints(meuLocal, doLink).a?.photo).toBe(FOTO);
  });

  it("lugar DIFERENTE troca o local e derruba a foto antiga", () => {
    // a foto era da Casa; agora o link diz que a partida é a Cachoeira
    const doLink: Endpoints = { a: { emoji: "💦", label: "Cachoeira" }, b: null };
    const resultado = mergeSharedEndpoints(meuLocal, doLink);
    expect(resultado.a).toEqual({ emoji: "💦", label: "Cachoeira" });
    expect(resultado.a?.photo).toBeUndefined();
  });

  it("o link sem local marcado não mexe no que está aqui", () => {
    expect(mergeSharedEndpoints(meuLocal, DEFAULT_ENDPOINTS)).toEqual(meuLocal);
  });

  it("só a chegada pode vir do link", () => {
    const doLink: Endpoints = { a: null, b: { emoji: "🏁", label: "Chegada" } };
    const resultado = mergeSharedEndpoints(meuLocal, doLink);
    expect(resultado.a).toEqual(meuLocal.a);
    expect(resultado.b).toEqual({ emoji: "🏁", label: "Chegada" });
  });
});
