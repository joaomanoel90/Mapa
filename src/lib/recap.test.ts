import { describe, expect, it } from "vitest";
import { momentosDoRecap, momentoNaTela, RECAP_SECONDS } from "./recap";
import { buildTrack } from "./geo";
import type { Destaque } from "./highlights";

const T0 = Date.UTC(2026, 2, 1, 6, 0, 0);

/** Um percurso reto com hora em todos os pontos. */
const track = buildTrack(
  Array.from({ length: 60 }, (_, i) => ({
    lat: -23.5 + i * 0.0004,
    lng: -48.4 + i * 0.0002,
    t: T0 + i * 60_000,
  })),
);

const times = track.pts.map((p) => p.t!) as number[];

const melhorKm: Destaque = {
  tipo: "melhorKm",
  em: 0.5,
  titulo: "Melhor km",
  valor: "4:12",
  unidade: "/km",
  detalhe: "km 3 de 6,4",
};

const maiorSubida: Destaque = {
  tipo: "maiorSubida",
  em: 0.7,
  titulo: "Maior subida",
  valor: "48",
  unidade: "m",
  detalhe: "km 5 de 6,4",
};

describe("os melhores momentos do fim", () => {
  it("abre na largada, passa pelos destaques e fecha na chegada", () => {
    const lista = momentosDoRecap({
      track,
      times,
      destaques: [melhorKm, maiorSubida],
    });
    expect(lista.map((m) => m.titulo)).toEqual([
      "Largada",
      "Melhor km",
      "Maior subida",
      "Chegada",
    ]);
    // a largada é a hora do primeiro ponto, no formato do relógio
    expect(lista[0].valor).toMatch(/^\d{2}:\d{2}$/);
  });

  it("a chegada leva a hora e o tempo total do percurso", () => {
    const lista = momentosDoRecap({ track, times, destaques: [] });
    expect(lista).toHaveLength(2);
    const chegada = lista[1];
    expect(chegada.valor).toMatch(/km|m$/);
    // 59 pontos × 1 min = 59 min de percurso
    expect(chegada.detalhe).toContain("59 min");
  });

  it("sem hora no arquivo sobra a chegada — e um cartão só não é recap", () => {
    expect(momentosDoRecap({ track, times: null, destaques: [] })).toEqual([]);
    // com destaque já são dois, e aí o bloco existe
    const comDestaque = momentosDoRecap({ track, times: null, destaques: [melhorKm] });
    expect(comDestaque.map((m) => m.titulo)).toEqual(["Melhor km", "Chegada"]);
  });

  it("a chegada nunca é cortada, mesmo com destaques demais", () => {
    const muitos: Destaque[] = [
      { ...melhorKm, titulo: "a" },
      { ...melhorKm, titulo: "b" },
      { ...melhorKm, titulo: "c" },
      { ...melhorKm, titulo: "d" },
    ];
    const lista = momentosDoRecap({ track, times, destaques: muitos });
    expect(lista).toHaveLength(4);
    expect(lista[lista.length - 1].titulo).toBe("Chegada");
  });
});

describe("o cartão em cena", () => {
  const lista = [
    { titulo: "Largada", valor: "", unidade: "", detalhe: "" },
    { titulo: "Chegada", valor: "", unidade: "", detalhe: "" },
  ];

  it("divide o bloco igualmente entre os momentos", () => {
    const a = momentoNaTela(lista, RECAP_SECONDS * 0.25, RECAP_SECONDS);
    const b = momentoNaTela(lista, RECAP_SECONDS * 0.75, RECAP_SECONDS);
    expect(a?.indice).toBe(0);
    expect(b?.indice).toBe(1);
    // no meio de cada momento o cartão está inteiro
    expect(a?.alfa).toBeCloseTo(1, 6);
    expect(b?.alfa).toBeCloseTo(1, 6);
  });

  it("entra e sai pelas bordas (sem piscar na virada)", () => {
    expect(momentoNaTela(lista, 0, RECAP_SECONDS)?.alfa).toBe(0);
    expect(momentoNaTela(lista, RECAP_SECONDS, RECAP_SECONDS)?.alfa).toBe(0);
    // na virada, o primeiro já saiu e o segundo ainda não entrou
    const virada = momentoNaTela(lista, RECAP_SECONDS / 2, RECAP_SECONDS);
    expect(virada?.alfa ?? 0).toBeLessThan(0.01);
  });

  it("fora da janela não há cartão", () => {
    expect(momentoNaTela(lista, -0.1, RECAP_SECONDS)).toBeNull();
    expect(momentoNaTela(lista, RECAP_SECONDS + 0.1, RECAP_SECONDS)).toBeNull();
    expect(momentoNaTela([], 1, RECAP_SECONDS)).toBeNull();
    expect(momentoNaTela(lista, 1, 0)).toBeNull();
  });
});
