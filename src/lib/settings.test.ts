import { describe, expect, it } from "vitest";
import {
  ACTIVITIES,
  DEFAULT_SETTINGS,
  maxZoomFor,
  sanitizeSettings,
  usaRitmo,
  type Settings,
} from "./settings";
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

  it("exige booleano na exportação rápida", () => {
    expect(sanitizeSettings(raw({ fastExport: "sim" })).fastExport).toBeUndefined();
    expect(sanitizeSettings(raw({ fastExport: false })).fastExport).toBe(false);
  });

  it("liga a exportação rápida por padrão", () => {
    // o app cai sozinho para o MediaRecorder quando o navegador não suporta
    expect(DEFAULT_SETTINGS.fastExport).toBe(true);
    // o mapa em miniatura nasce ligado: é o que mostra onde o personagem está
    expect(DEFAULT_SETTINGS.minimap).toBe(true);
    expect(sanitizeSettings(raw({ minimap: "sim" })).minimap).toBeUndefined();
    expect(sanitizeSettings(raw({ minimap: false })).minimap).toBe(false);
    /*
     * O perfil de elevação nasce ligado, mas **não** é obrigatório: quem grava
     * rota sem altitude (ou não quer a faixa) desliga no painel.
     */
    expect(DEFAULT_SETTINGS.elevationProfile).toBe(true);
    expect(sanitizeSettings(raw({ elevationProfile: "sim" })).elevationProfile).toBeUndefined();
    expect(sanitizeSettings(raw({ elevationProfile: false })).elevationProfile).toBe(false);
    // o avatar é opcional e passa pela mesma peneira da foto da cartela
    expect(DEFAULT_SETTINGS.avatar).toBe("");
    const foto = "data:image/jpeg;base64,AAAA";
    expect(sanitizeSettings(raw({ avatar: foto })).avatar).toBe(foto);
    expect(sanitizeSettings(raw({ avatar: "https://exemplo.com/eu.jpg" })).avatar).toBeUndefined();
    expect(sanitizeSettings(raw({ avatar: "x".repeat(400_001) })).avatar).toBeUndefined();
  });

  it("só aceita os três modos de cor da rota", () => {
    expect(sanitizeSettings(raw({ colorBy: "speed" })).colorBy).toBe("speed");
    expect(sanitizeSettings(raw({ colorBy: "slope" })).colorBy).toBe("slope");
    expect(sanitizeSettings(raw({ colorBy: "sólida" })).colorBy).toBeUndefined();
    expect(sanitizeSettings(raw({ colorBy: 3 })).colorBy).toBeUndefined();
  });

  it("exige booleano nas marcas de km e na câmera cinematográfica", () => {
    expect(sanitizeSettings(raw({ showKmMarks: "sim" })).showKmMarks).toBeUndefined();
    expect(sanitizeSettings(raw({ cinematic: "sim" })).cinematic).toBeUndefined();
    expect(sanitizeSettings(raw({ showKmMarks: true })).showKmMarks).toBe(true);
    expect(sanitizeSettings(raw({ cinematic: false })).cinematic).toBe(false);
  });

  it("exige booleano também na terceira pessoa e no giro do mapa", () => {
    expect(sanitizeSettings(raw({ thirdPerson: "sim" })).thirdPerson).toBeUndefined();
    expect(sanitizeSettings(raw({ spinMap: 1 })).spinMap).toBeUndefined();
    expect(sanitizeSettings(raw({ thirdPerson: true })).thirdPerson).toBe(true);
    expect(sanitizeSettings(raw({ spinMap: false })).spinMap).toBe(false);
  });

  it("exige booleano também na inclinação do horizonte", () => {
    expect(sanitizeSettings(raw({ tiltHorizonte: "sim" })).tiltHorizonte).toBeUndefined();
    expect(sanitizeSettings(raw({ tiltHorizonte: true })).tiltHorizonte).toBe(true);
    // e ela nasce **ligada**: é o que faz a terceira pessoa parecer uma câmera atrás
    expect(DEFAULT_SETTINGS.tiltHorizonte).toBe(true);
  });

  it("nasce com a linha sólida e as novidades desligadas", () => {
    // as três são facultativas: quem não mexer no painel não vê diferença
    expect(DEFAULT_SETTINGS.colorBy).toBe("solid");
    expect(DEFAULT_SETTINGS.showKmMarks).toBe(false);
    expect(DEFAULT_SETTINGS.cinematic).toBe(false);
    // a câmera de sempre é a que já existia: quem não mexer não vê diferença
    expect(DEFAULT_SETTINGS.thirdPerson).toBe(false);
    expect(DEFAULT_SETTINGS.spinMap).toBe(false);
  });

  it("só aceita foto do projeto como data URL de imagem dentro do teto", () => {
    const foto = "data:image/jpeg;base64,AAAA";
    expect(sanitizeSettings(raw({ cardPhoto: foto })).cardPhoto).toBe(foto);
    // URL externa, svg e texto não passam: a foto é desenhada no canvas e
    // guardada no localStorage, e nenhum dos dois aceita qualquer coisa
    expect(sanitizeSettings(raw({ cardPhoto: "https://x.com/a.jpg" })).cardPhoto).toBeUndefined();
    expect(sanitizeSettings(raw({ cardPhoto: "data:image/svg+xml;base64,AA" })).cardPhoto).toBeUndefined();
    expect(sanitizeSettings(raw({ cardPhoto: 42 })).cardPhoto).toBeUndefined();
  });

  it("nasce sem foto do projeto", () => {
    expect(DEFAULT_SETTINGS.cardPhoto).toBe("");
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

describe("campos da cartela", () => {
  it("nasce vazia: nada entra sozinho no vídeo", () => {
    expect(DEFAULT_SETTINGS.cardDistance).toBe("");
    expect(DEFAULT_SETTINGS.cardElevation).toBe("");
    expect(DEFAULT_SETTINGS.cardTime).toBe("");
    expect(DEFAULT_SETTINGS.cardNote).toBe("");
  });

  it("aceita texto nos quatro campos", () => {
    const s = sanitizeSettings({
      cardDistance: "49 km",
      cardElevation: "+1.676 m",
      cardTime: "3 h 19 min",
      cardNote: "com os amigos",
    });
    expect(s.cardDistance).toBe("49 km");
    expect(s.cardElevation).toBe("+1.676 m");
    expect(s.cardTime).toBe("3 h 19 min");
    expect(s.cardNote).toBe("com os amigos");
  });

  it("descarta o que não for texto", () => {
    const s = sanitizeSettings({
      cardDistance: 42 as unknown as string,
      cardElevation: null as unknown as string,
    });
    expect(s.cardDistance).toBeUndefined();
    expect(s.cardElevation).toBeUndefined();
  });
});

describe("atividade", () => {
  it("o padrão é pedal: o HUD continua em km/h para quem já usa", () => {
    expect(DEFAULT_SETTINGS.activity).toBe("pedal");
    expect(usaRitmo(DEFAULT_SETTINGS.activity)).toBe(false);
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS }).activity).toBe("pedal");
  });

  it("só aceita as três atividades conhecidas", () => {
    expect(sanitizeSettings(raw({ activity: "natacao" })).activity).toBeUndefined();
    expect(sanitizeSettings(raw({ activity: 7 })).activity).toBeUndefined();
    for (const a of ACTIVITIES) {
      expect(sanitizeSettings(raw({ activity: a.id })).activity).toBe(a.id);
    }
  });

  it("a pé (corrida e caminhada), o HUD mostra ritmo", () => {
    expect(usaRitmo("corrida")).toBe(true);
    expect(usaRitmo("caminhada")).toBe(true);
    expect(usaRitmo("pedal")).toBe(false);
  });
});
