import { describe, expect, it } from "vitest";
import { buildTrack } from "./geo";
import { BASEMAPS } from "./tiles";
import { TILE_BUDGET } from "./renderer";
import { focoDasParadas, type Poi } from "./pois";
import {
  MIN_FOLLOW_ZOOM,
  budgetAdvice,
  cabeNoTeto,
  limiteDoServidor,
  pedidosDaAnimacao,
  pedidosNecessarios,
  maxFollowZoom,
  planejarCamera,
  tilesNeeded,
} from "./map-budget";
import type { Track } from "./geo";

/** Traçado reto de `km` quilômetros, no formato de um interesse. */
function percurso(km: number, n = 4000) {
  const graus = km / 111.32;
  return Array.from({ length: n }, (_, i) => ({
    lat: -23.5 + (i / (n - 1)) * graus,
    lng: -48.4 + (i / (n - 1)) * graus * 0.35,
  }));
}

/** Traçado de `km` com o vaivém de uma estrada de verdade (não uma reta). */
function percursoSinuoso(km: number, n = 1200) {
  const graus = km / 111.32;
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return {
      lat: -23.5 + f * graus + Math.sin(f * Math.PI * 6) * 0.004,
      lng: -48.4 + f * graus * 0.35 + Math.sin(f * Math.PI * 9) * 0.006,
    };
  });
}

/** Três paradas com lugar próprio, 400 m fora da linha. */
function paradasForaDaLinha(track: Track): Poi[] {
  return [0.25, 0.55, 0.8].map((t, i) => {
    const p = track.pts[Math.min(track.pts.length - 1, Math.floor(t * track.pts.length))];
    return {
      id: `s${i}`,
      t,
      emoji: "🌉",
      label: `p${i}`,
      color: "#38bdf8",
      pos: { lat: p.lat + 0.0036, lng: p.lng + 0.0036 },
    };
  });
}

const base = { width: 1280, height: 720, basemap: "dark" as const, maxZoom: 19 };

describe("blocos que a rota precisa", () => {
  it("bate com a tabela medida para a câmera “Seguir”", () => {
    // números medidos antes de escrever a função (zoom 16, 1280x720, mapa escuro)
    const esperado: [number, number][] = [
      [50, 924],
      [75, 1349],
      [200, 3473],
      [435, 7237],
    ];
    for (const [km, blocos] of esperado) {
      const n = tilesNeeded({
        ...base,
        track: buildTrack(percurso(km)),
        camera: { mode: "follow", followZoom: 16 },
      });
      expect(n).toBe(blocos);
    }
  });

  it("a vista da rota toda cabe sempre, mesmo em rota interestadual", () => {
    const n = tilesNeeded({
      ...base,
      track: buildTrack(percurso(435)),
      camera: { mode: "fit", followZoom: 16 },
    });
    expect(n).toBeLessThan(TILE_BUDGET);
    expect(n).toBeLessThan(100);
  });
});

describe("maior zoom que cabe", () => {
  it("numa rota de 435 km, o zoom que cabe é 13,5 (e nenhum acima disso)", () => {
    const track = buildTrack(percurso(435));
    const z = maxFollowZoom({ ...base, track });
    expect(z).toBe(13.5);

    const cabe = (zoom: number) =>
      tilesNeeded({ ...base, track, camera: { mode: "follow", followZoom: zoom } });
    expect(cabe(z!)).toBeLessThanOrEqual(TILE_BUDGET);
    expect(cabe(z! + 0.5)).toBeGreaterThan(TILE_BUDGET);
  });

  it("o zoom sugerido é sempre um dos passos do controle (0,5)", () => {
    for (const km of [90, 150, 300, 435, 700, 1000]) {
      const z = maxFollowZoom({ ...base, track: buildTrack(percurso(km)) });
      expect(z).not.toBeNull();
      expect(Number.isInteger((z as number) * 2)).toBe(true);
      expect(z as number).toBeGreaterThanOrEqual(MIN_FOLLOW_ZOOM);
    }
  });

  it("a contagem cresce com o zoom — é o que a busca binária assume", () => {
    const track = buildTrack(percurso(120));
    let anterior = 0;
    for (const z of [11, 12, 13, 14, 15, 16, 17]) {
      const n = tilesNeeded({ ...base, track, camera: { mode: "follow", followZoom: z } });
      expect(n).toBeGreaterThanOrEqual(anterior);
      anterior = n;
    }
  });

  it("numa rota curta o teto do mapa já cabe", () => {
    // 5 km: até o zoom 19 (o teto que o mapa escuro serve) cabe folgado
    const track = buildTrack(percurso(5));
    expect(maxFollowZoom({ ...base, track })).toBe(19);
    // e a partir de ~12 km nem o zoom 19 cabe: o limite máximo vai baixando
    expect(maxFollowZoom({ ...base, track: buildTrack(percurso(12)) })).toBe(18.5);
    expect(maxFollowZoom({ ...base, track: buildTrack(percurso(30)) })).toBe(17.5);
  });

  it("numa travessia de continente, o zoom desce até a escala do continente", () => {
    /*
     * Era aqui que a rota intercontinental morria: o piso era o zoom 11 (escala
     * de cidade) e uma travessia de 5.000 km não cabia em nenhum zoom — a
     * exportação era recusada mandando usar "Rota toda". Em escala de
     * continente (3) o "Seguir" volta a ser possível.
     */
    const z = maxFollowZoom({ ...base, track: buildTrack(percurso(5000)) });
    expect(z).not.toBeNull();
    expect(z as number).toBeLessThan(11);
    expect(z as number).toBeGreaterThanOrEqual(MIN_FOLLOW_ZOOM);
    // e a escolha realmente cabe no teto
    const n = tilesNeeded({
      ...base,
      track: buildTrack(percurso(5000)),
      camera: { mode: "follow", followZoom: z as number },
    });
    expect(n).toBeLessThanOrEqual(1400);
  });

  it("devolve null quando nem o zoom mínimo cabe", () => {
    // com um teto de 20 blocos não há enquadramento nenhum que sirva
    const z = maxFollowZoom({ ...base, track: buildTrack(percurso(5000)), budget: 20 });
    expect(z).toBeNull();
  });

  it("respeita um teto menor (o mesmo cálculo com orçamento apertado)", () => {
    const track = buildTrack(percurso(100));
    const folgado = maxFollowZoom({ ...base, track });
    const apertado = maxFollowZoom({ ...base, track, budget: 300 });
    expect(apertado).not.toBeNull();
    expect(apertado as number).toBeLessThan(folgado as number);
    expect(
      tilesNeeded({
        ...base,
        track,
        camera: { mode: "follow", followZoom: apertado as number },
      }),
    ).toBeLessThanOrEqual(300);
  });

  it("o teto de cada estilo de mapa é respeitado", () => {
    const track = buildTrack(percurso(60));
    for (const id of Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]) {
      const maxZoom = BASEMAPS[id].maxZoom;
      const z = maxFollowZoom({ ...base, basemap: id, maxZoom, track });
      expect(z as number).toBeLessThanOrEqual(maxZoom);
    }
  });
});

describe("a conta enxerga a terceira pessoa", () => {
  const track = buildTrack(percurso(150));

  it("a mesma rota pede mais blocos em terceira pessoa", () => {
    // a câmera chega 1,5 de zoom mais perto (`zoomEfetivo`): cada bloco cobre
    // menos chão, então a mesma rota atravessa mais deles
    const camera = { mode: "follow" as const, followZoom: 16 };
    const deSempre = tilesNeeded({ ...base, track, camera });
    const terceira = tilesNeeded({ ...base, track, camera: { ...camera, chase: { gira: false } } });
    expect(terceira).toBeGreaterThan(deSempre);
  });

  it("o giro do mapa também entra na conta", () => {
    // com o mapa girado a vista é uma caixa inclinada, que cobre mais cantos
    const camera = { mode: "follow" as const, followZoom: 16 };
    const reto = tilesNeeded({ ...base, track, camera: { ...camera, chase: { gira: false } } });
    const girando = tilesNeeded({ ...base, track, camera: { ...camera, chase: { gira: true } } });
    expect(girando).toBeGreaterThan(reto);
  });

  it("o zoom sugerido desce quando a terceira pessoa está ligada", () => {
    // a sugestão tem de valer para a câmera que o painel mandou — senão o
    // vídeo é recusado depois, com o usuário tendo clicado no botão
    const semTerceira = maxFollowZoom({ ...base, track });
    const comTerceira = maxFollowZoom({
      ...base,
      track,
      camera: { mode: "follow", followZoom: 16, chase: { gira: true } },
    });
    expect(comTerceira).not.toBeNull();
    expect(comTerceira as number).toBeLessThan(semTerceira as number);
  });
});

describe("aviso da rota longa", () => {
  it("diz o zoom que cabe, em vez de só mandar diminuir", () => {
    const texto = budgetAdvice(7237, 13.5, "follow");
    expect(texto).toContain("7237");
    expect(texto).toContain("13.5");
  });

  it("quando nem o mínimo cabe, manda para a câmera “Rota toda”", () => {
    expect(budgetAdvice(9000, null, "follow")).toContain("Rota toda");
  });

  it("na câmera “Rota toda” não sugere zoom nenhum", () => {
    const texto = budgetAdvice(9000, 13.5, "fit");
    expect(texto).not.toContain("zoom");
  });
});

describe("o vídeo de uma travessia intercontinental", () => {
  const travessia = () => buildTrack(percurso(5000));
  const cameraAlta = { mode: "follow" as const, followZoom: 17 };

  it("sai no zoom que cabe, em vez de ser recusado", () => {
    const plano = planejarCamera({ ...base, track: travessia(), camera: cameraAlta });
    expect(plano.reduzido).toBe(true);
    expect(plano.zoom).not.toBeNull();
    expect(plano.camera.mode).toBe("follow");
    expect(plano.camera.followZoom).toBe(plano.zoom);
    expect(plano.camera.followZoom as number).toBeLessThan(17);
    // o que vai ser baixado cabe no teto
    const n = tilesNeeded({ ...base, track: travessia(), camera: plano.camera });
    expect(n).toBeLessThanOrEqual(1400);
  });

  it("cai para a “Rota toda” só quando nem o zoom mínimo cabe", () => {
    const plano = planejarCamera({
      ...base,
      track: travessia(),
      camera: cameraAlta,
      budget: 20,
    });
    expect(plano.reduzido).toBe(true);
    expect(plano.zoom).toBeNull();
    expect(plano.camera.mode).toBe("fit");
  });

  it("rota curta não muda nada", () => {
    const plano = planejarCamera({
      ...base,
      track: buildTrack(percurso(5)),
      camera: { mode: "follow", followZoom: 16 },
    });
    expect(plano.reduzido).toBe(false);
    expect(plano.camera.followZoom).toBe(16);
    expect(plano.zoom).toBeNull();
  });

  it("“Rota toda” já escolhida não é mexida", () => {
    const plano = planejarCamera({
      ...base,
      track: travessia(),
      camera: { mode: "fit", followZoom: 16 },
      budget: 20,
    });
    expect(plano.camera.mode).toBe("fit");
    expect(plano.reduzido).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* O relevo no teto: um servidor, um teto                                  */
/* ------------------------------------------------------------------ */

describe("o relevo na conta de pedidos", () => {
  const camera = (z: number) => ({ mode: "follow" as const, followZoom: z });

  it("sem relevo, cada bloco é um pedido", () => {
    const refs = [
      { url: "a", z: 16, x: 1, y: 1 },
      { url: "b", z: 16, x: 2, y: 1 },
    ];
    expect(pedidosDaAnimacao(refs, "dark", false)).toEqual({ mapa: 2, relevo: 0, total: 2 });
    // e num mapa que já tem relevo próprio (Topo) nada é sombreado
    expect(pedidosDaAnimacao(refs, "topo", true)).toEqual({ mapa: 2, relevo: 0, total: 2 });
  });

  it("até o zoom 16, cada bloco do mapa tem a sua sombra", () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({ url: String(i), z: 16, x: i, y: 0 }));
    expect(pedidosDaAnimacao(refs, "dark", true)).toEqual({ mapa: 4, relevo: 4, total: 8 });
  });

  it("no zoom 17, dois blocos do mapa dividem uma sombra", () => {
    const refs = Array.from({ length: 8 }, (_, i) => ({ url: String(i), z: 17, x: i, y: 0 }));
    // 8 blocos do mapa; no z16 são 4 pais → 4 sombras
    expect(pedidosDaAnimacao(refs, "dark", true)).toEqual({ mapa: 8, relevo: 4, total: 12 });
  });

  it("no zoom 18, quatro blocos dividem uma sombra", () => {
    const refs = Array.from({ length: 16 }, (_, i) => ({ url: String(i), z: 18, x: i, y: 0 }));
    expect(pedidosDaAnimacao(refs, "dark", true)).toEqual({ mapa: 16, relevo: 4, total: 20 });
  });

  it("o mesmo bloco pedido duas vezes conta uma vez", () => {
    const refs = [
      { url: "a", z: 17, x: 10, y: 10 },
      { url: "b", z: 17, x: 11, y: 10 },
      { url: "c", z: 17, x: 10, y: 10 },
    ];
    // dois pais do z16 para os três blocos
    expect(pedidosDaAnimacao(refs, "dark", true).relevo).toBe(1);
    expect(pedidosDaAnimacao(refs, "dark", true).mapa).toBe(3);
  });

  it("o relevo não reduz o zoom escolhido numa rota curta", () => {
    // O defeito: com o teto dividido pela metade, 10 km no zoom 17 saíam no
    // 16,5 — e o usuário via "o zoom não fixa" justamente nas rotas menores,
    // que são as que usam zoom alto.
    const track = buildTrack(percurso(10));
    const plano = planejarCamera({
      track,
      ...base,
      camera: camera(17),
      cinematic: { opening: true, stops: true, stopTs: [0.5], chegada: true },
      relevo: true,
    });
    expect(plano.reduzido).toBe(false);
    expect(plano.camera.followZoom).toBe(17);
    expect(plano.pedidos.relevo).toBeGreaterThan(0);
    expect(plano.pedidos.mapa).toBeLessThanOrEqual(TILE_BUDGET);
  });

  it("5 km no zoom 18 também mantém o zoom (era reduzido no teto pela metade)", () => {
    const track = buildTrack(percurso(5));
    const plano = planejarCamera({
      track,
      ...base,
      camera: camera(18),
      cinematic: { opening: true, stops: true, stopTs: [0.5], chegada: true },
      relevo: true,
    });
    expect(plano.reduzido).toBe(false);
    expect(plano.camera.followZoom).toBe(18);
  });

  it("16 km no zoom 17 fica no 17 — mesmo somando mais de 1.400 imagens", () => {
    // O caso que o usuário relatou: a rota de 16 km saía no zoom **12**.
    // No 17 ela pede 1.381 blocos de mapa (dentro do teto do servidor de
    // mapas) + 517 do sombreado (outro servidor). Somar os dois contra 1.400
    // derrubava o zoom para 12; agora cada servidor responde pelo seu.
    const track = buildTrack(percursoSinuoso(16));
    const stops = paradasForaDaLinha(track);
    const plano = planejarCamera({
      track,
      ...base,
      camera: { ...camera(17), chase: { gira: true, tilt: true } },
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.6, 0.85], chegada: true },
      foco: focoDasParadas(stops, undefined, track),
      relevo: true,
    });
    expect(plano.reduzido).toBe(false);
    expect(plano.camera.followZoom).toBe(17);
    expect(plano.pedidos.mapa).toBeLessThanOrEqual(limiteDoServidor());
    expect(plano.pedidos.relevo).toBeGreaterThan(0);
    // a soma passa do teto: é justamente o que não pode decidir
    expect(plano.pedidos.total).toBeGreaterThan(TILE_BUDGET);
  });

  it("a sugestão não desce mais do que precisa (o “cabe” não é monotônico)", () => {
    // Pedindo 19 numa rota de 16 km, a busca binária devolvia 16 mesmo com o
    // 17 cabendo: logo abaixo do 16 a sombra vira 1:1 e a conta sobe, então o
    // primeiro zoom que cabe não está no meio da lista.
    const track = buildTrack(percursoSinuoso(16));
    const stops = paradasForaDaLinha(track);
    const entrada = {
      track,
      ...base,
      camera: { ...camera(19), chase: { gira: true, tilt: true } },
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.6, 0.85], chegada: true },
      foco: focoDasParadas(stops, undefined, track),
      relevo: true,
    };
    expect(maxFollowZoom(entrada)).toBe(17);
    expect(planejarCamera(entrada).camera.followZoom).toBe(17);
  });

  it("a sugestão nunca sobe acima do zoom pedido", () => {
    const track = buildTrack(percursoSinuoso(16));
    const z = maxFollowZoom({
      track,
      ...base,
      camera: { mode: "follow", followZoom: 14 },
      cinematic: { opening: true, stops: true, stopTs: [0.5], chegada: true },
      relevo: true,
    });
    expect(z).toBe(14);
  });

  it("cada servidor tem o seu teto, com a folga da terceira pessoa", () => {
    const limite = limiteDoServidor();
    expect(limite).toBe(1540);
    expect(cabeNoTeto({ mapa: limite, relevo: limite, total: limite * 2 })).toBe(true);
    expect(cabeNoTeto({ mapa: limite + 1, relevo: 10, total: limite + 11 })).toBe(false);
    expect(cabeNoTeto({ mapa: 10, relevo: limite + 1, total: limite + 11 })).toBe(false);
    // 1.490 no mapa (o caso de 16 km no 17 com giro e inclinação) cabe na folga
    expect(cabeNoTeto({ mapa: 1490, relevo: 181, total: 1671 })).toBe(true);
  });

  it("no zoom 16 a sombra é 1:1 — e ainda assim o zoom escolhido fica", () => {
    // Até o z16 cada bloco do mapa tem a sua própria sombra. Mesmo assim o
    // relevo não derruba o zoom: 20 km no 16 pedem 874 de mapa (teto 1.400).
    const track = buildTrack(percurso(20));
    const plano = planejarCamera({
      track,
      ...base,
      camera: camera(16),
      cinematic: { opening: true, stops: true, stopTs: [0.5], chegada: true },
      relevo: true,
    });
    expect(plano.pedidos.relevo).toBeGreaterThan(plano.pedidos.mapa * 0.7);
    expect(plano.reduzido).toBe(false);
    expect(plano.camera.followZoom).toBe(16);
  });

  it("quando não cabe, a redução acontece — e o pedido é de verdade", () => {
    const track = buildTrack(percurso(120));
    const plano = planejarCamera({
      track,
      ...base,
      camera: camera(17),
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.7], chegada: true },
      relevo: true,
    });
    expect(plano.reduzido).toBe(true);
    const depois = pedidosNecessarios({
      track,
      ...base,
      camera: plano.camera,
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.7], chegada: true },
      relevo: true,
    });
    expect(cabeNoTeto(depois)).toBe(true);
    expect(depois.mapa).toBeLessThanOrEqual(TILE_BUDGET);
  });

  it("a sugestão de zoom respeita o teto de imagens", () => {
    const track = buildTrack(percurso(120));
    const z = maxFollowZoom({
      track,
      ...base,
      camera: camera(17),
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.7], chegada: true },
      relevo: true,
    });
    expect(z).not.toBeNull();
    const p = pedidosNecessarios({
      track,
      ...base,
      camera: { mode: "follow", followZoom: z as number },
      cinematic: { opening: true, stops: true, stopTs: [0.3, 0.7], chegada: true },
      relevo: true,
    });
    expect(p.mapa).toBeLessThanOrEqual(TILE_BUDGET);
  });
});
