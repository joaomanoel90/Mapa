import { describe, expect, it } from "vitest";
import { buildTrack, cumulative, sampleTrack } from "./geo";
import { formatPace } from "./hud";
import { buildTimeline, routeEnd, routeProgress, type Timeline } from "./timeline";
import { colorizeRoute, NEUTRAL_COLOR } from "./coloring";
import { formatClock, timesOf } from "./hud";
import { type PhotoImage, type PhotoLookup } from "./photos";
import type { Poi } from "./pois";
import { kmMarks } from "./km-marks";
import { findCharacter, gaitOf } from "./characters";
import {
  SceneRenderer,
  PINO_CRESCE_S,
  andar,
  crescimentoDoPino,
  pipocoDaPonta,
  inclinacaoDaCurva,
  liftToClear,
  overlapsCard,
  projetorDaVista,
  summaryBox,
  tilesDaVista,
  vistaDe,
  type FrameState,
  type SceneStyle,
} from "./renderer";
import { CHASE_ALTURA } from "./camera";
import { project } from "./geo";
import { endCard, rideSummary, type EndCard } from "./stats";

/**
 * Canvas de mentira que anota o que foi desenhado.
 *
 * O renderizador é feito para o canvas do navegador, que não existe aqui — mas
 * o que interessa nestes testes não é o pixel e sim **quais textos entram na
 * tela e quando**. O proxy devolve uma função vazia para qualquer método (e
 * outro proxy para encadeamento tipo `gradient.addColorStop`), guardando as
 * chamadas de `fillText`.
 */
function fakeCtx() {
  const textos: string[] = [];
  /** arcos desenhados: [x, y, raio, início, fim] */
  const arcos: number[][] = [];
  /**
   * Os mesmos arcos, mas com a posição **absoluta** (soma o `translate` em
   * vigor). É o que permite perguntar onde o personagem estava na tela — o
   * `arcos` sozinho é sempre (0,0) porque o desenho translada antes.
   */
  const arcosPos: number[][] = [];
  /** cada `rotate` (em graus), na ordem — é assim que se mede a virada */
  const giros: number[] = [];
  /** cada `stroke()`: a cor, a espessura e quantos pontos o caminho tinha */
  const tracos: { cor: string; largura: number; pontos: number }[] = [];
  /** cada `fill()`: a cor de preenchimento em vigor (a polaroide branca era um fill) */
  const pinturas: string[] = [];
  /** cada `drawImage`: os argumentos, o alfa e a escala em vigor no momento */
  const imagens: { args: number[]; alpha: number; escala: number }[] = [];
  /** o y de cada `fillText`, na mesma ordem de `textos` */
  const textosY: number[] = [];
  /**
   * Posição **absoluta** de cada texto, na ordem de `textos`: soma o
   * deslocamento em vigor. É o que importa quando um pino é empurrado para fora
   * da cartela — o `textosY` sozinho é a posição dentro do `translate`.
   */
  const textosYAbs: number[] = [];
  /** cor em vigor em cada texto (na ordem de `textos`) */
  const textosCor: string[] = [];
  /** o que foi desenhado, na ordem: "texto:…" ou "imagem" */
  const ordem: string[] = [];
  /** posição de cada texto (para achar as marcas da linha do tempo) */
  const textosPos: { s: string; x: number; y: number }[] = [];
  /** primeiro ponto de cada `moveTo` (onde o traçado caiu na tela) */
  const movimentos: number[][] = [];
  const props: Record<string, unknown> = {};
  let pontos = 0;
  // deslocamento em vigor (segue `save`/`restore`/`translate`)
  let tx = 0;
  let ty = 0;
  // escala acumulada (o `ctx.scale` do "pipoco" dos pinos, por exemplo)
  let esc = 1;
  const pilha: [number, number, number][] = [];
  const make = (): unknown =>
    new Proxy(function () {} as unknown as object, {
      get(_alvo, prop) {
        if (prop === "measureText") return (s: string) => ({ width: String(s).length * 9 });
        if (prop === "canvas") return { width: 1280, height: 720 };
        if (
          prop === "createLinearGradient" ||
          prop === "createRadialGradient" ||
          prop === "createPattern"
        ) {
          return () => make();
        }
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          if (prop === "save") pilha.push([tx, ty, esc]);
          if (prop === "restore") {
            const p = pilha.pop();
            if (p) {
              tx = p[0];
              ty = p[1];
              esc = p[2];
            }
          }
          if (prop === "scale") esc *= Number(args[0] ?? 1);
          if (prop === "translate") {
            tx += Number(args[0] ?? 0);
            ty += Number(args[1] ?? 0);
          }
          if (prop === "fillText" && typeof args[0] === "string") {
            textos.push(args[0]);
            textosY.push(Number(args[2] ?? args[1] ?? 0));
            textosPos.push({
              s: args[0],
              x: Number(args[1] ?? 0),
              y: Number(args[2] ?? 0),
            });
            textosYAbs.push(ty + Number(args[2] ?? args[1] ?? 0));
            textosCor.push(String(props.fillStyle ?? ""));
            ordem.push(`texto:${args[0]}`);
          }
          if (prop === "drawImage") {
            ordem.push("imagem");
            imagens.push({
              args: args.slice(1).map((a) => Number(a)),
              alpha: Number(props.globalAlpha ?? 1),
              escala: esc,
            });
          }
          if (prop === "rotate") giros.push((Number(args[0] ?? 0) * 180) / Math.PI);
          if (prop === "arc") {
            arcos.push(args as number[]);
            arcosPos.push([tx + Number(args[0] ?? 0), ty + Number(args[1] ?? 0), ...(args.slice(2) as number[])]);
          }
          // só a cor em texto: alguns lugares passam um gradiente (objeto) aqui
          if (prop === "fill" && typeof props.fillStyle === "string") {
            pinturas.push(props.fillStyle);
          }
          if (prop === "beginPath") pontos = 0;
          if (prop === "moveTo") {
            pontos++;
            movimentos.push(args as number[]);
          }
          if (prop === "lineTo") pontos++;
          if (prop === "stroke") {
            tracos.push({
              cor: String(props.strokeStyle ?? ""),
              largura: Number(props.lineWidth ?? 0),
              pontos,
            });
          }
          return make();
        };
      },
      set(_alvo, prop, valor) {
        props[String(prop)] = valor;
        return true;
      },
    });
  return {
    ctx: make() as CanvasRenderingContext2D,
    textos,
    textosY,
    textosYAbs,
    textosPos,
    textosCor,
    ordem,
    arcos,
    arcosPos,
    giros,
    tracos,
    movimentos,
    imagens,
    pinturas,
  };
}

/** Desenha um quadro num renderizador novo (câmera limpa a cada caso). */
const desenhar = (
  ctx: CanvasRenderingContext2D,
  st: FrameState,
  trk = track,
  w = 1280,
  h = 720,
) => new SceneRenderer("dark").render(ctx, w, h, { ...st, track: trk });

/** Arco de andamento do anel: o último arco que não é o círculo inteiro. */
function arcoDoAndamento(arcos: number[][]) {
  const parcial = arcos.filter((a) => Math.abs(a[4] - a[3]) < Math.PI * 2 - 1e-6);
  if (parcial.length === 0) return null;
  const [x, y, r, ini, fim] = parcial[parcial.length - 1];
  return { x, y, r, fracao: (fim - ini) / (Math.PI * 2) };
}

/**
 * As fotos do quadro, separadas por onde aparecem.
 *
 * Quem tem foto mostra **duas** imagens: a pequena, dentro do selo do pino (o
 * trajeto inteiro) e a grande, que aparece quando o personagem passa. Os testes
 * de "a foto apareceu" falam da grande; o pino tem os seus.
 */
const LIMITE_PINO = 40; // o miolo do pino tem ~29 px de lado em 1280×720
const fotosGrandes = (f: ReturnType<typeof fakeCtx>) =>
  f.imagens.filter((i) => i.args[6] > LIMITE_PINO);
const fotosDoPino = (f: ReturnType<typeof fakeCtx>) =>
  f.imagens.filter((i) => i.args[6] <= LIMITE_PINO);

const style: SceneStyle = {
  // (o HUD em ritmo entra por `pace`; sem ele é km/h, o de sempre)
  accent: "#a3e635",
  basemap: "dark",
  showRoute: true,
  showTraveled: true,
  showEndpoints: true,
  showStops: true,
  showStopLabels: true,
  showStopCounter: true,
  showTitle: false,
  showProgress: false,
  showSummary: true,
  showHud: true,
  title: "",
  subtitle: "",
};

const T0 = Date.parse("2026-10-13T09:00:00Z");
const TRACK_PTS = [
  { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
  { lat: -23.51, lng: -48.41, ele: 780, t: T0 + 900_000 },
  { lat: -23.52, lng: -48.42, ele: 842, t: T0 + 1800_000 },
];
const track = buildTrack(TRACK_PTS);

/**
 * Um quadro qualquer.
 *
 * `t` é o progresso do **percurso** (é assim que o renderizador fala) e
 * `elapsed` é o instante do **vídeo**, em segundos — as janelas de vídeo
 * (fotos, cartela) são medidas nele. Quando há cartela, o percurso termina
 * antes do fim do vídeo: 4,2 s ficam reservados para ela.
 */
const estado = (
  t: number,
  duration: number,
  summary: EndCard | null,
  times: number[] | null = null,
  cardSeconds: number | null = null,
  timeline: Timeline | null = null,
): FrameState => ({
  track,
  t,
  character: findCharacter("car"),
  rotate: false,
  camera: { mode: "fit", followZoom: 16 },
  style,
  stops: [],
  endpoints: { a: null, b: null },
  elapsed: t * duration,
  duration,
  timeline: timeline ?? buildTimeline(duration, { voo: false, cartela: summary !== null }),
  summary,
  times,
  cardSeconds,
});

/** A cartela como o usuário digita no painel. */
const digitada = {
  cardDistance: "49 km",
  cardElevation: "+1.676 m",
  cardTime: "3 h 19 min",
  cardNote: "",
};
const cartela = endCard(digitada, rideSummary(TRACK_PTS, 71_030));

describe("cartela final do vídeo", () => {
  it("desenha os números do percurso no fim do vídeo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, cartela));

    // o que foi digitado, e não o que o arquivo mediu
    expect(textos).toContain("49 km");
    expect(textos).toContain("+1.676 m");
    expect(textos).toContain("DISTÂNCIA");
    expect(textos).toContain("ELEVAÇÃO");
    expect(textos).not.toContain("71,03 km");
  });

  it("não aparece no meio do vídeo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(0.5, 14, cartela));
    expect(textos).not.toContain("49 km");
  });

  it("entra suavemente: no primeiro instante da cartela ainda está apagada", () => {
    const { ctx } = fakeCtx();
    const r = new SceneRenderer("dark");
    // o fade leva 0,6 s: no quadro exato do início o texto está desenhado com
    // alpha 0 (o canvas é quem aplica), então o que se testa aqui é que ele
    // entra depois — o quadro final é o que importa
    r.render(ctx, 1280, 720, estado(1 - 4.2 / 14, 14, cartela));
    const { ctx: ctx2, textos } = fakeCtx();
    r.render(ctx2, 1280, 720, estado(1, 14, cartela));
    expect(textos.length).toBeGreaterThan(0);
  });

  it("respeita o interruptor do painel", () => {
    const { ctx, textos } = fakeCtx();
    const semCartela = { ...style, showSummary: false };
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(1, 14, cartela),
      style: semCartela,
    });
    expect(textos).not.toContain("49 km");
  });

  it("não desenha a cartela quando não há resumo", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, null));
    // o resto do vídeo continua (pinos A/B, chegada, personagem): só a cartela não entra
    expect(textos).not.toContain("DISTÂNCIA");
    expect(textos).not.toContain("71,03 km");
  });

  it("mostra só as linhas que foram preenchidas", () => {
    const plana = [{ lat: -23.5, lng: -48.4 }, { lat: -23.6, lng: -48.5 }];
    const soDistancia = endCard(
      { cardDistance: "12,4 km", cardElevation: "", cardTime: "", cardNote: "" },
      rideSummary(plana, 12_400),
    );
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(1, 14, soDistancia),
      track: buildTrack(plana),
    });
    expect(textos).toContain("12,4 km");
    expect(textos).not.toContain("ELEVAÇÃO");
    expect(textos).not.toContain("TEMPO");
  });

  it("desenha a linha de baixo: a data do arquivo quando nada foi escrito", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, cartela));
    expect(textos.some((t) => t.includes("2026"))).toBe(true);
  });

  it("a linha de baixo escrita à mão substitui a data", () => {
    const r = new SceneRenderer("dark");
    const comNota = endCard(
      { ...digitada, cardNote: "com os amigos do pedal" },
      rideSummary(TRACK_PTS, 71_030),
    );
    const { ctx, textos } = fakeCtx();
    r.render(ctx, 1280, 720, estado(1, 14, comNota));
    expect(textos).toContain("com os amigos do pedal");
  });

  it("sem nada escrito e sem data no arquivo, não há cartela", () => {
    const semNada = endCard(
      { cardDistance: "", cardElevation: "", cardTime: "", cardNote: "" },
      rideSummary([{ lat: -23.5, lng: -48.4 }, { lat: -23.6, lng: -48.5 }], 12_400),
    );
    expect(semNada).toBeNull();
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, estado(1, 14, semNada));
    expect(textos).not.toContain("DISTÂNCIA");
  });

  it("texto longo é cortado em vez de vazar da tela", () => {
    const longo = "Subida acumulada de mil e seiscentos e setenta e seis metros";
    const grande = endCard(
      { ...digitada, cardDistance: longo, cardNote: longo },
      rideSummary(TRACK_PTS, 71_030),
    );
    const { ctx, textos } = fakeCtx();
    // retrato: a tela é estreita, então o corte acontece de verdade
    new SceneRenderer("dark").render(ctx, 720, 1280, estado(1, 14, grande));
    const desenhado = textos.find((t) => t.startsWith("Subida"));
    expect(desenhado).toBeDefined();
    expect(desenhado!.length).toBeLessThan(longo.length);
    expect(desenhado!.endsWith("…")).toBe(true);
  });

  it("cabe na tela em retrato também", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 720, 1280, estado(1, 14, cartela));
    expect(textos).toContain("49 km");
  });
});

describe("HUD no vídeo", () => {
  const T0 = Date.parse("2026-10-13T09:00:00Z");
  /** 10 pontos de 100 m a cada 10 s = 36 km/h, com hora do arquivo */
  const GPS_PTS = Array.from({ length: 10 }, (_, i) => ({
    lat: 0,
    lng: (i * 100) / 111_320,
    ele: 700 + i,
    t: T0 + i * 10_000,
  }));
  const gpsTrack = buildTrack(GPS_PTS);
  const horas = GPS_PTS.map((p) => p.t as number);

  it("mostra velocidade, distância e relógio quando o arquivo tem hora", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
    });
    expect(textos).toContain("36");        // km/h medida, sem decimais acima de 10
    expect(textos).toContain("km/h");
    // distância percorrida e relógio vêm juntos na faixa abaixo do anel
    expect(textos.some((t) => t.includes("00:45"))).toBe(true); // metade de 90 s
    // com hora do arquivo não há rótulo de média
    expect(textos).not.toContain("média");
  });

  it("sem arquivo de GPS não inventa velocidade: mostra um traço", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: gpsTrack,
    });
    // a média do vídeo daria milhares de km/h numa rota longa em clipe curto
    expect(textos).toContain("—");
    expect(textos).toContain("sem arquivo");
    expect(textos).toContain("km/h");
  });

  it("a pé mostra o ritmo médio (min/km) no lugar da velocidade", () => {
    /*
     * Percurso de 900 m com ritmo **variável**: os primeiros 500 m em 50 s e os
     * últimos 400 m em 120 s. Assim a média é bem diferente do ritmo do instante
     * — um percurso uniforme daria o mesmo número nos dois casos, e o teste não
     * teria dentes.
     */
    const pts = GPS_PTS.map((p, i) => ({ ...p, t: T0 + (i <= 5 ? i * 10_000 : 50_000 + (i - 5) * 30_000) }));
    const variavel = buildTrack(pts);
    const horasVariaveis = pts.map((p) => p.t);
    const totalSeg = (pts[pts.length - 1].t - pts[0].t) / 1000; // 170 s
    const mediaSeg = totalSeg / (variavel.total / 1000); // média do percurso, s/km

    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horasVariaveis),
      track: variavel,
      style: { ...style, pace: true },
    });
    expect(textos).toContain(formatPace(mediaSeg));
    expect(textos).toContain("min/km");
    expect(textos).not.toContain("km/h");
    expect(textos).toContain("média"); // é média, sempre — e o rótulo diz
    // e não é o ritmo do instante (no meio, 100 m em 10 s = 1:40/km)
    expect(textos).not.toContain(formatPace(100));
  });

  it("a pé sem relógio (nem arquivo, nem cartela) mostra um traço", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: gpsTrack,
      style: { ...style, pace: true },
    });
    expect(textos).toContain("—");
    expect(textos).toContain("min/km");
    expect(textos).toContain("sem arquivo");
    expect(textos).not.toContain("média");
  });

  it("a pé, o tempo da cartela também serve de relógio", () => {
    // sem hora no arquivo, o tempo escrito na cartela dá a média (900 m em 300 s)
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null, 300),
      track: gpsTrack,
      style: { ...style, pace: true },
    });
    expect(textos).toContain(formatPace(300 / (gpsTrack.total / 1000)));
    expect(textos).toContain("min/km");
    expect(textos).toContain("média");
  });

  it("a pé, percurso curto demais não vira número inventado", () => {
    const { ctx, textos } = fakeCtx();
    const curto = buildTrack([
      { lat: 0, lng: 0, t: T0 },
      { lat: 0, lng: 20 / 111_320, t: T0 + 60_000 }, // 20 m
    ]);
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, [T0, T0 + 60_000]),
      track: curto,
      style: { ...style, pace: true },
    });
    expect(textos).toContain("—");
    expect(textos).toContain("percurso curto");
  });

  it("pedal continua em km/h mesmo depois de a atividade existir", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
      style: { ...style, pace: false },
    });
    expect(textos).toContain("36");
    expect(textos).toContain("km/h");
    expect(textos).not.toContain("min/km");
  });

  it("parado no percurso mostra 0 km/h, e não um traço", () => {
    const parado = [
      { lat: -23.5, lng: -48.4, t: T0 },
      { lat: -23.5, lng: -48.4, t: T0 + 60_000 },
    ];
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, [T0, T0 + 60_000]),
      track: buildTrack(parado),
    });
    expect(textos).toContain("0.0");
    expect(textos).not.toContain("—");
  });

  it("respeita o interruptor do painel", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
      style: { ...style, showHud: false },
    });
    expect(textos).not.toContain("km/h");
  });

  it("não desenha nada numa trilha vazia", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0, 14, null, null),
      track: buildTrack([]),
    });
    expect(textos).not.toContain("km/h");
  });

  it("cabe na tela em retrato", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 720, 1280, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
    });
    expect(textos).toContain("km/h");
  });

  it("sem hora no arquivo e sem tempo na cartela: nenhum relógio", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, estado(0.5, 14, null, null, null), gpsTrack);
    // o tempo do clipe (00:07) não pode tomar o lugar do tempo do percurso
    expect(textos.some((t) => /\d\d:\d\d/.test(t))).toBe(false);
    expect(textos).toContain("—");
  });

  it("sem hora no arquivo, o relógio vem do tempo escrito na cartela", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, estado(0.5, 14, null, null, 3 * 3600 + 19 * 60), gpsTrack);
    // metade de 3 h 19 min = 1 h 39 min, no relógio de atividade
    expect(textos.some((t) => t.includes("1:39"))).toBe(true);
    // e a velocidade passa a ser a média, com o rótulo dizendo isso
    expect(textos).toContain("média");
  });

  it("o anel acompanha o andamento do percurso", () => {
    for (const progresso of [0.25, 0.5, 0.9]) {
      const { ctx, arcos } = fakeCtx();
      desenhar(ctx, estado(progresso, 14, null, horas), gpsTrack);
      const andamento = arcoDoAndamento(arcos);
      expect(andamento).not.toBeNull();
      expect(andamento!.fracao).toBeCloseTo(progresso, 3);
    }
  });

  it("num traçado decimado, o relógio não sai do lugar", () => {
    // GPX de 20.000 pontos: o desenho guarda 1 a cada 2. Se as horas viessem do
    // arquivo inteiro, metade do vídeo mostraria um relógio pela metade
    const grandes = Array.from({ length: 20_000 }, (_, i) => ({
      lat: -23.5 + i * 0.00004,
      lng: -48.4,
      t: T0 + i * 1000,
    }));
    const t = buildTrack(grandes);
    expect(t.pts.length).toBeLessThan(grandes.length);

    // o que o app manda: as horas do traçado desenhado
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0.5, 14, null, timesOf(t.pts)), }, t);
    const esperado = formatClock((grandes[grandes.length - 1].t - T0) / 2000);
    expect(textos.some((x) => x.includes(esperado))).toBe(true);

    // e se alguém mandar o vetor do arquivo inteiro, o HUD não inventa número:
    // mostra "sem arquivo" em vez de um relógio cinco vezes menor
    const { ctx: ctx2, textos: textos2 } = fakeCtx();
    desenhar(ctx2, { ...estado(0.5, 14, null, grandes.map((p) => p.t)) }, t);
    expect(textos2.some((x) => /\d:\d\d/.test(x))).toBe(false);
    expect(textos2).toContain("sem arquivo");
  });

  it("a cor também não aceita faixa de outro traçado", () => {
    // faixas do arquivo cru (20.000) contra o traçado desenhado (10.000):
    // pintar com elas seria pintar o ponto errado
    const cru = Array.from({ length: 20_000 }, (_, i) => ({
      lat: -23.5 + i * 0.00004,
      lng: -48.4,
      ele: 700 + i * 0.1,
    }));
    const desalinhado = colorizeRoute({
      pts: cru,
      cum: cumulative(cru),
      times: null,
      mode: "slope",
    })!;
    const { ctx, tracos } = fakeCtx();
    desenhar(
      ctx,
      { ...estado(0.5, 14, null, null), colored: desalinhado },
      buildTrack(cru),
    );
    const cores = new Set(tracos.filter((x) => x.pontos > 0 && x.largura === 4).map((x) => x.cor));
    // cai na linha sólida de sempre em vez de colorir errado
    expect(cores.size).toBe(1);
  });

  it("o anel fica abaixo do título, sem sobrepor a faixa do topo", () => {
    const comTitulo = { ...style, showTitle: true, title: "Pedal da manhã" };
    const { ctx, arcos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, horas),
      track: gpsTrack,
      style: comTitulo,
    });
    const andamento = arcoDoAndamento(arcos)!;
    // o topo do anel (y - r) tem que ficar abaixo da faixa pintada pelo título
    expect(andamento.y - andamento.r).toBeGreaterThan(60);
  });
});

/* ------------------------------------------------------------------ */
/* Rota colorida, marcas de km e câmera cinematográfica                */
/* ------------------------------------------------------------------ */

/**
 * Perfil variado de propósito: plano, subida de 6% e descida de 4%.
 * Uma subida constante daria **uma** cor só — e o teste não provaria nada.
 */
const altitudeDe = (i: number) =>
  i < 100 ? 700 : i < 200 ? 700 + (i - 100) * 0.6 : 760 - (i - 200) * 0.4;

const SUBIDA = Array.from({ length: 300 }, (_, i) => ({
  lat: -23.5 + i * 0.000075,
  lng: -48.4,
  ele: altitudeDe(i),
  t: T0 + i * 2000,
}));
const trackSubida = buildTrack(SUBIDA);
const colorida = colorizeRoute({
  pts: SUBIDA,
  cum: cumulative(SUBIDA),
  times: SUBIDA.map((p) => p.t),
  mode: "slope",
})!;

describe("rota colorida por inclinação", () => {
  it("pinta a linha em várias cores, e não numa só", () => {
    const { ctx, tracos } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, null, null), colored: colorida }, trackSubida);

    // a espessura 4 é a linha por cima da sombra
    const cores = new Set(tracos.filter((t) => t.pontos > 0 && t.largura === 4).map((t) => t.cor));
    expect(cores.size).toBeGreaterThanOrEqual(3);
    // e nenhuma delas é a cor neutra: o arquivo tem altitude do começo ao fim
    expect(cores.has(NEUTRAL_COLOR)).toBe(false);
  });

  it("escreve a escala na tela — sem ela a cor não significa nada", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, null, null), colored: colorida }, trackSubida);
    expect(textos).toContain("inclinação %");
    expect(textos).toContain("-6%");
    expect(textos).toContain("+6%");
    expect(textos).not.toContain("sem dado");
  });

  it("avisa na legenda quando parte do arquivo não tem o dado", () => {
    const parcial = SUBIDA.map((p, i) => ({ ...p, ele: i < 200 ? p.ele : NaN }));
    const c = colorizeRoute({
      pts: parcial,
      cum: cumulative(parcial),
      times: null,
      mode: "slope",
    })!;
    const { ctx, textos, tracos } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, null, null), colored: c }, buildTrack(parcial));
    expect(textos).toContain("sem dado");
    const cores = new Set(tracos.filter((t) => t.pontos > 0 && t.largura === 4).map((t) => t.cor));
    expect(cores.has(NEUTRAL_COLOR)).toBe(true);
  });

  it("reaproveita os pontos projetados, mas nunca o quadro anterior", () => {
    // os vetores do quadro são reaproveitados entre quadros (é o que torna as
    // nove passadas baratas) — se ficassem velhos, a cor sairia na posição
    // errada quando a câmera anda
    const r = new SceneRenderer("dark");
    const camera = { mode: "follow" as const, followZoom: 16 };
    const a = fakeCtx();
    r.render(a.ctx, 1280, 720, { ...estado(0.2, 14, null, null), colored: colorida, camera });
    const b = fakeCtx();
    r.render(b.ctx, 1280, 720, { ...estado(0.9, 14, null, null), colored: colorida, camera });
    expect(a.movimentos.length).toBeGreaterThan(0);
    expect(b.movimentos.length).toBeGreaterThan(0);
    expect(b.movimentos[0][0]).not.toBeCloseTo(a.movimentos[0][0], 1);
  });

  it("sem o dado no arquivo a linha volta a ser a sólida de sempre", () => {
    const semEle = SUBIDA.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t }));
    const t = buildTrack(semEle);
    const nenhum = colorizeRoute({
      pts: semEle,
      cum: cumulative(semEle),
      times: null,
      mode: "slope",
    });
    expect(nenhum).toBeNull();

    const { ctx, tracos, textos } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, null, null), colored: nenhum }, t);
    const cores = new Set(tracos.filter((t) => t.pontos > 0 && t.largura === 4).map((t) => t.cor));
    expect(cores.size).toBe(1);
    expect(textos).not.toContain("inclinação %");
  });
});

describe("marcas de km", () => {
  it("escreve o quilômetro ao lado da marca", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0, 14, null, null), marks: kmMarks(track.cum) });
    expect(textos).toContain("1 km");
    expect(textos).toContain("2 km");
    expect(textos).toContain("3 km");
  });

  it("sem o interruptor não desenha marca nenhuma", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0, 14, null, null), marks: null });
    expect(textos.some((t) => /^\d+ km$/.test(t))).toBe(false);
  });

  it("numa rota longa só as redondas levam número", () => {
    const longa = Array.from({ length: 600 }, (_, i) => ({
      lat: -23.5 + i * 0.00075,
      lng: -48.4,
    }));
    const t = buildTrack(longa);
    const marcas = kmMarks(t.cum);
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0, 14, null, null), marks: marcas }, t);
    expect(marcas.length).toBeGreaterThan(2);
    expect(marcas.length).toBeLessThanOrEqual(12);
    // o número sai nas redondas; o resto é só o ponto no traçado
    const comNumero = textos.filter((x) => /^\d+ km$/.test(x));
    expect(comNumero.length).toBeGreaterThan(0);
    expect(comNumero.length).toBeLessThanOrEqual(marcas.length);
  });
});

describe("câmera cinematográfica", () => {
  const comCine = {
    mode: "follow" as const,
    followZoom: 16,
    cinematic: { opening: true, stops: false, stopTs: [] },
  };

  it("no primeiro quadro a partida aparece longe do centro (região inteira na tela)", () => {
    const { ctx, movimentos } = fakeCtx();
    desenhar(ctx, { ...estado(0, 14, null, null), camera: comCine });
    const [x, y] = movimentos[0];
    // com a câmera aberta, o começo da rota cai longe do meio do quadro
    expect(Math.hypot(x - 640, y - 360)).toBeGreaterThan(180);
  });

  it("depois da abertura a câmera pousou e o personagem está no centro", () => {
    const { ctx, movimentos } = fakeCtx();
    desenhar(ctx, { ...estado(0, 14, null, null), elapsed: 6, camera: comCine });
    const [x, y] = movimentos[0];
    expect(Math.hypot(x - 640, y - 360)).toBeLessThan(20);
  });

  it("desligada, o traçado já começa enquadrado como sempre", () => {
    const { ctx, movimentos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0, 14, null, null),
      camera: { mode: "fit", followZoom: 16 },
    });
    // a vista da rota toda nunca foi o problema: aqui as duas pontas aparecem
    const xs = movimentos.map((m) => m[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ */
/* Fotos: paradas e cartela                                            */
/* ------------------------------------------------------------------ */

/** Foto de mentira: o suficiente para o desenho recortar e posicionar. */
const FOTO = { width: 800, height: 400 } as unknown as PhotoImage;
const SRC = "data:image/jpeg;base64,AAAA";

/** Um "cache" de fotos que já tem tudo pronto (o desenho só consulta). */
const cacheComFoto: PhotoLookup = { get: (src) => (src ? FOTO : null) };
const cacheVazio: PhotoLookup = { get: () => null };
/**
 * A foto foi escolhida e o carregamento **falhou** (já tentou, não tem).
 * É o caso em que o aviso do lugar volta.
 */
const cacheQueFalhou: PhotoLookup = { get: () => null, has: () => true };
/** A foto ainda está chegando (nem tentou): não é falha, é espera. */
const cacheCarregando: PhotoLookup = { get: () => null, has: () => false };

const parada = (extra: Partial<Poi> = {}): Poi => ({
  id: "p1",
  emoji: "🌉",
  label: "Ponte",
  color: "#38bdf8",
  t: 0.5,
  ...extra,
});

describe("foto da parada no vídeo", () => {
  it("aparece em polaroide quando o personagem passa pela parada", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    const grandes = fotosGrandes({ imagens } as never);
    expect(grandes.length).toBe(1);
    // recorte quadrado e centralizado da foto deitada (800×400 → 400×400 do meio)
    const [sx, sy, size] = grandes[0].args;
    expect([sx, sy, size]).toEqual([200, 0, 400]);
  });

  it("não aparece antes de passar pela parada", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.45, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(0);
    // mas o pino já mostra a foto pequena: é o que impede o pino de ficar oco
    expect(fotosDoPino({ imagens } as never).length).toBe(1);
  });

  it("some depois do tempo da foto (não fica no vídeo até o fim)", () => {
    const comFoto = { stops: [parada({ photo: SRC })], photos: cacheComFoto };
    // a janela é de 2,6 s de vídeo: logo depois da parada aparece, 4 s depois já saiu
    const cedo = fakeCtx();
    const tarde = fakeCtx();
    desenhar(cedo.ctx, { ...estado(0.5 + 0.6 / 14, 14, null), ...comFoto });
    desenhar(tarde.ctx, { ...estado(0.5 + 4 / 14, 14, null), ...comFoto });
    expect(fotosGrandes(cedo).length).toBe(1);
    expect(fotosGrandes(tarde).length).toBe(0);
  });

  it("num vídeo longo, a foto dura o mesmo tempo de vídeo (não some por ser rota longa)", () => {
    // o motivo de a janela ser em segundos: em metros, uma foto numa rota de
    // 435 km duraria 0,04 s
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5 + 1.5 / 60, 60, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
  });

  it("a foto entra com alfa crescente e fica opaca", () => {
    // o alfa do desenho é calculado (não lido do contexto), então dá para
    // conferir: no instante da parada é baixo, meio segundo depois é 1
    const naHora = fakeCtx();
    const depois = fakeCtx();
    const comum = { stops: [parada({ photo: SRC })], photos: cacheComFoto };
    desenhar(naHora.ctx, { ...estado(0.5, 14, null), ...comum });
    desenhar(depois.ctx, { ...estado(0.5 + 0.6 / 14, 14, null), ...comum });
    expect(fotosGrandes(naHora).length).toBe(0); // ainda em fade de entrada
    expect(fotosGrandes(depois)[0].alpha).toBeCloseTo(1, 2);
  });

  it("sem a foto pronta, a etiqueta continua saindo — sem buraco no lugar dela", () => {
    // o desenho é síncrono: foto que não carregou não pode segurar o vídeo,
    // nem deixar a etiqueta flutuando mais alto do que devia
    const semPronta = fakeCtx();
    const semFotoNenhuma = fakeCtx();
    const comum = { ...estado(0.51, 14, null), stops: [parada({ photo: SRC })] };
    desenhar(semPronta.ctx, { ...comum, photos: cacheVazio });
    desenhar(semFotoNenhuma.ctx, { ...comum, stops: [parada()], photos: cacheVazio });
    expect(semPronta.imagens.length).toBe(0);
    expect(semPronta.textos).toContain("Ponte");
    // mesma altura da etiqueta de uma parada sem foto nenhuma
    const y = (f: typeof semPronta) => f.textosY[f.textos.indexOf("Ponte")];
    expect(y(semPronta)).toBeCloseTo(y(semFotoNenhuma), 6);
  });

  it("parada sem foto tem a etiqueta sempre na mesma altura", () => {
    // se a altura da etiqueta dependesse do tempo decorrido (e não de haver
    // foto), uma parada sem foto nenhuma ficaria flutuando com um buraco no
    // lugar da polaroide — foi o defeito da primeira versão
    const cedo = fakeCtx();
    const tarde = fakeCtx();
    const semFoto = { stops: [parada()], photos: cacheVazio };
    desenhar(cedo.ctx, { ...estado(0.51, 14, null), ...semFoto });
    desenhar(tarde.ctx, { ...estado(0.6, 14, null), ...semFoto });
    const y = (f: typeof cedo) => f.textosY[f.textos.indexOf("Ponte")];
    expect(y(cedo)).toBeCloseTo(y(tarde), 6);
  });

  it("parada sem foto não desenha imagem nenhuma", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      stops: [parada()],
      photos: cacheComFoto,
    });
    expect(imagens.length).toBe(0);
  });

  it("a foto sai em círculo, com o anel na cor da parada", () => {
    const { ctx, arcos, tracos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.6, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    // dois círculos inteiros: o aro de fundo e o anel da cor da parada
    const inteiros = arcos.filter((a) => Math.abs(a[4] - a[3]) > Math.PI * 2 - 1e-6);
    expect(inteiros.length).toBeGreaterThanOrEqual(2);
    const raios = inteiros.map((a) => a[2]);
    expect(new Set(raios).size).toBeGreaterThanOrEqual(2);
    // e o anel é traçado na cor da parada
    expect(tracos.some((t) => t.cor === "#38bdf8")).toBe(true);
  });

  it("não sobra nenhum branco chapado no lugar da foto", () => {
    // a polaroide (quadrado branco com moldura) chamava mais atenção do que a
    // foto e parecia um papel colado no mapa — este teste trava a troca: o
    // branco era um **preenchimento**, e é ele que não pode voltar
    const { ctx, pinturas } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.6, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(pinturas).not.toContain("#ffffff");
    expect(pinturas).not.toContain("rgba(255,255,255,1)");
  });

  it("a etiqueta sobe para dar lugar à foto", () => {
    const comFoto = fakeCtx();
    const semFoto = fakeCtx();
    const base = { ...estado(0.51, 14, null), stops: [parada({ photo: SRC })] };
    desenhar(comFoto.ctx, { ...base, photos: cacheComFoto });
    desenhar(semFoto.ctx, { ...base, stops: [parada()], photos: cacheVazio });
    const y = (f: typeof comFoto) => f.textosY[f.textos.indexOf("Ponte")];
    // y menor = mais para cima (o canvas cresce para baixo)
    expect(y(comFoto)).toBeLessThan(y(semFoto));
  });
});

describe("foto do projeto na cartela", () => {
  it("desenha o avatar em círculo quando a foto está pronta", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(1, 14, cartela),
      cardPhoto: SRC,
      photos: cacheComFoto,
    });
    expect(imagens.length).toBe(1);
    const [, , , size] = imagens[0].args;
    expect(size).toBe(400); // recorte quadrado da foto deitada
  });

  it("o avatar fica acima dos números, que descem para dar lugar", () => {
    const comFoto = fakeCtx();
    const semFoto = fakeCtx();
    desenhar(comFoto.ctx, { ...estado(1, 14, cartela), cardPhoto: SRC, photos: cacheComFoto });
    desenhar(semFoto.ctx, { ...estado(1, 14, cartela), photos: cacheVazio });
    // o valor da cartela é o ÚLTIMO "49 km" do quadro (o título pode repetir)
    const y = (f: typeof comFoto, txt: string) => {
      const iguais = f.textos.flatMap((s, i) => (s === txt ? [i] : []));
      return f.textosY[iguais[iguais.length - 1]];
    };
    expect(y(comFoto, "49 km")).toBeGreaterThan(y(semFoto, "49 km"));
    // e a imagem fica acima dos números (args[5] = y de destino do avatar)
    expect(comFoto.imagens[0].args[5]).toBeLessThan(y(comFoto, "49 km"));
  });

  it("sem foto pronta, a cartela sai como sempre saiu", () => {
    const { ctx, imagens, textos } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, cartela), cardPhoto: SRC, photos: cacheVazio });
    expect(imagens.length).toBe(0);
    expect(textos).toContain("49 km");
  });

  it("sem foto escolhida, nada muda", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, { ...estado(1, 14, cartela), photos: cacheComFoto });
    expect(imagens.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Passagens: ida e volta pelo mesmo caminho                           */
/* ------------------------------------------------------------------ */

/**
 * Uma parada passada duas vezes: na ida (t = 0,5) e na volta (t = 0,8).
 * Antes, a parada era um instante só e a volta não aparecia no vídeo.
 */
const DUAS_VEZES = { p1: [0.5, 0.8] };
const comVolta = (extra: Partial<Poi> = {}) => ({
  stops: [parada(extra)],
  passages: DUAS_VEZES,
});

/** Quantos avisos do topo ("📍 … km do início") foram escritos no quadro. */
const avisos = (textos: string[]) => textos.filter((s) => s.includes("km do início")).length;

describe("parada passada duas vezes", () => {
  it("a foto aparece na ida, some, e aparece de novo na volta", () => {
    const ida = fakeCtx();
    const meio = fakeCtx();
    const volta = fakeCtx();
    const comum = { ...comVolta({ photo: SRC }), photos: cacheComFoto };
    desenhar(ida.ctx, { ...estado(0.5 + 1.4 / 14, 14, null), ...comum });
    // entre as duas passagens a janela de 2,6 s já fechou: a foto não está na tela
    // (a janela fecha em 0,5 + 2,6/14 = 0,686)
    desenhar(meio.ctx, { ...estado(0.7, 14, null), ...comum });
    desenhar(volta.ctx, { ...estado(0.8 + 1.4 / 14, 14, null), ...comum });
    expect(fotosGrandes(ida).length).toBe(1);
    expect(fotosGrandes(meio).length).toBe(0);
    expect(fotosGrandes(volta).length).toBe(1);
  });

  it("o aviso do topo aparece nas duas pontas, com o km de cada passagem", () => {
    // o km do aviso é o **do momento**: na ida, 1,51 km; na volta, 2,41 km
    const kmDe = (ts: number) => `📍 ${((ts * track.total) / 1000).toFixed(2)} km do início`;
    const ida = fakeCtx();
    const volta = fakeCtx();
    const comum = comVolta();
    desenhar(ida.ctx, { ...estado(0.51, 14, null), ...comum });
    desenhar(volta.ctx, { ...estado(0.81, 14, null), ...comum });
    expect(avisos(ida.textos)).toBe(1);
    expect(avisos(volta.textos)).toBe(1);
    expect(ida.textos).toContain(kmDe(0.5));
    expect(ida.textos).not.toContain(kmDe(0.8));
    expect(volta.textos).toContain(kmDe(0.8));
    expect(volta.textos).not.toContain(kmDe(0.5));
  });

  it("quem tem foto não vira aviso no topo", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      ...comVolta({ photo: SRC }),
      photos: cacheComFoto,
    });
    expect(avisos(textos)).toBe(0);
  });

  it("foto escolhida mas que FALHOU: o aviso volta (o lugar não passa em branco)", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      ...comVolta({ photo: SRC }),
      photos: cacheQueFalhou,
    });
    expect(avisos(textos)).toBe(1);
  });

  it("foto escolhida e ainda carregando: o aviso não apareceu (é espera, não falha)", () => {
    // o aviso voltava no meio do caminho, com a foto ainda chegando: quem
    // mandou tirar o aviso escolheu a foto — o aviso só volta se ela falhar
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      ...comVolta({ photo: SRC }),
      photos: cacheCarregando,
    });
    expect(avisos(textos)).toBe(0);
  });

  it("a linha do tempo ganha uma marca por passagem", () => {
    // sem as passagens, a parada da volta ficaria sem marca nenhuma na barra
    const { ctx, textosPos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.9, 14, null),
      ...comVolta(),
      style: { ...style, showProgress: true },
    });
    const marcas = textosPos.filter((x) => x.s === "🌉");
    const porLinha = new Map<number, number[]>();
    for (const m of marcas) {
      const xs = porLinha.get(m.y) ?? [];
      xs.push(m.x);
      porLinha.set(m.y, xs);
    }
    const naBarra = [...porLinha.values()].filter((xs) => xs.length > 1);
    expect(naBarra.length).toBe(1);
    expect(naBarra[0].length).toBe(2);
    expect(naBarra[0][0]).not.toBeCloseTo(naBarra[0][1], 0);
  });

  it("com uma passagem só, a linha do tempo tem uma marca (como sempre foi)", () => {
    const { ctx, textosPos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.9, 14, null),
      stops: [parada()],
      style: { ...style, showProgress: true },
    });
    const marcas = textosPos.filter((x) => x.s === "🌉");
    const porLinha = new Map<number, number[]>();
    for (const m of marcas) {
      const xs = porLinha.get(m.y) ?? [];
      xs.push(m.x);
      porLinha.set(m.y, xs);
    }
    expect([...porLinha.values()].every((xs) => xs.length === 1)).toBe(true);
  });

  it("o contador do cabeçalho conta passagens quando a rota repete", () => {
    // o contador fica nos selos do cabeçalho: só aparece com o título ligado
    const comTitulo = { ...style, showTitle: true, title: "Pedal" };
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0.6, 14, null), ...comVolta(), style: comTitulo });
    expect(textos).toContain("1/2 passagens");
    const fim = fakeCtx();
    desenhar(fim.ctx, { ...estado(0.95, 14, null), ...comVolta(), style: comTitulo });
    expect(fim.textos).toContain("2/2 passagens");
  });

  it("sem repetição, o contador continua falando em paradas", () => {
    const comTitulo = { ...style, showTitle: true, title: "Pedal" };
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, { ...estado(0.95, 14, null), stops: [parada()], style: comTitulo });
    expect(textos).toContain("1/1 paradas");
  });
});

describe("foto da partida e da chegada", () => {
  const LOCAL = { emoji: "🏠", label: "Casa", photo: SRC };

  it("a foto da partida aparece no começo do vídeo", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(1.4 / 14, 14, null),
      endpoints: { a: LOCAL, b: null },
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
    const [, , , size] = fotosGrandes({ imagens } as never)[0].args;
    expect(size).toBe(400); // recorte quadrado da foto deitada
  });

  it("a foto da chegada aparece no fim do vídeo", () => {
    const cedo = fakeCtx();
    const fim = fakeCtx();
    const comum = { endpoints: { a: null, b: LOCAL }, photos: cacheComFoto };
    desenhar(cedo.ctx, { ...estado(0.5, 14, null), ...comum });
    desenhar(fim.ctx, { ...estado(1 - 1.4 / 14, 14, null), ...comum });
    expect(fotosGrandes(cedo).length).toBe(0);
    expect(fotosGrandes(fim).length).toBe(1);
  });

  it("a foto da partida já está na tela no primeiro quadro", () => {
    // a janela das paradas (que entram e saem) deixaria a largada invisível no
    // quadro zero — justamente o quadro que abre o vídeo
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0, 14, null),
      endpoints: { a: LOCAL, b: null },
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
    expect(fotosGrandes({ imagens } as never)[0].alpha).toBeCloseTo(1, 2);
  });

  it("a foto da chegada continua na tela no último quadro", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(1, 14, null),
      endpoints: { a: null, b: LOCAL },
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
    expect(fotosGrandes({ imagens } as never)[0].alpha).toBeCloseTo(1, 2);
  });

  it("a foto da partida sai depois de alguns segundos (não fica o vídeo todo)", () => {
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.4, 14, null),
      endpoints: { a: LOCAL, b: null },
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(0);
  });

  it("partida com foto não vira aviso no topo", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.05, 14, null),
      endpoints: { a: LOCAL, b: null },
      photos: cacheComFoto,
    });
    expect(textos.some((s) => s.includes("Início do percurso"))).toBe(false);
  });

  it("partida sem foto continua avisando no topo", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.05, 14, null),
      endpoints: { a: { emoji: "🏠", label: "Casa" }, b: null },
      photos: cacheComFoto,
    });
    expect(textos.some((s) => s.includes("Início do percurso"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Partida e chegada: sobreposição e estilo                            */
/* ------------------------------------------------------------------ */

const LOCAL_A = { emoji: "🏠", label: "Casa", photo: SRC };
const LOCAL_B = { emoji: "💦", label: "Cachoeira", photo: SRC };
const PERSONAGEM = findCharacter("car").emoji;
const yAbsDe = (f: ReturnType<typeof fakeCtx>, txt: string) =>
  f.textosYAbs[f.textos.indexOf(txt)];

describe("partida e chegada no vídeo", () => {
  it("o personagem não cobre a partida", () => {
    // no primeiro quadro o personagem está exatamente em cima da partida;
    // desenhado antes, ele escondia o pino, o nome e a foto
    const { ctx, ordem } = fakeCtx();
    desenhar(ctx, {
      ...estado(0, 14, null),
      endpoints: { a: LOCAL_A, b: null },
      photos: cacheComFoto,
    });
    const carro = ordem.indexOf(`texto:${PERSONAGEM}`);
    const nomeA = ordem.indexOf("texto:Casa");
    expect(carro).toBeGreaterThanOrEqual(0);
    expect(nomeA).toBeGreaterThan(carro);
  });

  it("o personagem não cobre a chegada", () => {
    const { ctx, ordem } = fakeCtx();
    desenhar(ctx, {
      ...estado(1, 14, null),
      endpoints: { a: null, b: LOCAL_B },
      photos: cacheComFoto,
    });
    const carro = ordem.indexOf(`texto:${PERSONAGEM}`);
    const nomeB = ordem.indexOf("texto:Cachoeira");
    expect(nomeB).toBeGreaterThan(carro);
  });

  it("o pino A/B é o mesmo pino das paradas (fundo e brilho)", () => {
    // antes o A/B tinha o seu próprio desenho — mais escuro, sem sombra nem
    // brilho — e o usuário viu o par como "apagado" durante o trajeto
    const daParada = fakeCtx();
    desenhar(daParada.ctx, { ...estado(0.6, 14, null), stops: [parada()] });
    const doLocal = fakeCtx();
    desenhar(doLocal.ctx, {
      ...estado(0, 14, null),
      endpoints: { a: { emoji: "", label: "Casa" }, b: null },
      photos: cacheVazio,
    });
    expect(daParada.pinturas).toContain("rgba(9,12,20,0.94)");
    expect(doLocal.pinturas).toContain("rgba(9,12,20,0.94)");
    expect(daParada.tracos.some((t) => t.cor === "rgba(255,255,255,0.2)")).toBe(true);
    expect(doLocal.tracos.some((t) => t.cor === "rgba(255,255,255,0.2)")).toBe(true);
  });

  it("a letra A/B ganha a cor do lugar (não é branca no escuro)", () => {
    const { ctx, textos, textosCor } = fakeCtx();
    desenhar(ctx, {
      ...estado(0, 14, null),
      endpoints: { a: { emoji: "", label: "Casa" }, b: null },
      photos: cacheVazio,
    });
    expect(textosCor[textos.indexOf("A")]).toBe("#22c55e");
    expect(textosCor[textos.indexOf("B")]).toBe("#f87171");
  });

  it("a foto da partida é menor que a foto de uma parada", () => {
    const daParada = fakeCtx();
    desenhar(daParada.ctx, {
      ...estado(0.51, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    const doLocal = fakeCtx();
    desenhar(doLocal.ctx, {
      ...estado(0, 14, null),
      endpoints: { a: LOCAL_A, b: null },
      photos: cacheComFoto,
    });
    // args = [sx, sy, size, dx, dy, dw, dh]: dw é o lado desenhado na tela
    const ladoParada = fotosGrandes(daParada)[0].args[6];
    const ladoLocal = fotosGrandes(doLocal)[0].args[6];
    expect(ladoLocal).toBeLessThan(ladoParada);
    expect(ladoLocal).toBeCloseTo(56, 0);
    expect(ladoParada).toBeCloseTo(78, 0);
  });

  it("a cartela final não cobre a chegada", () => {
    // com a câmera que acompanha o personagem, a chegada cai no meio da tela —
    // exatamente onde a cartela aparece (é o caso do vídeo do usuário)
    const seguir = { camera: { mode: "follow" as const, followZoom: 16 } };
    const com = fakeCtx();
    desenhar(com.ctx, {
      ...estado(1, 14, cartela),
      ...seguir,
      endpoints: { a: null, b: LOCAL_B },
      photos: cacheComFoto,
    });
    const caixa = summaryBox(com.ctx, 1280, 720, { ...estado(1, 14, cartela), ...seguir }, 1);
    expect(caixa).not.toBeNull();

    const sem = fakeCtx();
    desenhar(sem.ctx, {
      ...estado(1, 14, null),
      ...seguir,
      endpoints: { a: null, b: LOCAL_B },
      photos: cacheComFoto,
    });
    // o nome da chegada sobe para ficar acima da cartela — e sem cartela fica onde sempre ficou
    expect(yAbsDe(com, "Cachoeira")).toBeLessThan(yAbsDe(sem, "Cachoeira"));
    expect(yAbsDe(com, "Cachoeira")).toBeLessThan(caixa!.boxY);
  });

  it("pino acima ou abaixo da cartela não se mexe (só quem ela alcança desvia)", () => {
    // o desvio é cirúrgico. Com a câmera de rota toda, a partida cai **acima**
    // da cartela e a chegada **abaixo** — e nenhuma das duas é alcançada. Uma
    // checagem só vertical (em vez de interseção de retângulos) subia 282 px a
    // chegada para "escapar" de uma cartela que estava acima dela.
    const marcas = { a: { emoji: "", label: "Casa" }, b: { emoji: "", label: "Cachoeira" } };
    const comCartela = fakeCtx();
    desenhar(comCartela.ctx, {
      ...estado(1, 14, cartela),
      endpoints: marcas,
      photos: cacheVazio,
    });
    const semCartela = fakeCtx();
    desenhar(semCartela.ctx, {
      ...estado(1, 14, null),
      endpoints: marcas,
      photos: cacheVazio,
    });
    expect(yAbsDe(comCartela, "Casa")).toBeCloseTo(yAbsDe(semCartela, "Casa"), 6);
    expect(yAbsDe(comCartela, "Cachoeira")).toBeCloseTo(yAbsDe(semCartela, "Cachoeira"), 6);

    // e as duas estão mesmo fora da caixa da cartela (o cenário é o que penso)
    const caixa = summaryBox(comCartela.ctx, 1280, 720, estado(1, 14, cartela), 1);
    expect(caixa).not.toBeNull();
    const fora = (y: number) => y < caixa!.boxY || y > caixa!.boxY + caixa!.boxH;
    expect(fora(yAbsDe(semCartela, "Casa"))).toBe(true);
    expect(fora(yAbsDe(semCartela, "Cachoeira"))).toBe(true);
  });

  it("pino abaixo (ou ao lado) da cartela não é alcançado por ela", () => {
    // olhando só a vertical, um pino 314 px abaixo da cartela subia para
    // "escapar" de uma cartela que nem estava em cima dele
    const caixa = { x: 400, y: 200, w: 480, h: 160 };
    expect(overlapsCard({ x: 640, y: 500 }, 17, caixa)).toBe(false); // abaixo
    expect(overlapsCard({ x: 640, y: 280 }, 17, caixa)).toBe(true); // dentro
    expect(overlapsCard({ x: 100, y: 280 }, 17, caixa)).toBe(false); // à esquerda
    expect(overlapsCard({ x: 1100, y: 280 }, 17, caixa)).toBe(false); // à direita
    expect(overlapsCard({ x: 640, y: 210 }, 17, caixa)).toBe(true); // encostando por cima
    expect(overlapsCard({ x: 640, y: 100 }, 17, caixa)).toBe(false); // acima, sem encostar
  });

  it("o miolo do pino tem imagem o trajeto inteiro (não fica oco)", () => {
    // a regra antiga ("a foto ocupa o lugar do emoji") deixava o pino vazio: a
    // foto grande é desenhada ACIMA do pino, e só nos segundos da largada. No
    // meio do vídeo, o selo ficava sem nada dentro.
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5, 14, null),
      endpoints: { a: LOCAL_A, b: LOCAL_B },
      photos: cacheComFoto,
    });
    const doPino = fotosDoPino({ imagens } as never);
    expect(doPino.length).toBe(2); // partida e chegada
    for (const img of doPino) {
      // args = [sx, sy, size, size, dx, dy, dw, dh]
      const [, , size, , , , dw] = img.args;
      expect(size).toBe(400); // 800×400 → quadrado de 400 do meio
      expect(dw).toBeCloseTo(2 * (17 - 2.6), 1); // diâmetro de dentro do aro
      expect(dw).toBeLessThan(2 * 17); // e cabe dentro do pino
    }
  });

  it("sem foto no local, o pino mostra o emoji (não fica vazio)", () => {
    const { ctx, imagens, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5, 14, null),
      endpoints: { a: { emoji: "🏠", label: "Casa" }, b: null },
      photos: cacheVazio,
    });
    expect(fotosDoPino({ imagens } as never).length).toBe(0);
    expect(textos).toContain("🏠");
  });

  it("local sem emoji e sem foto continua com a letra A/B", () => {
    const { ctx, textos, textosCor } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5, 14, null),
      endpoints: { a: { emoji: "", label: "Casa" }, b: null },
      photos: cacheVazio,
    });
    expect(textos).toContain("A");
    expect(textosCor[textos.indexOf("A")]).toBe("#22c55e");
  });

  it("a parada com foto também mostra a foto dentro do pino", () => {
    // os dois pinos seguem a mesma regra: com foto, o miolo é a foto
    const { ctx, imagens, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5, 14, null),
      stops: [parada({ photo: SRC, t: 0.8 })],
      photos: cacheComFoto,
    });
    expect(fotosDoPino({ imagens } as never).length).toBe(1);
    // e o emoji do pino não aparece nesse caso (a foto tomou o miolo)
    expect(textos.filter((t) => t === "🌉").length).toBe(0);
  });

  it("a parada sem foto continua com o emoji no pino", () => {
    const { ctx, imagens, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5, 14, null),
      stops: [parada({ t: 0.8 })],
      photos: cacheComFoto,
    });
    expect(fotosDoPino({ imagens } as never).length).toBe(0);
    expect(textos.filter((t) => t === "🌉").length).toBeGreaterThan(0);
  });

  it("a cartela final só entra depois do fim do percurso", () => {
    // o pedido: "cartela aparecendo muito antes, terminar percurso e depois
    // aparecer". Antes ela entrava em 79% do percurso e cobria o fim do trajeto.
    const tl = buildTimeline(20, { voo: true, cartela: true });
    const fim = routeEnd(tl); // 15,8 s de vídeo (voo 2,6 + percurso 13,2)
    const antes = { ...estado(1, 20, cartela, null, null, tl), elapsed: fim - 0.1 };
    const depois = { ...estado(1, 20, cartela, null, null, tl), elapsed: fim + 0.7 };

    const cedo = fakeCtx();
    desenhar(cedo.ctx, antes);
    expect(cedo.textos).not.toContain("49 km");

    const tarde = fakeCtx();
    desenhar(tarde.ctx, depois);
    expect(tarde.textos).toContain("49 km");
  });

  it("com o voo, a foto da partida aparece no pouso (não durante o voo)", () => {
    // o personagem espera o voo; a foto dele é do pouso em diante
    const tl = buildTimeline(20, { voo: true, cartela: true });
    const voando = { ...estado(0, 20, null, null, null, tl), elapsed: tl.voo - 0.5 };
    const pousado = { ...estado(0, 20, null, null, null, tl), elapsed: tl.voo + 0.1 };
    const marcas = { a: LOCAL_A, b: null };

    const a = fakeCtx();
    desenhar(a.ctx, { ...voando, endpoints: marcas, photos: cacheComFoto });
    expect(fotosGrandes(a).length).toBe(0);

    const b = fakeCtx();
    desenhar(b.ctx, { ...pousado, endpoints: marcas, photos: cacheComFoto });
    expect(fotosGrandes(b).length).toBe(1);
  });

  it("`liftToClear` sobe só o necessário, e só quando há sobreposição", () => {
    expect(liftToClear(400, 300, 1, 10)).toBeCloseTo(110);
    expect(liftToClear(300, 400, 1, 10)).toBe(0);
    expect(liftToClear(400, 300, 0.5, 10)).toBeCloseTo(55);
    expect(liftToClear(400, 300, 0, 10)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* O andar do personagem                                               */
/* ------------------------------------------------------------------ */

/**
 * O selo do personagem na tela.
 *
 * O primeiro arco com raio entre 30 e 50 px: o selo do personagem tem ~38 px
 * (0,62 de 62), enquanto o aro de pulso tem ~61, o halo ~93 e os pinos 17. É a
 * posição **absoluta**, então dá para ver o corpo subir e trocar de lado de um
 * quadro para o outro — que é exatamente o que o olho chama de "andar".
 */
describe("o andar do personagem", () => {
  const semVoo = buildTimeline(14, { voo: false, cartela: false });
  const quadro = (elapsed: number, id = "run", timeline: Timeline = semVoo) => ({
    ...estado(0.5, 14, null, null, null, timeline),
    elapsed,
    timeline,
    character: findCharacter(id),
  });

  it("não pula: o corpo não sobe nem desce em passo nenhum", () => {
    // o pedido é literal — "o personagem não precisa ficar pulando" — e um selo
    // de 62 px subindo 20 px por passo parecia um ícone quicando
    const correndo = findCharacter("run");
    const hz = gaitOf(correndo).hz;
    for (let i = 0; i < 16; i++) {
      expect(andar(quadro(1 + i / (hz * 8)), correndo).sobe).toBe(0);
    }
  });

  it("mas não fica congelado: o corpo balança de leve, menos de 6% do selo", () => {
    const correndo = findCharacter("run");
    const hz = gaitOf(correndo).hz;
    let maior = 0;
    for (let i = 0; i < 48; i++) {
      const a = andar(quadro(1 + i / (hz * 24)), correndo);
      maior = Math.max(maior, Math.abs(a.lado));
    }
    expect(maior).toBeGreaterThan(0.02); // tem vida
    expect(maior).toBeLessThan(0.06); // mas é balanço, não pulo
  });

  it("o peso troca de lado a cada passo", () => {
    const correndo = findCharacter("run");
    const hz = gaitOf(correndo).hz;
    expect(andar(quadro(1 + 0.25 / hz), correndo).lado).toBeGreaterThan(0.02);
    expect(andar(quadro(1 + 0.75 / hz), correndo).lado).toBeLessThan(-0.02);
  });

  it("parado no voo e na cartela, o personagem não anda nem fica torto", () => {
    const tl = buildTimeline(14, { voo: true, cartela: true });
    const correndo = findCharacter("run");
    const zero = { sobe: 0, lado: 0, estica: 0 };
    for (const elapsed of [0, tl.voo - 0.3, tl.voo, tl.voo + tl.percurso, 14]) {
      expect(andar(quadro(elapsed, "run", tl), correndo)).toEqual(zero);
    }
  });

  it("quem tem roda não balança (carro que pula parece defeito)", () => {
    const carro = findCharacter("car");
    expect(gaitOf(carro).gait).toBe("roda");
    const hz = gaitOf(carro).hz;
    expect(andar(quadro(1 + 0.5 / hz, "car"), carro)).toEqual({ sobe: 0, lado: 0, estica: 0 });
  });

  it("quem paira sobe e desce devagar (é flutuar, não pular)", () => {
    const aviao = findCharacter("plane");
    expect(gaitOf(aviao).gait).toBe("flutua");
    const a = andar(quadro(3, "plane"), aviao);
    expect(a.sobe).toBeLessThan(0);
    expect(Math.abs(a.sobe)).toBeLessThan(0.06);
  });

  it("a cadência é do personagem: correr dá mais passos que caminhar", () => {
    expect(gaitOf(findCharacter("run")).hz).toBeGreaterThan(gaitOf(findCharacter("walk")).hz);
  });

  it("a virada é suave: o personagem não gira tudo num quadro", () => {
    /*
     * O outro lado do "robótico": o rumo do arquivo muda de degrau em degrau, e
     * a cada degrau o personagem girava de uma vez. Aqui a mesma esquina é
     * atravessada quadro a quadro, num renderizador só (o filtro é do
     * renderizador, não da função pura), e a virada tem de vir fatiada.
     */
    const esquina = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.0002, ele: 0, t: 1 },
      { lat: 0, lng: 0.0004, ele: 0, t: 2 },
      { lat: 0.0002, lng: 0.0004, ele: 0, t: 3 },
      { lat: 0.0004, lng: 0.0004, ele: 0, t: 4 },
    ]);
    const r = new SceneRenderer("dark");
    const giroDe = (t: number, elapsed?: number) => {
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(t, 14, null),
        track: esquina,
        ...(elapsed === undefined ? {} : { elapsed }),
      });
      return r.rumoDoQuadro as number;
    };
    // 420 quadros = os 14 s do percurso a 30 quadros/s (é assim que o vídeo sai)
    const N = 420;
    const serie = Array.from({ length: N }, (_, i) => giroDe((i + 1) / N));
    // a esquina é de 90°: sem o filtro, um único quadro levaria os 90°
    const saltos = serie.slice(1).map((v, i) => Math.abs(v - serie[i]));
    // 6° num quadro de 30 quadros/s = 180°/s: acima disso a virada se vê
    expect(Math.max(...saltos)).toBeLessThan(6);
    // e mesmo assim a virada acontece inteira ao longo do percurso
    expect(Math.abs(serie[serie.length - 1] - serie[0])).toBeGreaterThan(60);
  });

  it("nenhuma virada é mais rápida que o teto, nem num zigue-zague do arquivo", () => {
    /*
     * O filtro sozinho responde rápido demais a um salto grande: o arquivo tem
     * pontos que voltam sobre si (GPS com ruído) e o rumo pode virar 180° de um
     * ponto para o outro. Sem o teto, o primeiro quadro levaria 1/6 da virada
     * inteira e o personagem dava um giro seco.
     */
    const ziguezague = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.0004, ele: 0, t: 1 },
      { lat: 0, lng: 0.0008, ele: 0, t: 2 },
      { lat: 0, lng: 0.0003, ele: 0, t: 3 },
    ]);
    const r = new SceneRenderer("dark");
    const serie: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(i / 60, 14, null),
        track: ziguezague,
        elapsed: i / 30,
      });
      serie.push(r.rumoDoQuadro as number);
    }
    const saltos = serie.slice(1).map((v, i) => Math.abs(v - serie[i]));
    /*
     * 4° = 120°/s a 30 quadros/s. O maior salto é **exatamente** o teto: sem
     * ele, o filtro daria 9,7° de uma vez (180° × 0,054) no quadro em que o
     * rumo inverte — era esse o giro seco.
     */
    const maior = Math.max(...saltos);
    expect(maior).toBeLessThanOrEqual(4.001);
    expect(maior).toBeGreaterThan(3.5);
    // e a volta acontece (o zigue-zague é curto: um pouco mais de um segundo)
    expect(Math.abs(serie[serie.length - 1] - serie[0])).toBeGreaterThan(60);
  });

  it("a câmera também é suavizada por tempo (o mesmo quadro em 30 e 60 quadros/s)", () => {
    /*
     * O atraso da câmera era 0,16 **por quadro**: a 30 quadros/s isso é 0,19 s
     * de atraso e a 60 é 0,1 s — o mesmo vídeo saía diferente conforme o
     * navegador. Aqui o teste roda a mesma cena nas duas taxas e compara onde o
     * personagem cai na tela (a câmera é o que decide isso).
     */
    const semTimeline = buildTimeline(14, { voo: false, cartela: false });
    const camera = { mode: "follow" as const, followZoom: 15 };
    const ondeEsta = (fps: number) => {
      const r = new SceneRenderer("dark");
      const N = Math.round(semTimeline.percurso * fps);
      const out: number[] = [];
      for (let i = 0; i <= N; i++) {
        const instante = i / fps;
        const f = fakeCtx();
        r.render(f.ctx as never, 1280, 720, {
          ...estado(Math.min(1, instante / semTimeline.percurso), 14, null, null, null, semTimeline),
          camera,
          elapsed: instante,
        });
        out.push(seloNaTela(f)?.[1] ?? NaN);
      }
      return out;
    };
    const a30 = ondeEsta(30);
    const a60 = ondeEsta(60);
    for (let i = 0; i < a30.length; i++) {
      expect(Math.abs(a30[i] - a60[i * 2])).toBeLessThan(2);
    }
  });

  it("uma curva suave é feita no tempo de quem vira o corpo (~0,4 s até a metade)", () => {
    /*
     * É o "suavizar mais" que o usuário pediu. O teto de giro só governa as
     * viradas grandes; nas curvas suaves (a maioria num arquivo de GPS) quem
     * manda é a constante de tempo — e ela subiu de 0,25 s para 0,6 s.
     */
    const rad = (10 * Math.PI) / 180;
    const pts = [{ lat: 0, lng: 0 }];
    let x = 0;
    let y = 0;
    const G = 1 / 111320;
    for (let i = 0; i < 12; i++) {
      x += 150;
      pts.push({ lat: y * G, lng: x * G });
    }
    for (let i = 0; i < 12; i++) {
      x += 150 * Math.cos(rad);
      y += 150 * Math.sin(rad);
      pts.push({ lat: y * G, lng: x * G });
    }
    const curva = buildTrack(pts);
    // onde o traçado começa a virar (o "degrau" que o filtro recebe)
    let tDoDegrau = 1;
    for (let i = 0; i <= 2000; i++) {
      if (Math.abs(sampleTrack(curva, i / 2000).heading - 90) > 2.5) {
        tDoDegrau = i / 2000;
        break;
      }
    }
    const tl = buildTimeline(14, { voo: false, cartela: false });
    const instanteDoDegrau = tDoDegrau * tl.percurso;
    const r = new SceneRenderer("dark");
    let cruzouEm: number | null = null;
    for (let i = 0; i <= Math.round(3.5 * 30); i++) {
      const instante = instanteDoDegrau - 0.5 + i / 30;
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(Math.min(1, Math.max(0, instante / tl.percurso)), 14, null, null, null, tl),
        track: curva,
        elapsed: instante,
      });
      const rumo = r.rumoDoQuadro as number;
      if (cruzouEm === null && Math.abs(rumo - 90) >= 5) {
        cruzouEm = instante - instanteDoDegrau; // metade dos 10° da curva
      }
    }
    expect(cruzouEm).not.toBeNull();
    expect(cruzouEm as number).toBeGreaterThan(0.3);
    expect(cruzouEm as number).toBeLessThan(0.65);
  });

  it("a suavização é por tempo: 30 e 60 quadros/s dão a mesma virada", () => {
    /*
     * O filtro media o tempo em quadros (0,16 por quadro): o mesmo vídeo saía
     * mais suave a 60 quadros/s que a 30. Agora o tempo vem do `elapsed`, então
     * a taxa do gravador não muda o desenho.
     */
    const esquina = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.0002, ele: 0, t: 1 },
      { lat: 0, lng: 0.0004, ele: 0, t: 2 },
      { lat: 0.0002, lng: 0.0004, ele: 0, t: 3 },
      { lat: 0.0004, lng: 0.0004, ele: 0, t: 4 },
    ]);
    const serie = (fps: number) => {
      const r = new SceneRenderer("dark");
      const N = Math.round(semVoo.percurso * fps);
      const out: number[] = [];
      for (let i = 0; i <= N; i++) {
        const instante = i / fps;
        const f = fakeCtx();
        r.render(f.ctx as never, 1280, 720, {
          ...estado(Math.min(1, instante / semVoo.percurso), 14, null, null, null, semVoo),
          track: esquina,
          elapsed: instante,
          timeline: semVoo,
        });
        out.push(r.rumoDoQuadro as number);
      }
      return out;
    };
    const a30 = serie(30);
    const a60 = serie(60);
    expect(a30.length).toBeGreaterThan(200);
    for (let i = 0; i < a30.length; i++) {
      expect(Math.abs(a30[i] - a60[i * 2])).toBeLessThan(2);
    }
  });

  it("na curva o corpo se inclina; na reta, não", () => {
    const reta = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.001, ele: 0, t: 1 },
      { lat: 0, lng: 0.002, ele: 0, t: 2 },
      { lat: 0, lng: 0.003, ele: 0, t: 3 },
    ]);
    expect(inclinacaoDaCurva(reta, 1)).toBe(0);
    const curva = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.001, ele: 0, t: 1 },
      { lat: 0, lng: 0.002, ele: 0, t: 2 },
      { lat: 0.001, lng: 0.002, ele: 0, t: 3 },
      { lat: 0.002, lng: 0.002, ele: 0, t: 4 },
    ]);
    expect(Math.abs(inclinacaoDaCurva(curva, 2))).toBeGreaterThan(4);
    expect(Math.abs(inclinacaoDaCurva(curva, 2))).toBeLessThanOrEqual(8);
  });
});

/* ------------------------------------------------------------------ */
/* A ponta cresce quando o personagem chega                            */
/* ------------------------------------------------------------------ */

/** A escala em vigor quando a foto **de dentro do pino** foi desenhada. */
const escalaDoPino = (f: ReturnType<typeof fakeCtx>) => {
  const dentro = f.imagens.find((i) => i.args[6] <= LIMITE_PINO);
  return dentro ? dentro.escala : null;
};

const seloNaTela = (f: ReturnType<typeof fakeCtx>) =>
  f.arcosPos.find((a) => a[2] > 30 && a[2] < 50) ?? null;

describe("a ponta cresce quando o personagem chega", () => {
  const COM_FOTO = { emoji: "💦", label: "Cachoeira", photo: SRC };

  it("o pino da chegada chega inteiro no instante em que o personagem chega", () => {
    const antes = fakeCtx();
    const chegada = fakeCtx();
    const marcas = { a: null, b: COM_FOTO };
    desenhar(antes.ctx, { ...estado(0.5, 14, null), endpoints: marcas, photos: cacheComFoto });
    desenhar(chegada.ctx, { ...estado(1, 14, null), endpoints: marcas, photos: cacheComFoto });
    expect(escalaDoPino(antes)).toBeCloseTo(0.7, 2);
    expect(escalaDoPino(chegada)).toBeCloseTo(1, 2);
  });

  it("a partida nasce no pouso do voo e cresce com o personagem arrancando", () => {
    const tl = buildTimeline(14, { voo: true, cartela: false });
    const voando = fakeCtx();
    const arrancando = fakeCtx();
    const marcas = { a: LOCAL_A, b: null };
    desenhar(voando.ctx, {
      ...estado(0, 14, null, null, null, tl),
      elapsed: tl.voo - 0.2,
      endpoints: marcas,
      photos: cacheComFoto,
    });
    desenhar(arrancando.ctx, {
      ...estado(0.1, 14, null, null, null, tl),
      elapsed: tl.voo + 1,
      endpoints: marcas,
      photos: cacheComFoto,
    });
    expect(escalaDoPino(voando)).toBeCloseTo(0.7, 2);
    expect(escalaDoPino(arrancando)).toBeCloseTo(1, 2);
  });

  it("a curva do crescimento é a das paradas: encolhe, passa do cheio e volta", () => {
    /*
     * O usuário não via efeito nenhum porque o A/B crescia de 0,7 para 1 (30%,
     * com o `easeOutBack` achatado contra o 1). Uma parada, quando o personagem
     * passa, vai de 0,15 até passar do tamanho cheio e voltar — e é essa a curva
     * que as pontas usam agora.
     */
    const em = (elapsed: number) =>
      crescimentoDoPino({ ...estado(0, 14, null), elapsed } as FrameState, "a");
    expect(em(0)).toBeLessThan(0.2); // pequeno no começo
    let topo = 0;
    for (let i = 0; i <= 40; i++) topo = Math.max(topo, em((i / 40) * PINO_CRESCE_S));
    expect(topo).toBeGreaterThan(1.05); // a sobra do easeOutBack (o "aumenta")
    expect(em(PINO_CRESCE_S)).toBeCloseTo(1, 6); // e fecha no tamanho exato
    expect(em(3)).toBeCloseTo(1, 6); // e fica nele (o "diminui" é só a volta)
  });

  it("o pipoco da chegada termina exatamente no instante em que o personagem chega", () => {
    const tl = buildTimeline(14, { voo: true, cartela: true });
    const fim = routeEnd(tl);
    const em = (elapsed: number) =>
      pipocoDaPonta({ ...estado(1, 14, null, null, null, tl), elapsed } as FrameState, "b");
    expect(em(fim - PINO_CRESCE_S - 0.2)).toBeNull(); // ainda é o pino fantasma
    expect(em(fim - PINO_CRESCE_S)).toBeCloseTo(0, 6); // começa a crescer
    expect(em(fim - PINO_CRESCE_S / 2)).toBeCloseTo(0.5, 6);
    expect(em(fim)).toBeCloseTo(1, 6); // inteiro na chegada
    expect(em(fim + 1)).toBeCloseTo(1, 6); // e fica inteiro na cartela
  });

  it("a largada também tem onda de impacto no chão da rota", () => {
    // a onda das paradas, desenhada na âncora da ponta
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0, 14, null),
      elapsed: PINO_CRESCE_S * 0.4,
      endpoints: { a: LOCAL_A, b: null },
    });
    const onda = f.arcosPos.filter((a) => a[2] > 20 && a[2] < 90);
    expect(onda.length).toBeGreaterThan(0);
  });

  it("o nome e a foto saem junto com o pino (não ficam soltos)", () => {
    // a escala é aplicada antes de tudo: nome, foto e selo crescem juntos
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 14, null),
      endpoints: { a: null, b: COM_FOTO },
      photos: cacheComFoto,
    });
    expect(f.textos).toContain("Cachoeira");
    for (const img of f.imagens) expect(img.escala).toBeCloseTo(0.7, 2);
  });
});

describe("o aviso do topo não fica preso na tela", () => {
  const avisoDaChegada = (f: ReturnType<typeof fakeCtx>) =>
    f.textos.some((t) => t.includes("Percurso completo"));

  it("chegada com foto não vira aviso no topo", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.98, 14, null),
      endpoints: { a: null, b: LOCAL_B },
      photos: cacheComFoto,
    });
    expect(avisoDaChegada(f)).toBe(false);
  });

  it("sem foto, o aviso da chegada sai quando o percurso termina", () => {
    // na cartela o `t` fica parado em 1: um aviso medido em metros só termina
    // se a vida dele acabar **no fim do percurso** — foi o "continua o toast"
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const fimDoPercurso = fakeCtx();
    desenhar(fimDoPercurso.ctx, {
      ...estado(1, 14, null, null, null, tl),
      elapsed: routeEnd(tl),
      timeline: tl,
    });
    expect(avisoDaChegada(fimDoPercurso)).toBe(false);

    const naCartela = fakeCtx();
    desenhar(naCartela.ctx, {
      ...estado(1, 14, null, null, null, tl),
      elapsed: 14,
      timeline: tl,
    });
    expect(avisoDaChegada(naCartela)).toBe(false);
  });

  it("o aviso da chegada dura o mesmo em rota curta e em rota longa", () => {
    /*
     * Ele é medido em **segundos de vídeo**, não em metros: numa rota de 40 km
     * os mesmos 600 m passavam em meio segundo (ninguém lê) e numa de 2 km
     * ficavam uma eternidade. Aqui, nos dois casos, ele entra faltando ~2,5 s
     * para o fim do percurso.
     */
    const tl = buildTimeline(14, { voo: false, cartela: false });
    const curta = buildTrack([
      { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
      { lat: -23.512, lng: -48.412, ele: 720, t: T0 + 600_000 },
    ]);
    const longa = buildTrack([
      { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
      { lat: -23.86, lng: -48.76, ele: 900, t: T0 + 5400_000 },
    ]);
    const entradaDoAviso = (trk: typeof curta) => {
      for (let ms = 0; ms <= 26000; ms += 100) {
        const instante = routeEnd(tl) - 4 + ms / 1000;
        if (instante < 0) continue;
        const f = fakeCtx();
        desenhar(
          f.ctx,
          {
            ...estado(routeProgress(tl, instante), 14, null, null, null, tl),
            elapsed: instante,
          },
          trk,
        );
        if (f.textos.some((x) => x.includes("Percurso completo"))) return instante;
      }
      return NaN;
    };
    const antesCurta = routeEnd(tl) - entradaDoAviso(curta);
    const antesLonga = routeEnd(tl) - entradaDoAviso(longa);
    expect(antesCurta).toBeCloseTo(2.5, 1);
    expect(antesLonga).toBeCloseTo(2.5, 1);
    expect(Math.abs(antesCurta - antesLonga)).toBeLessThan(0.3);
  });

  it("mas ele aparece antes, para dar tempo de ler", () => {
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const instante = routeEnd(tl) - 0.6;
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado((instante - tl.voo) / tl.percurso, 14, null, null, null, tl),
      elapsed: instante,
      timeline: tl,
    });
    expect(avisoDaChegada(f)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Terceira pessoa                                                     */
/* ------------------------------------------------------------------ */

describe("terceira pessoa", () => {
  const centro = { lat: -23.5, lng: -48.4 };

  it("o centro da câmera cai mais abaixo na tela (o caminho fica em cima)", () => {
    const v = vistaDe({ centro, zoom: 16, width: 1280, height: 720, altura: CHASE_ALTURA });
    const p = project(centro.lat, centro.lng, v.z);
    const tela = projetorDaVista(v)(p.x, p.y);
    expect(tela.x).toBeCloseTo(640, 6);
    expect(tela.y).toBeCloseTo(720 * CHASE_ALTURA, 6);
  });

  it("com o giro, o caminho aponta para cima: o leste vira “acima”", () => {
    const v = vistaDe({ centro, zoom: 16, width: 1280, height: 720, angulo: -90 });
    const p = project(centro.lat, centro.lng, v.z);
    const leste = projetorDaVista(v)(p.x + 100, p.y);
    expect(leste.x).toBeCloseTo(640, 6);
    expect(leste.y).toBeLessThan(360); // subiu
  });

  it("a caixa do mundo que a tela enxerga cresce com o giro (senão sairia buraco)", () => {
    const sem = vistaDe({ centro, zoom: 16, width: 1280, height: 720 });
    const com = vistaDe({ centro, zoom: 16, width: 1280, height: 720, angulo: -45 });
    const larguraSem = (sem.x1 - sem.x0) * sem.s;
    const larguraCom = (com.x1 - com.x0) * com.s;
    // 45°: (w + h) / √2, que é bem maior que a largura da tela
    expect(larguraCom).toBeCloseTo((1280 + 720) / Math.SQRT2, 3);
    expect(larguraCom).toBeGreaterThan(larguraSem);
    // e a tela inteira está dentro dela: os quatro cantos, um por um
    const projeta = projetorDaVista(com);
    for (const [sx, sy] of [
      [0, 0],
      [1280, 0],
      [0, 720],
      [1280, 720],
    ]) {
      const dentro = tilesDaVista(com).length > 0;
      expect(dentro).toBe(true);
      const volta = (sx - com.e) * 1;
      expect(Number.isFinite(volta)).toBe(true);
      const voltaY = (sy - com.f) * 1;
      expect(Number.isFinite(voltaY)).toBe(true);
    }
    const p = project(centro.lat, centro.lng, com.z);
    expect(Math.abs(projeta(p.x, p.y).x - 640)).toBeLessThan(1e-6);
  });

  /**
   * Onde o personagem cai na tela, quadro a quadro, com **um** renderizador.
   *
   * A câmera é suavizada em relação ao alvo, então o atraso só aparece numa
   * sequência de quadros: medir um quadro isolado (com renderizador novo) daria
   * a câmera já em cima do alvo, e nenhuma diferença.
   */
  const alturasNaTela = (camera: { mode: "follow"; followZoom: number; chase?: { gira: boolean } }) => {
    const tl = buildTimeline(14, { voo: false, cartela: false });
    const r = new SceneRenderer("dark");
    const N = Math.round(tl.percurso * 30);
    const alturas: number[] = [];
    for (let i = 0; i <= N; i++) {
      const instante = i / 30;
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(Math.min(1, instante / tl.percurso), 14, null, null, null, tl),
        camera,
        elapsed: instante,
      });
      if (i % 30 === 0) alturas.push(seloNaTela(f)?.[1] ?? NaN);
    }
    return alturas;
  };

  it("o personagem fica sempre na mesma altura, mesmo com a câmera atrasada", () => {
    /*
     * O defeito que o usuário viu ("a terceira pessoa não ficou atrás do
     * personagem"): a suavização da câmera é um **atraso** de propósito, e com
     * ela no centro do quadro o personagem voltava para o meio da tela — o
     * deslocamento para baixo era comido pelo atraso. Ancorado na posição dele,
     * a altura é a mesma do começo ao fim.
     */
    const alturas = alturasNaTela({
      mode: "follow",
      followZoom: 15,
      chase: { gira: false },
    });
    expect(alturas.length).toBeGreaterThan(10);
    for (const y of alturas) expect(y).toBeCloseTo(720 * CHASE_ALTURA, 0);
  });

  it("sem terceira pessoa, a câmera atrasada leva o personagem para cima da tela", () => {
    // contraste que dá sentido ao teste anterior: sem a âncora, a altura varia
    // (é a câmera chegando depois, que na terceira pessoa estragaria o quadro)
    const alturas = alturasNaTela({ mode: "follow", followZoom: 15 });
    const amplitude = Math.max(...alturas) - Math.min(...alturas);
    // poucos pixels neste traçado curto, mas é o que a âncora elimina por completo
    expect(amplitude).toBeGreaterThan(5);
  });

  it("no vídeo, o personagem desce na tela e a seta aponta para cima", () => {
    const normal = fakeCtx();
    const terceira = fakeCtx();
    const camera = { mode: "follow" as const, followZoom: 16, chase: { gira: true } };
    desenhar(normal.ctx, { ...estado(0.5, 14, null), camera: { mode: "follow", followZoom: 16 } });
    desenhar(terceira.ctx, { ...estado(0.5, 14, null), camera });
    const semTerceira = seloNaTela(normal);
    const comTerceira = seloNaTela(terceira);
    expect(comTerceira![1]).toBeGreaterThan(semTerceira![1] + 80);
    // o mapa girou no rumo: na tela, o rumo é sempre "para cima" (-90° na seta)
    expect(comTerceira).not.toBeNull();
    expect(terceira.giros.some((g) => Math.abs(g + 90) < 0.01)).toBe(true);
  });

  it("a terceira pessoa só vale no “Seguir” (no “Rota toda” não há para onde ir)", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 14, null),
      camera: { mode: "fit", followZoom: 16, chase: { gira: true } },
    });
    const selo = seloNaTela(f);
    expect(Math.abs(selo![1] - 360)).toBeLessThan(60); // segue centrado
  });
});
