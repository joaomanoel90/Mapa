import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, maxZoomFor, sanitizeSettings, type Settings } from "./settings";
import { BASEMAPS } from "./tiles";

/** Ajuda a montar entradas inválidas sem brigar com o tipo. */
const raw = (o: Record<string, unknown>) => o as Partial<Settings>;

describe("sanitizeSettings", () => {
  it("mantém um conjunto válido intacto", () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS });
    expect(out.basemap).toBe(DEFAULT_SETTINGS.basemap);
    expect(out.aspect).toBe(DEFAULT_SETTINGS.aspect);
    expect(out.duration).toBe(DEFAULT_SETTINGS.duration);
    expect(out.profile).toBe(DEFAULT_SETTINGS.profile);
  });

  it("descarta estilo de mapa que não existe mais (ex.: CARTO)", () => {
    // estilos antigos salvos no localStorage deixariam o mapa em branco
    expect(sanitizeSettings(raw({ basemap: "carto" })).basemap).toBeUndefined();
    expect(sanitizeSettings(raw({ basemap: "dark" })).basemap).toBe("dark");
  });

  it("descarta proporção desconhecida", () => {
    expect(sanitizeSettings(raw({ aspect: "3:2" })).aspect).toBeUndefined();
    expect(sanitizeSettings(raw({ aspect: "9:16" })).aspect).toBe("9:16");
  });

  it("prende a duração entre 3 e 60 s", () => {
    expect(sanitizeSettings(raw({ duration: 2 })).duration).toBeUndefined();
    expect(sanitizeSettings(raw({ duration: 61 })).duration).toBeUndefined();
    expect(sanitizeSettings(raw({ duration: 3 })).duration).toBe(3);
    expect(sanitizeSettings(raw({ duration: 60 })).duration).toBe(60);
    expect(sanitizeSettings(raw({ duration: "14" })).duration).toBeUndefined();
  });

  it("prende o zoom entre 3 e 19", () => {
    expect(sanitizeSettings(raw({ followZoom: 2 })).followZoom).toBeUndefined();
    expect(sanitizeSettings(raw({ followZoom: 20 })).followZoom).toBeUndefined();
    expect(sanitizeSettings(raw({ followZoom: 16 })).followZoom).toBe(16);
  });

  it("só aceita os dois modos de câmera", () => {
    expect(sanitizeSettings(raw({ cameraMode: "orbit" })).cameraMode).toBeUndefined();
    expect(sanitizeSettings(raw({ cameraMode: "fit" })).cameraMode).toBe("fit");
    expect(sanitizeSettings(raw({ cameraMode: "follow" })).cameraMode).toBe("follow");
  });

  it("só aceita os perfis conhecidos", () => {
    expect(sanitizeSettings(raw({ profile: "plane" })).profile).toBeUndefined();
    for (const p of ["car", "bike", "foot", "straight"]) {
      expect(sanitizeSettings(raw({ profile: p })).profile).toBe(p);
    }
  });

  it("exige booleanos onde o tipo pede booleano", () => {
    expect(sanitizeSettings(raw({ ignoreOneway: "sim" })).ignoreOneway).toBeUndefined();
    expect(sanitizeSettings(raw({ snapToRoad: 1 })).snapToRoad).toBeUndefined();
    expect(sanitizeSettings(raw({ showStopCounter: null })).showStopCounter).toBeUndefined();
    expect(sanitizeSettings(raw({ snapToRoad: false })).snapToRoad).toBe(false);
  });

  it("não deixa passar lixo vindo de JSON corrompido", () => {
    const out = sanitizeSettings(
      raw({ basemap: 7, aspect: [], duration: {}, profile: [], followZoom: "x" }),
    );
    expect(out.basemap).toBeUndefined();
    expect(out.aspect).toBeUndefined();
    expect(out.duration).toBeUndefined();
    expect(out.profile).toBeUndefined();
    expect(out.followZoom).toBeUndefined();
  });
});

describe("maxZoomFor", () => {
  it("respeita o teto de cada provedor de tiles", () => {
    expect(maxZoomFor("topo")).toBe(17);
    expect(maxZoomFor("cyclosm")).toBe(18);
    expect(maxZoomFor("dark")).toBe(19);
  });

  it("tem um teto definido para todos os estilos", () => {
    for (const id of Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]) {
      const z = maxZoomFor(id);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThanOrEqual(19);
    }
  });
});
