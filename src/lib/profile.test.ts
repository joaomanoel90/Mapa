import { describe, expect, it } from "vitest";
import {
  elevacaoEm,
  inclinacaoDaSubida,
  profileLayout,
  trailProfile,
} from "./profile";
import { buildTrack, type LatLng } from "./geo";

/** Um traçado reto para o norte, com a altitude que a função mandar. */
const reto = (altitudes: number[]): LatLng[] =>
  altitudes.map((ele, i) => ({
    // ~100 m por ponto: o passo em latitude é o suficiente para as distâncias
    lat: -23.5 + i * 0.0009,
    lng: -48.4,
    ele,
  }));

describe("perfil de elevação", () => {
  it("desenha a linha em ordem e acha mínimo, máximo e a maior subida", () => {
    // sobe 0 → 300, desce para 120, e sobe 120 → 260 (a maior subida é a primeira)
    const alt = [0, 50, 120, 220, 300, 260, 200, 120, 180, 260];
    const p = trailProfile(buildTrack(reto(alt)), 40);
    expect(p).not.toBeNull();
    expect(p!.min).toBe(0);
    expect(p!.max).toBe(300);
    expect(p!.pontos.length).toBeGreaterThan(10);
    // as colunas andam de 0 a 1 e a altitude sobe no começo
    expect(p!.pontos[0].frac).toBe(0);
    expect(p!.pontos[p!.pontos.length - 1].frac).toBe(1);
    expect(p!.pontos[p!.pontos.length - 1].ele).toBeGreaterThan(200);
    // a maior subida vai do vale (0 m) ao cume (300 m)
    expect(p!.maiorSubida).not.toBeNull();
    expect(p!.maiorSubida!.ganho).toBe(300);
    expect(p!.maiorSubida!.fim).toBeGreaterThan(p!.maiorSubida!.ini);
    // e há subida acumulada (D+) maior que a maior subida isolada
    expect(p!.ganho).toBeGreaterThanOrEqual(300);
  });

  it("não inventa relevo num percurso plano", () => {
    // 2 m de variação é ruído: a faixa não deve aparecer
    expect(trailProfile(buildTrack(reto([100, 100.5, 101, 100.8, 101.5])))).toBeNull();
  });

  it("não existe sem altitude no arquivo", () => {
    const semEle = [
      { lat: -23.5, lng: -48.4 },
      { lat: -23.51, lng: -48.41 },
    ];
    expect(trailProfile(buildTrack(semEle))).toBeNull();
  });

  it("rotas planas no papel não ganham destaque de subida", () => {
    const p = trailProfile(buildTrack(reto([100, 104, 108, 112, 116])));
    // 16 m de desnível total: a subida existe no gráfico…
    expect(p).not.toBeNull();
    // …mas é pequena demais para virar "a subida" do vídeo (o piso é 20 m)
    expect(p!.maiorSubida).toBeNull();
  });

  it("a altitude no instante do percurso é interpolada", () => {
    const p = trailProfile(buildTrack(reto([100, 200, 300])))!;
    expect(elevacaoEm(p, 0)).toBeCloseTo(100, 0);
    expect(elevacaoEm(p, 1)).toBeCloseTo(300, 0);
    const meio = elevacaoEm(p, 0.5)!;
    expect(meio).toBeGreaterThan(150);
    expect(meio).toBeLessThan(250);
    // fora da faixa, gruda nas pontas
    expect(elevacaoEm(p, -1)).toBeCloseTo(100, 0);
    expect(elevacaoEm(p, 2)).toBeCloseTo(300, 0);
  });

  it("a inclinação da subida é metros por metro, em porcentagem", () => {
    // 100 → 200 m em ~1,8 km (10 pontos de ~200 m)
    const p = trailProfile(buildTrack(reto([100, 111, 122, 133, 144, 155, 166, 177, 188, 200])))!;
    const km = 1.8;
    const inc = inclinacaoDaSubida(p, km * 1000)!;
    expect(inc).toBeGreaterThan(3);
    expect(inc).toBeLessThan(8);
    // sem relevo de verdade, não há inclinação
    expect(inclinacaoDaSubida({ ...p, maiorSubida: null }, 1000)).toBeNull();
  });

  it("a faixa sobe quando a barra de progresso está ligada", () => {
    const com = profileLayout(720, 1280, 1, true);
    const sem = profileLayout(720, 1280, 1, false);
    expect(com.w).toBe(720 - 52);
    expect(com.y).toBeLessThan(sem.y); // mais acima no quadro
    // e nunca encosta na barra de progresso (que vive nos últimos 46 px)
    expect(com.y + com.h).toBeLessThanOrEqual(1280 - 46);
    expect(sem.y + sem.h).toBeLessThanOrEqual(1280 - 10);
  });

  it("aguenta traçado curto, com um ponto só e altitude furada", () => {
    expect(trailProfile(buildTrack([{ lat: 0, lng: 0, ele: 10 }]))).toBeNull();
    const furado = [
      { lat: -23.5, lng: -48.4, ele: 100 },
      { lat: -23.501, lng: -48.4, ele: Number.NaN },
      { lat: -23.502, lng: -48.4, ele: 180 },
      { lat: -23.503, lng: -48.4, ele: 240 },
    ];
    const p = trailProfile(buildTrack(furado))!;
    expect(p).not.toBeNull();
    // as colunas em cima do ponto sem altitude são omitidas, não inventadas
    expect(p.pontos.every((q) => Number.isFinite(q.ele))).toBe(true);
  });
});
