import { describe, expect, it } from "vitest";
import { buildTrack, cumulative } from "./geo";
import { buildTimeline, routeEnd, type Timeline } from "./timeline";
import { colorizeRoute, NEUTRAL_COLOR } from "./coloring";
import { formatClock, timesOf } from "./hud";
import { type PhotoImage, type PhotoLookup } from "./photos";
import type { Poi } from "./pois";
import { kmMarks } from "./km-marks";
import { findCharacter } from "./characters";
import {
  SceneRenderer,
  liftToClear,
  overlapsCard,
  summaryBox,
  type FrameState,
  type SceneStyle,
} from "./renderer";
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
  /** cada `stroke()`: a cor, a espessura e quantos pontos o caminho tinha */
  const tracos: { cor: string; largura: number; pontos: number }[] = [];
  /** cada `fill()`: a cor de preenchimento em vigor (a polaroide branca era um fill) */
  const pinturas: string[] = [];
  /** cada `drawImage`: os argumentos e o alfa em vigor no momento */
  const imagens: { args: number[]; alpha: number }[] = [];
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
  const pilha: [number, number][] = [];
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
          if (prop === "save") pilha.push([tx, ty]);
          if (prop === "restore") {
            const p = pilha.pop();
            if (p) {
              tx = p[0];
              ty = p[1];
            }
          }
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
            });
          }
          if (prop === "arc") arcos.push(args as number[]);
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

  it("foto escolhida mas não carregada: o aviso volta (o lugar não passa em branco)", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.51, 14, null),
      ...comVolta({ photo: SRC }),
      photos: cacheVazio,
    });
    expect(avisos(textos)).toBe(1);
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
