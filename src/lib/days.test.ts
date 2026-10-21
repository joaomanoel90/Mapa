import { describe, expect, it } from "vitest";
import { buildTrack, type LatLng } from "./geo";
import { DIA_FADE_S, DIA_FICA_S, INTERVALO_DE_DIA_MS, diaNaTela, diasDoPercurso } from "./days";

const H = 3_600_000;
const T0 = Date.parse("2026-10-13T08:00:00Z");

/** Um dia de caminhada em linha reta, `n` pontos, começando em `inicio`. */
function dia(inicio: number, n = 60, deslocamento = 0): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: -23.5 + deslocamento + i * 0.0005,
    lng: -48.4 + i * 0.0003,
    t: inicio + i * 60_000,
  }));
}

/** Um percurso contínuo de dois dias: a noite cai no ponto 60. */
function doisDias(): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < 120; i++) {
    const depoisDaNoite = i >= 60;
    pts.push({
      lat: -23.5 + i * 0.0005,
      lng: -48.4 + i * 0.0003,
      t: depoisDaNoite ? T0 + 9 * H + (i - 60) * 60_000 : T0 + i * 60_000,
    });
  }
  return pts;
}

describe("dias do percurso", () => {
  it("separa dois dias pela noite (o intervalo entre os pontos)", () => {
    const track = buildTrack(doisDias());
    const dias = diasDoPercurso(track);
    expect(dias).toHaveLength(2);
    expect(dias[0].n).toBe(1);
    expect(dias[1].n).toBe(2);
    // os dias se tocam: um termina onde o outro começa
    expect(dias[0].t0).toBeCloseTo(0, 3);
    expect(dias[0].t1).toBeCloseTo(0.5, 2);
    expect(dias[1].t0).toBeCloseTo(dias[0].t1, 6);
    expect(dias[1].t1).toBeCloseTo(1, 2);
    expect(dias[0].metros).toBeGreaterThan(1000);
    expect(dias[1].metros).toBeGreaterThan(1000);
    expect(dias[1].inicio).toBe(T0 + 9 * H);
  });

  it("atravessar a meia-noite sem parar continua sendo um dia", () => {
    // uma pedalada das 22h às 2h: a data muda, a atividade não
    const noite = Date.parse("2026-10-13T22:00:00Z");
    const track = buildTrack(dia(noite, 240));
    expect(diasDoPercurso(track)).toEqual([]);
  });

  it("uma parada longa abaixo do limite ainda é o mesmo dia", () => {
    const a = dia(T0, 30);
    const b = dia(T0 + 5 * H, 30, 0.02);
    const track = buildTrack([...a, ...b]);
    expect(diasDoPercurso(track)).toEqual([]);
    // e passando do limite — medido do último ponto do dia 1 —, vira o dia 2
    const ultimo = a[a.length - 1].t as number;
    const c = dia(ultimo + INTERVALO_DE_DIA_MS + 1, 30, 0.02);
    expect(diasDoPercurso(buildTrack([...a, ...c]))).toHaveLength(2);
  });

  it("sem hora em todos os pontos não há dias para dividir", () => {
    const comHora = dia(T0, 30);
    const semHora: LatLng[] = [{ lat: -23.4, lng: -48.3 }];
    expect(diasDoPercurso(buildTrack([...comHora, ...semHora]))).toEqual([]);
    expect(diasDoPercurso(buildTrack(semHora))).toEqual([]);
    expect(diasDoPercurso(buildTrack([]))).toEqual([]);
  });
});

describe("o aviso de dia novo na tela", () => {
  const track = buildTrack(doisDias());
  const dias = diasDoPercurso(track);
  const percursoS = 20;

  it("não aparece no dia 1 — o vídeo já começa nele", () => {
    expect(diaNaTela(dias, 0, percursoS)).toBeNull();
    expect(diaNaTela(dias, 0.1, percursoS)).toBeNull();
  });

  it("entra quando o personagem cruza para o dia 2, e sai alguns segundos depois", () => {
    const t0 = dias[1].t0;
    const emCena = diaNaTela(dias, t0 + 0.5 / percursoS, percursoS);
    expect(emCena?.dia.n).toBe(2);
    expect(emCena!.alfa).toBeGreaterThan(0.5);
    // passou o tempo do aviso, sumiu
    expect(diaNaTela(dias, t0 + (DIA_FICA_S + 0.2) / percursoS, percursoS)).toBeNull();
  });

  it("a opacidade entra e sai sem piscar", () => {
    const t0 = dias[1].t0;
    const inicio = diaNaTela(dias, t0, percursoS)!;
    const meio = diaNaTela(dias, t0 + (DIA_FICA_S / 2) / percursoS, percursoS)!;
    const fim = diaNaTela(dias, t0 + (DIA_FICA_S - 0.01) / percursoS, percursoS)!;
    expect(inicio.alfa).toBeLessThan(0.1);
    expect(meio.alfa).toBeCloseTo(1, 1);
    expect(fim.alfa).toBeLessThan(0.1);
    expect(DIA_FADE_S).toBeGreaterThan(0);
  });

  it("sem dias (ou com um só) não há aviso", () => {
    expect(diaNaTela([], 0.5, percursoS)).toBeNull();
    expect(diaNaTela([dias[0]], 0.5, percursoS)).toBeNull();
    expect(diaNaTela(dias, 0.5, 0)).toBeNull();
  });
});
