import { describe, expect, it } from "vitest";
import {
  AUDIO_SAMPLE_RATE,
  blocosDeAudio,
  camaMusical,
  checkAudioFile,
  duracaoDaFaixa,
  momentosDoSom,
  montarTrilha,
  reamostrar,
  renderSom,
  type Faixa,
} from "./audio";
import type { Timeline } from "./timeline";

const TL: Timeline = { voo: 2, percurso: 10, cartela: 4.2 };

/** Um único pico na faixa: onde ele está e quão alto. */
function pico(canal: Float32Array) {
  let i = 0;
  for (let j = 0; j < canal.length; j++) if (Math.abs(canal[j]) > Math.abs(canal[i])) i = j;
  return { i, valor: canal[i] };
}

/** Soma da energia entre dois instantes (para achar onde o pop começa). */
function energia(canal: Float32Array, de: number, ate: number, sampleRate = AUDIO_SAMPLE_RATE) {
  const a = Math.max(0, Math.round(de * sampleRate));
  const b = Math.min(canal.length, Math.round(ate * sampleRate));
  let soma = 0;
  for (let i = a; i < b; i++) soma += canal[i] * canal[i];
  return soma;
}

describe("quando cada pop acontece", () => {
  it("largada no fim do voo, parada no meio do percurso, chegada no fim", () => {
    const eventos = momentosDoSom({
      duration: 16.2,
      timeline: TL,
      passages: [{ t: 0.5 }],
    });
    expect(eventos.map((e) => e.kind)).toEqual(["largada", "parada", "chegada"]);
    expect(eventos[0].at).toBeCloseTo(2, 6);
    expect(eventos[1].at).toBeCloseTo(7, 6); // 2 s de voo + metade dos 10 s
    expect(eventos[2].at).toBeCloseTo(12, 6); // fim do percurso
  });

  it("sem voo não há largada — o personagem já sai andando", () => {
    const eventos = momentosDoSom({
      duration: 14,
      timeline: { voo: 0, percurso: 9.8, cartela: 4.2 },
    });
    expect(eventos.map((e) => e.kind)).toEqual(["chegada"]);
  });

  it("duas passagens coladas viram um pop só", () => {
    // 0,005 de percurso = 0,05 s de vídeo: cairia em cima do anterior
    const eventos = momentosDoSom({
      duration: 16.2,
      timeline: TL,
      passages: [{ t: 0.5 }, { t: 0.505 }, { t: 0.8 }],
    });
    const paradas = eventos.filter((e) => e.kind === "parada");
    expect(paradas.length).toBe(2);
    expect(paradas[1].at).toBeCloseTo(10, 6);
  });

  it("a passagem na largada (ou na chegada) não duplica o pop do evento", () => {
    const eventos = momentosDoSom({
      duration: 16.2,
      timeline: TL,
      passages: [{ t: 0 }, { t: 1 }],
    });
    // só largada e chegada
    expect(eventos.map((e) => e.kind)).toEqual(["largada", "chegada"]);
  });

  it("nada sai do vídeo, nem quando a timeline é apertada", () => {
    const eventos = momentosDoSom({
      duration: 3,
      timeline: { voo: 0, percurso: 2, cartela: 1 },
      passages: [{ t: 0.4 }, { t: 0.9 }],
    });
    for (const e of eventos) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThanOrEqual(3);
    }
  });
});

describe("como cada pop soa", () => {
  const eventos = [{ at: 0.5, kind: "parada" as const }];

  it("onde não há evento, é silêncio", () => {
    const som = renderSom(eventos, 1.4, 8000);
    expect(pico(som.subarray(0, 3000)).valor).toBe(0);
  });

  it("o pop começa no instante do evento e some rápido", () => {
    const som = renderSom(eventos, 1.4);
    expect(energia(som, 0.5, 0.56)).toBeGreaterThan(0.01);
    expect(energia(som, 0.9, 1.2)).toBeLessThan(1e-6);
  });

  it("nunca estoura o arquivo, nem com dois pops sobrepostos", () => {
    const som = renderSom(
      [
        { at: 0.5, kind: "parada" },
        { at: 0.51, kind: "chegada" },
        { at: 0.52, kind: "chegada" },
      ],
      1.5,
    );
    for (let i = 0; i < som.length; i++) expect(Math.abs(som[i])).toBeLessThanOrEqual(1);
    expect(pico(som).valor).toBeGreaterThan(0.2);
  });

  it("a chegada é mais longa que a parada", () => {
    const parada = renderSom([{ at: 0.2, kind: "parada" }], 2);
    const chegada = renderSom([{ at: 0.2, kind: "chegada" }], 2);
    expect(energia(chegada, 0.6, 0.85)).toBeGreaterThan(energia(parada, 0.6, 0.85) * 5);
  });
});

describe("a música do tamanho do vídeo", () => {
  /** faixa de valor constante: o mais fácil de conferir num teste */
  const constante = (segundos: number, valor = 1, sampleRate = 1000): Faixa => ({
    sampleRate,
    canais: [new Float32Array(Math.round(segundos * sampleRate)).fill(valor)],
  });

  it("corta a faixa longa no tamanho do vídeo", () => {
    const cama = camaMusical(constante(10), 3, 1);
    expect(cama.length).toBe(2);
    expect(cama[0].length).toBe(3000);
    expect(cama[1].length).toBe(3000);
  });

  it("repete a faixa curta, sem buraco no meio", () => {
    // 0,5 s de música para um vídeo de 2 s: quatro voltas
    const cama = camaMusical(constante(0.5), 2, 1);
    expect(cama[0].length).toBe(2000);
    // bem no meio (1 s), a soma das emendas continua valendo 1
    expect(cama[0][1000]).toBeCloseTo(1, 5);
  });

  it("a emenda não estala: a soma nunca passa do valor original", () => {
    const cama = camaMusical(constante(0.5), 2, 1);
    for (let i = 200; i < 2000; i++) expect(cama[0][i]).toBeLessThanOrEqual(1.0000001);
  });

  it("entra e sai suavemente", () => {
    const cama = camaMusical(constante(10), 4, 1);
    expect(cama[0][0]).toBe(0);
    expect(cama[0][cama[0].length - 1]).toBeLessThan(0.01);
    expect(cama[0][2000]).toBeGreaterThan(0.9);
  });

  it("a emenda da repetição não produz estalo (nem salto de amostra)", () => {
    /*
     * O teste que pega o defeito de verdade: uma senoide contínua repetida com
     * a emenda errada dá um salto de uma amostra para a outra — o ouvido ouve
     * "tec" a cada volta. Aqui a maior diferença dentro da emenda tem de ficar
     * na mesma ordem da maior diferença no meio da faixa.
     */
    const sr = 8000;
    const n = Math.round(0.5 * sr);
    const seno = new Float32Array(n);
    for (let i = 0; i < n; i++) seno[i] = 0.8 * Math.sin((2 * Math.PI * 100 * i) / sr);
    const cama = camaMusical({ sampleRate: sr, canais: [seno] }, 2, 1)[0];

    const salto = (de: number, ate: number) => {
      let maior = 0;
      for (let i = de + 1; i < ate; i++) maior = Math.max(maior, Math.abs(cama[i] - cama[i - 1]));
      return maior;
    };
    const normal = salto(1000, 3000);
    const emenda = salto(Math.round(0.48 * sr), Math.round(0.54 * sr));
    expect(emenda).toBeLessThanOrEqual(normal * 1.5 + 1e-6);
  });

  it("o volume pedido é o volume que sai", () => {
    const cama = camaMusical(constante(10), 3, 0.5);
    expect(cama[0][1500]).toBeCloseTo(0.5, 5);
  });

  it("faixa sem amostra nenhuma não quebra a exportação", () => {
    const cama = camaMusical({ sampleRate: 1000, canais: [new Float32Array(0)] }, 1, 1);
    expect(cama[0].length).toBe(1000);
    expect(cama[0][500]).toBe(0);
  });
});

describe("reamostragem", () => {
  it("44,1 kHz vira 48 kHz com a mesma duração", () => {
    const faixa: Faixa = {
      sampleRate: 44_100,
      canais: [new Float32Array(44_100).fill(0.5)],
    };
    const nova = reamostrar(faixa, 48_000);
    expect(nova.sampleRate).toBe(48_000);
    expect(nova.canais[0].length).toBe(48_000);
    expect(nova.canais[0][24_000]).toBeCloseTo(0.5, 5);
  });

  it("na mesma taxa, devolve a faixa como está", () => {
    const faixa: Faixa = { sampleRate: 48_000, canais: [new Float32Array(10)] };
    expect(reamostrar(faixa, 48_000)).toBe(faixa);
  });

  it("duração da faixa", () => {
    expect(duracaoDaFaixa({ sampleRate: 1000, canais: [new Float32Array(2500)] })).toBe(2.5);
    expect(duracaoDaFaixa({ sampleRate: 0, canais: [] })).toBe(0);
  });
});

describe("blocos para o codificador", () => {
  it("corta em blocos do tamanho pedido e completa o último", () => {
    const canais = [
      new Float32Array(2500).fill(1),
      new Float32Array(2500).fill(-1),
    ];
    const blocos = blocosDeAudio(canais, 1024);
    expect(blocos.length).toBe(3); // 1024 + 1024 + 452 → 3 blocos
    expect(blocos.every((b) => b.frames === 1024)).toBe(true);
    expect(blocos[0].data.length).toBe(2048); // dois canais planares
    // o esquerdo inteiro antes do direito, como o `f32-planar` pede
    expect(blocos[0].data[0]).toBe(1);
    expect(blocos[0].data[1024]).toBe(-1);
    // o que faltou no último bloco é silêncio, não lixo
    expect(blocos[2].data[600]).toBe(0);
  });

  it("sem amostra, não há bloco", () => {
    expect(blocosDeAudio([new Float32Array(0)], 1024)).toEqual([]);
  });
});

describe("a trilha completa", () => {
  it("tem o tamanho do vídeo e leva os pops junto", () => {
    const trilha = montarTrilha({
      duration: 2,
      eventos: [{ at: 1, kind: "parada" }],
      sampleRate: 8000,
    });
    expect(trilha.sampleRate).toBe(8000);
    expect(trilha.canais.length).toBe(2);
    expect(trilha.canais[0].length).toBe(16_000);
    // o pop está nos dois canais, no mesmo lugar
    expect(energia(trilha.canais[0], 1, 1.06, 8000)).toBeGreaterThan(0);
    expect(energia(trilha.canais[1], 1, 1.06, 8000)).toBeCloseTo(
      energia(trilha.canais[0], 1, 1.06, 8000),
      6,
    );
  });

  it("música + pops não estouram o arquivo", () => {
    const musica: Faixa = {
      sampleRate: 8000,
      canais: [new Float32Array(16_000).fill(0.9)],
    };
    const trilha = montarTrilha({
      duration: 2,
      eventos: [{ at: 1, kind: "chegada" }],
      musica,
      volume: 1,
      sampleRate: 8000,
    });
    for (const canal of trilha.canais) {
      for (let i = 0; i < canal.length; i++) expect(Math.abs(canal[i])).toBeLessThanOrEqual(1);
    }
    // e a música continua audível no meio (não foi só o pop)
    expect(trilha.canais[0][4000]).toBeGreaterThan(0.8);
  });
});

describe("arquivo de música aceito", () => {
  it("só entra áudio, com tamanho razoável", () => {
    expect(checkAudioFile({ type: "audio/mpeg", size: 3_000_000 })).toBeNull();
    expect(checkAudioFile({ type: "video/mp4", size: 3_000_000 })).toContain("não é áudio");
    expect(checkAudioFile({ type: "audio/mpeg", size: 40 * 1024 * 1024 })).toContain("24 MB");
    expect(checkAudioFile({ type: "audio/mpeg", size: 0 })).toContain("vazio");
  });
});
