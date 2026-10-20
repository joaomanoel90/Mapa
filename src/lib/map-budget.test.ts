import { describe, expect, it } from "vitest";
import { buildTrack } from "./geo";
import { BASEMAPS } from "./tiles";
import { TILE_BUDGET } from "./renderer";
import {
  MIN_FOLLOW_ZOOM,
  budgetAdvice,
  maxFollowZoom,
  planejarCamera,
  tilesNeeded,
} from "./map-budget";

/** Traçado reto de `km` quilômetros, no formato de um interesse. */
function percurso(km: number, n = 4000) {
  const graus = km / 111.32;
  return Array.from({ length: n }, (_, i) => ({
    lat: -23.5 + (i / (n - 1)) * graus,
    lng: -48.4 + (i / (n - 1)) * graus * 0.35,
  }));
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
