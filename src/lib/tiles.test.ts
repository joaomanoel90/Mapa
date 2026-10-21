import { describe, expect, it } from "vitest";
import {
  BASEMAP_ORDER,
  BASEMAPS,
  HILLSHADE,
  RELEVO_DO_MAPA,
  emPixelInteiro,
  hillshadeBloco,
  hillshadeUrl,
  pontoEmPixelInteiro,
  relevoDoMapa,
  tileUrl,
  type Basemap,
} from "./tiles";

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

/* ------------------------------------------------------------------ */
/* A grade de pixels do dispositivo                                    */
/* ------------------------------------------------------------------ */

describe("a grade de pixels", () => {
  it("prende o valor no pixel do dispositivo", () => {
    expect(emPixelInteiro(10.24, 1)).toBe(10);
    expect(emPixelInteiro(10.6, 1)).toBe(11);
    // com dpr 2 o pixel do aparelho é meio pixel de CSS: 10,25 → 10,5 (não 10)
    expect(emPixelInteiro(10.24, 2)).toBe(10);
    expect(emPixelInteiro(10.26, 2)).toBe(10.5);
    expect(emPixelInteiro(10.75, 2)).toBe(11);
  });

  it("o resultado cai na grade do aparelho, seja qual for o dpr", () => {
    /*
     * É a conta que o mapa precisa para não deixar fresta: o valor preso tem de
     * ser um número **inteiro de pixels de aparelho** — e isso vale também para
     * o dpr fracionário (1,5 e 1,25 existem em celular e em tela com zoom).
     */
    for (const dpr of [1, 1.25, 1.5, 2, 2.75, 3]) {
      for (const v of [0, 0.1, 3.33, 17.5, 128.02, 333.33, -7.4]) {
        const preso = emPixelInteiro(v, dpr);
        expect(Math.abs(preso * dpr - Math.round(preso * dpr)), `dpr ${dpr} em ${v}`).toBeLessThan(1e-9);
        expect(Math.abs(preso - v)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
      }
    }
  });

  it("não deixa o valor fugir por causa de lixo na entrada", () => {
    expect(emPixelInteiro(7.4, 0)).toBe(7);
    expect(emPixelInteiro(7.4, NaN)).toBe(7);
    expect(emPixelInteiro(7.4, -2)).toBe(7);
  });

  it("prende os dois eixos de uma posição do mapa", () => {
    expect(pontoEmPixelInteiro(10.26, 20.74, 2)).toEqual({ x: 10.5, y: 20.5 });
    // o ajuste é pequeno: menos de meio pixel de aparelho em cada eixo
    const { x, y } = pontoEmPixelInteiro(100.37, -50.61, 2);
    expect(Math.abs(x - 100.37)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(y + 50.61)).toBeLessThanOrEqual(0.25);
  });

  it("o movimento de um quadro não vira degrau: um pixel de deslocamento continua igual", () => {
    /*
     * A câmera "Seguir" move o mapa a cada quadro. Se o arredondamento mudasse
     * o passo, o mapa andaria aos saltos: aqui, um deslocamento de 1 px de
     * aparelho chega inteiro — e o que sobra do arredondamento é menor que meio
     * pixel (invisível).
     */
    const dpr = 2;
    let pos = 0;
    const passos: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const alvo = pos + 1 / dpr; // exatamente 1 px de aparelho por quadro
      const preso = emPixelInteiro(alvo, dpr);
      passos.push(preso - pos);
      pos = preso;
    }
    expect(new Set(passos)).toEqual(new Set([0.5]));
    expect(pos).toBeCloseTo(40 / dpr, 9);
    // e acompanhando um alvo quebrado (o caso real), o atraso fica abaixo de
    // meio pixel de aparelho, sem acumular
    let p2 = 0;
    for (let i = 1; i <= 200; i++) {
      const alvo = i * 0.37;
      p2 = emPixelInteiro(alvo, dpr);
      expect(Math.abs(p2 - alvo)).toBeLessThanOrEqual(0.25);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Relevo                                                              */
/* ------------------------------------------------------------------ */

describe("o sombreado do relevo", () => {
  it("usa {z}/{y}/{x}, como o serviço do Esri pede", () => {
    expect(hillshadeUrl(5, 3, 7)).toContain("/tile/5/7/3");
    expect(hillshadeUrl(5, 3, 7)).toContain("World_Hillshade");
  });

  it("até o zoom 16, o bloco é ele mesmo (sem recorte)", () => {
    const b = hillshadeBloco(12, 100, 200);
    expect(b.url).toContain("/tile/12/200/100");
    expect(b).toMatchObject({ sx: 0, sy: 0, sw: 256, sh: 256 });
  });

  it("acima do 16, recorta o bloco do 16 — o serviço não tem além disso", () => {
    const z = 18;
    const x = 4 * 137 + 3; // 3º filho de 4 do pai 137
    const y = 4 * 250 + 1;
    const b = hillshadeBloco(z, x, y);
    expect(b.url).toContain("/tile/16/250/137");
    // um quarto do bloco do 16, no quadrante certo
    expect(b.sw).toBe(64);
    expect(b.sh).toBe(64);
    expect(b.sx).toBe(3 * 64);
    expect(b.sy).toBe(1 * 64);
  });

  it("em zoom 19, o pedaço é um oitavo do bloco do 16", () => {
    const b = hillshadeBloco(19, 8 * 9 + 7, 8 * 4 + 2);
    expect(b.url).toContain("/tile/16/4/9");
    expect(b.sw).toBe(32);
    expect(b.sx).toBe(7 * 32);
    expect(b.sy).toBe(2 * 32);
  });

  it("o Escuro não usa multiply: sombra sobre sombra não apareceria", () => {
    expect(relevoDoMapa("dark")).toEqual({ modo: "screen", alpha: 0.3 });
    expect(relevoDoMapa("light")?.modo).toBe("multiply");
    expect(relevoDoMapa("osm")?.modo).toBe("multiply");
    expect(relevoDoMapa("satellite")?.modo).toBe("multiply");
  });

  it("o Topo já tem relevo: sombrear de novo só escureceria", () => {
    expect(relevoDoMapa("topo")).toBeNull();
  });

  it("todo mapa tem uma resposta (nada de buraco no registro)", () => {
    for (const id of BASEMAP_ORDER) {
      expect(RELEVO_DO_MAPA[id] !== undefined).toBe(true);
    }
    expect(HILLSHADE.maxZoom).toBe(16);
  });
});
