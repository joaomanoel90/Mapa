import { describe, expect, it } from "vitest";
import { buildTrack, type LatLng } from "./geo";
import { formatPace } from "./hud";
import { trailProfile } from "./profile";
import {
  DESTAQUE_ANTES_S,
  DESTAQUE_FICA_S,
  DESTAQUE_FADE_S,
  destaqueEmCena,
  destaques,
  janelaDoDestaque,
  melhorParcial,
  parciais,
} from "./highlights";

const T0 = Date.parse("2026-10-13T09:00:00Z");

/**
 * Percurso reto para o norte, pontos a ~10 m.
 *
 * `segundos(i)` dá quantos segundos passaram **até aquele ponto** — é o que
 * monta o arquivo de GPS. `ele(i)` é opcional (rota sem altitude).
 */
function reta(
  n: number,
  segundos: (i: number) => number,
  ele?: (i: number) => number,
): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const p: LatLng = { lat: -23.5 + i * 0.00009, lng: -48.4, t: T0 + segundos(i) * 1000 };
    if (ele) p.ele = ele(i);
    pts.push(p);
  }
  return pts;
}

/** 1 km a cada 100 pontos (10 m por ponto). */
const PONTOS_POR_KM = 100;

/**
 * 5 km com o 3º km mais rápido: 360 s por km, e o km 3 em 300 s.
 *
 * A parcial lenta tem que ser lenta **de verdade** para o teste ter dentes.
 */
function cincoKm(melhor = 3): LatLng[] {
  const ritmo = [360, 360, 360, 360, 360];
  ritmo[melhor - 1] = 300;
  const tempoNoPonto = (i: number) => {
    const km = Math.floor(i / PONTOS_POR_KM);
    const dentro = (i % PONTOS_POR_KM) / PONTOS_POR_KM;
    let total = 0;
    for (let k = 0; k < km; k++) total += ritmo[k] ?? ritmo[ritmo.length - 1];
    return total + dentro * (ritmo[km] ?? ritmo[ritmo.length - 1]);
  };
  return reta(5 * PONTOS_POR_KM + 1, tempoNoPonto);
}

describe("parciais", () => {
  it("uma parcial por km, com o tempo de cada trecho", () => {
    const track = buildTrack(cincoKm());
    const ps = parciais(track, track.pts.map((p) => p.t as number));
    expect(ps.length).toBe(5);
    expect(ps.map((p) => p.km)).toEqual([1, 2, 3, 4, 5]);
    // o km 3 é o mais rápido: 300 s
    expect(Math.min(...ps.map((p) => p.segundos))).toBeCloseTo(300, 0);
    expect(Math.max(...ps.map((p) => p.segundos))).toBeCloseTo(360, 0);
    // o ritmo é segundos por km (aqui o trecho tem 1 km, então é o próprio tempo)
    expect(ps[0].ritmo).toBeCloseTo(ps[0].segundos, 5);
  });

  it("sem hora no arquivo não existe parcial", () => {
    const track = buildTrack(reta(5 * PONTOS_POR_KM, () => 0));
    expect(parciais(track, null)).toEqual([]);
  });

  it("percurso curto não tem parcial", () => {
    // 800 m: não existe "km mais rápido"
    const curto = buildTrack(reta(80, (i) => i * 6));
    expect(parciais(curto, curto.pts.map((p) => p.t as number))).toEqual([]);
  });

  it("trecho com metade dos pontos sem hora não vira parcial", () => {
    const pts = cincoKm();
    const horas = pts.map((p, i) => (i < 120 ? NaN : (p.t as number)));
    const track = buildTrack(pts);
    const ps = parciais(track, horas);
    // o km 1 (índices 0..100) está sem hora; o km 2 pega o buraco até o 120
    expect(ps.map((p) => p.km)).not.toContain(1);
    expect(ps.length).toBeLessThan(5);
  });

  it("vetor de horas de outro traçado é ignorado", () => {
    const track = buildTrack(cincoKm());
    expect(parciais(track, [T0, T0 + 1000])).toEqual([]);
  });
});

describe("melhor parcial", () => {
  it("acha o km mais rápido", () => {
    const track = buildTrack(cincoKm(3));
    const melhor = melhorParcial(parciais(track, track.pts.map((p) => p.t as number)));
    expect(melhor?.km).toBe(3);
    expect(melhor?.ritmo).toBeCloseTo(300, 0);
  });

  it("com menos de três parciais não existe \"a melhor\"", () => {
    const track = buildTrack(cincoKm());
    const ps = parciais(track, track.pts.map((p) => p.t as number));
    expect(melhorParcial(ps.slice(0, 2))).toBeNull();
    expect(melhorParcial([])).toBeNull();
  });
});

describe("destaques do percurso", () => {
  const comElevacao = () => {
    // sobe 60 m do km 2 ao 4 — a maior subida da rota
    return reta(5 * PONTOS_POR_KM + 1, (i) => {
      const km = Math.floor(i / PONTOS_POR_KM);
      const dentro = (i % PONTOS_POR_KM) / PONTOS_POR_KM;
      return km * 360 + dentro * 360;
    }, (i) => 700 + Math.max(0, Math.min(1, (i - 2 * PONTOS_POR_KM) / (2 * PONTOS_POR_KM))) * 60);
  };

  it("a pé, a melhor parcial sai em min/km", () => {
    const track = buildTrack(cincoKm(4));
    const lista = destaques({ track, times: track.pts.map((p) => p.t as number), perfil: null, pace: true });
    const melhor = lista.find((d) => d.tipo === "melhorKm")!;
    expect(melhor).toBeDefined();
    expect(melhor.titulo).toBe("Melhor km");
    expect(melhor.valor).toBe(formatPace(300));
    expect(melhor.unidade).toBe("/km");
    expect(melhor.detalhe).toContain("km 4");
    // acontece no fim do km 4
    expect(melhor.em).toBeCloseTo(4 / 5, 2);
  });

  it("de bike, a mesma parcial sai em km/h", () => {
    const track = buildTrack(cincoKm(4));
    const lista = destaques({ track, times: track.pts.map((p) => p.t as number), perfil: null, pace: false });
    const melhor = lista.find((d) => d.tipo === "melhorKm")!;
    expect(melhor.unidade).toBe("km/h");
    expect(melhor.valor).toBe("12,0"); // 1 km em 300 s
  });

  it("a maior subida vem com os metros ganhos e a inclinação", () => {
    const track = buildTrack(comElevacao());
    const perfil = trailProfile(track)!;
    const lista = destaques({ track, times: null, perfil, pace: true });
    const subida = lista.find((d) => d.tipo === "maiorSubida")!;
    expect(subida).toBeDefined();
    expect(subida.titulo).toBe("Maior subida");
    expect(Number(subida.valor)).toBeCloseTo(60, 0);
    expect(subida.unidade).toBe("m");
    expect(subida.detalhe).toContain("%");
    // no cume: fim do km 4
    expect(subida.em).toBeCloseTo(4 / 5, 2);
  });

  it("sem hora sobra só a subida; sem altitude sobra só a parcial", () => {
    const semHora = destaques({
      track: buildTrack(comElevacao()),
      times: null,
      perfil: trailProfile(buildTrack(comElevacao())),
      pace: true,
    });
    expect(semHora.map((d) => d.tipo)).toEqual(["maiorSubida"]);

    const plano = buildTrack(cincoKm(2));
    const semAlt = destaques({
      track: plano,
      times: plano.pts.map((p) => p.t as number),
      perfil: null,
      pace: true,
    });
    expect(semAlt.map((d) => d.tipo)).toEqual(["melhorKm"]);
  });

  it("rota sem hora e sem relevo não inventa destaque", () => {
    const track = buildTrack(reta(300, () => 0));
    expect(destaques({ track, times: null, perfil: null, pace: true })).toEqual([]);
  });

  it("os destaques vêm em ordem de acontecimento", () => {
    const track = buildTrack(comElevacao());
    const lista = destaques({
      track,
      times: track.pts.map((p) => p.t as number),
      perfil: trailProfile(track),
      pace: true,
    });
    for (let i = 1; i < lista.length; i++) expect(lista[i].em).toBeGreaterThan(lista[i - 1].em);
  });
});

describe("a janela do destaque", () => {
  it("entra antes do momento, fica e sai", () => {
    const em = 0.5;
    const percurso = 10; // 10 s de percurso: 0,1 do percurso = 1 s de vídeo
    // bem antes, nada
    expect(janelaDoDestaque(em - 1 / percurso, em, percurso)).toBe(0);
    // no momento, inteiro
    expect(janelaDoDestaque(em, em, percurso)).toBe(1);
    expect(janelaDoDestaque(em + 0.5 / percurso, em, percurso)).toBe(1);
    // depois de DESTAQUE_FICA_S segundos de vídeo, saiu
    expect(janelaDoDestaque(em + (DESTAQUE_FICA_S + 0.1) / percurso, em, percurso)).toBe(0);
  });

  it("a entrada e a saída são rampas, não degraus", () => {
    const em = 0.5;
    const percurso = 10;
    // metade da rampa de entrada: já apareceu, mas longe de cheio
    const meioDaEntrada = janelaDoDestaque(em - DESTAQUE_ANTES_S / 2 / percurso, em, percurso);
    expect(meioDaEntrada).toBeGreaterThan(0.3);
    expect(meioDaEntrada).toBeLessThan(0.8);
    // o mesmo na saída
    const meioDaSaida = janelaDoDestaque(
      em + (DESTAQUE_FICA_S - DESTAQUE_FADE_S / 2) / percurso,
      em,
      percurso,
    );
    expect(meioDaSaida).toBeGreaterThan(0.3);
    expect(meioDaSaida).toBeLessThan(0.8);
  });

  it("sem percurso (fração) não aparece", () => {
    expect(janelaDoDestaque(0.5, 0.5, 0)).toBe(0);
  });
});

describe("qual destaque está em cena", () => {
  const base = {
    tipo: "melhorKm" as const,
    titulo: "Melhor km",
    valor: "4:12",
    unidade: "/km",
    detalhe: "km 3 de 5,0",
  };

  it("escolhe o que está em cena e ignora o resto", () => {
    const lista = [
      { ...base, em: 0.2 },
      { ...base, tipo: "maiorSubida" as const, em: 0.8, valor: "60" },
    ];
    expect(destaqueEmCena(lista, 0.2, 10)?.destaque.em).toBe(0.2);
    expect(destaqueEmCena(lista, 0.8, 10)?.destaque.em).toBe(0.8);
    expect(destaqueEmCena(lista, 0.5, 10)).toBeNull();
  });

  it("dois avisos próximos aparecem em sequência, cada um cede a vez ao outro", () => {
    // 14 s de percurso; 0,10 de percurso = 1,4 s de vídeo
    const lista = [{ ...base, em: 0.3 }, { ...base, em: 0.4 }];
    // o primeiro está inteiro em 0,3...
    expect(destaqueEmCena(lista, 0.3, 14)?.destaque.em).toBe(0.3);
    // ...e sai quando o segundo entra: em 0,4 quem manda é o segundo, inteiro
    expect(destaqueEmCena(lista, 0.4, 14)?.destaque.em).toBe(0.4);
    expect(destaqueEmCena(lista, 0.4, 14)?.alfa).toBe(1);
  });

  it("dois avisos quase no mesmo instante: fica o primeiro", () => {
    // 0,02 de 14 s = 0,28 s de vídeo — piscaria
    const lista = [{ ...base, em: 0.3 }, { ...base, em: 0.32 }];
    expect(destaqueEmCena(lista, 0.32, 14)?.destaque.em).toBe(0.3);
  });

  it("quando dois se sobrepõem, fica o mais visível", () => {
    // 10 s de percurso: o primeiro (0,3) já está saindo quando o segundo (0,5)
    // chega inteiro
    const lista = [{ ...base, em: 0.3 }, { ...base, em: 0.5 }];
    expect(destaqueEmCena(lista, 0.4, 10)?.destaque.em).toBe(0.3);
    expect(destaqueEmCena(lista, 0.5, 10)?.destaque.em).toBe(0.5);
  });
});
