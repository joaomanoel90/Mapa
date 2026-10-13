import { describe, expect, it } from "vitest";
import { BASEMAP_ORDER, BASEMAPS, tileUrl, type Basemap } from "./tiles";

/** Estilo de teste com subdomínios, para checar a rotação de {s}. */
const comSubdominios: Basemap = {
  ...BASEMAPS.osm,
  subdomains: ["a", "b", "c"],
  template: "https://{s}.exemplo.org/{z}/{x}/{y}.png",
};

describe("tileUrl", () => {
  it("substitui z, x e y", () => {
    expect(tileUrl(BASEMAPS.dark, 3, 2, 1)).toBe("https://tile.openstreetmap.org/3/2/1.png");
  });

  it("respeita a ordem das coordenadas pedida pelo provedor", () => {
    // o World_Imagery da Esri usa {z}/{y}/{x}
    expect(tileUrl(BASEMAPS.satellite, 5, 3, 7)).toContain("/tile/5/7/3");
  });

  it("remove o {s} quando o estilo não tem subdomínios", () => {
    const semSub: Basemap = { ...BASEMAPS.dark, template: "https://fixo.org/{s}/{z}/{x}/{y}.png" };
    expect(tileUrl(semSub, 1, 0, 0)).toBe("https://fixo.org//1/0/0.png");
  });

  it("rotaciona os subdomínios de forma estável", () => {
    // z=3 → x=2, y=1 → (2+1) % 3 = 0 → "a"
    expect(tileUrl(comSubdominios, 3, 2, 1)).toBe("https://a.exemplo.org/3/2/1.png");
    // y=2 → (2+2) % 3 = 1 → "b"
    expect(tileUrl(comSubdominios, 3, 2, 2)).toBe("https://b.exemplo.org/3/2/2.png");
    // y=3 → (2+3) % 3 = 2 → "c"
    expect(tileUrl(comSubdominios, 3, 2, 3)).toBe("https://c.exemplo.org/3/2/3.png");
  });

  it("dá o mesmo resultado para o mesmo tile (cache do navegador aproveita)", () => {
    expect(tileUrl(comSubdominios, 12, 2048, 1365)).toBe(tileUrl(comSubdominios, 12, 2048, 1365));
  });

  it("dá a volta no mundo quando x sai da faixa", () => {
    // z=1 tem 2 colunas: x=3 volta para a coluna 1
    expect(tileUrl(BASEMAPS.dark, 1, 3, 0)).toBe("https://tile.openstreetmap.org/1/1/0.png");
    expect(tileUrl(BASEMAPS.dark, 1, -1, 0)).toBe("https://tile.openstreetmap.org/1/1/0.png");
  });

  it("mantém x dentro da faixa em zoom alto", () => {
    const n = Math.pow(2, 18);
    const url = tileUrl(BASEMAPS.dark, 18, n + 5, 0);
    expect(url).toContain(`/18/5/0.png`);
  });
});

describe("catálogo de estilos", () => {
  it("a ordem lista exatamente os estilos existentes", () => {
    expect([...BASEMAP_ORDER].sort()).toEqual(Object.keys(BASEMAPS).sort());
  });

  it("todo estilo tem template, atribuição e licença", () => {
    for (const id of BASEMAP_ORDER) {
      const b = BASEMAPS[id];
      expect(b.template, id).toMatch(/^https:\/\//);
      expect(b.attribution, id).toBeTruthy();
      expect(b.license, id).toBeTruthy();
      expect(b.maxZoom, id).toBeGreaterThan(0);
    }
  });

  it("nenhum estilo depende de chave de API", () => {
    // requisito do projeto: mapas gratuitos, sem cadastro
    for (const id of BASEMAP_ORDER) {
      expect(BASEMAPS[id].template.toLowerCase(), id).not.toContain("api_key");
      expect(BASEMAPS[id].template.toLowerCase(), id).not.toContain("access_token");
    }
  });
});
