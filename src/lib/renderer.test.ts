import { describe, expect, it } from "vitest";
import {
  TILE_SIZE,
  buildTrack,
  cumDoDesenho,
  cumulative,
  formatDistance,
  haversine,
  rumoSuave,
  sampleTrack,
} from "./geo";
import { formatPace } from "./hud";
import { buildTimeline, routeEnd, routeProgress, type Timeline } from "./timeline";
import { colorizeRoute, NEUTRAL_COLOR, slopeAt, slopeSeries } from "./coloring";
import { destaques } from "./highlights";
import { formatClock, timesOf } from "./hud";
import { type PhotoImage, type PhotoLookup } from "./photos";
import { poiLatLng, type Poi } from "./pois";
import { kmMarks } from "./km-marks";
import { profileLayout, trailProfile } from "./profile";
import { findCharacter, gaitOf } from "./characters";
import {
  SceneRenderer,
  PINO_CRESCE_S,
  SANGRIA_PX,
  TILE_BUDGET,
  blocoDeReserva,
  blocoDoQuadro,
  centroDoBloco,
  ladoDoBloco,
  retanguloDoBloco,
  andar,
  crescimentoDoPino,
  pipocoDaPonta,
  inclinacaoDaCurva,
  janelaDoRumo,
  liftToClear,
  minimapLayout,
  lugarDoBloco,
  overlapsCard,
  pesoQueCabe,
  projetorDaVista,
  summaryBox,
  tilesDaVista,
  tilesForAnimation,
  vistaDe,
  type FrameState,
  type SceneStyle,
} from "./renderer";
import { CHASE_ALTURA, CHASE_TILT, boostQueCabe, zoomEfetivo } from "./camera";
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
  /** os pontos de cada caminho traçado, na ordem dos `stroke()` */
  const tracosPontos: number[][][] = [];
  /** o caminho em construção (moveTo/lineTo), em coordenadas do quadro */
  let caminho: number[][] = [];
  /** cada `fill()`: a cor de preenchimento em vigor (a polaroide branca era um fill) */
  const pinturas: string[] = [];
  /** cada `drawImage`: os argumentos, o alfa e a escala em vigor no momento */
  const imagens: { args: number[]; alpha: number; escala: number }[] = [];
  /** cada `setTransform(a,b,c,d,e,f)`: é a matriz dos blocos de mapa */
  const transforms: number[][] = [];
  /** o y de cada `fillText`, na mesma ordem de `textos` */
  const textosY: number[] = [];
  /**
   * Posição **absoluta** de cada texto, na ordem de `textos`: soma o
   * deslocamento em vigor. É o que importa quando um pino é empurrado para fora
   * da cartela — o `textosY` sozinho é a posição dentro do `translate`.
   */
  const textosYAbs: number[] = [];
  /** o x absoluto de cada texto, na ordem de `textos` (a etiqueta pode deslizar) */
  const textosXAbs: number[] = [];
  /** cor em vigor em cada texto (na ordem de `textos`) */
  const textosCor: string[] = [];
  /** o que foi desenhado, na ordem: "texto:…" ou "imagem" */
  const ordem: string[] = [];
  /** posição de cada texto (para achar as marcas da linha do tempo) */
  const textosPos: { s: string; x: number; y: number }[] = [];
  /** primeiro ponto de cada `moveTo` (onde o traçado caiu na tela) */
  const movimentos: number[][] = [];
  /**
   * A caixa de cada `fillText`, na mesma ordem de `textos`: é o `roundRect`
   * desenhado imediatamente antes (a única coisa que usa `arcTo` no renderer).
   * Sem ela, "o nome ficou dentro da moldura" só dava para conferir por uma
   * estimativa de largura — e a estimativa errava 2 px para cada lado.
   */
  const caixas: ({ x0: number; y0: number; x1: number; y1: number } | null)[] = [];
  /** caixa do caminho em construção (as quinas do `roundRect`) */
  let quina: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** as caixas fechadas até agora, com o número da chamada em que nasceram */
  const caixasDesenhadas: { op: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  let ops = 0;
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
          ops++;
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
            textosYAbs.push(ty + esc * Number(args[2] ?? args[1] ?? 0));
            textosXAbs.push(tx + esc * Number(args[1] ?? 0));
            textosCor.push(String(props.fillStyle ?? ""));
            /*
             * A caixa da etiqueta é o `roundRect` desenhado umas poucas
             * chamadas antes (a seta, no meio, abre um caminho novo). Procura-se
             * pela caixa **centrada no texto** entre as últimas 20 chamadas —
             * assim um retângulo qualquer não é confundido com a etiqueta.
             */
            const xAbs = tx + esc * Number(args[1] ?? 0);
            const yAbs = ty + esc * Number(args[2] ?? args[1] ?? 0);
            const perto = caixasDesenhadas
              .filter(
                (b) =>
                  b.op >= ops - 20 &&
                  Math.abs((b.x0 + b.x1) / 2 - xAbs) < 2 &&
                  Math.abs((b.y0 + b.y1) / 2 - yAbs) < 3,
              )
              .pop();
            caixas.push(perto ? { x0: perto.x0, y0: perto.y0, x1: perto.x1, y1: perto.y1 } : null);
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
          if (prop === "setTransform") transforms.push(args.map((a) => Number(a)));
          if (prop === "rotate") giros.push((Number(args[0] ?? 0) * 180) / Math.PI);
          if (prop === "arc") {
            arcos.push(args as number[]);
            arcosPos.push([tx + Number(args[0] ?? 0), ty + Number(args[1] ?? 0), ...(args.slice(2) as number[])]);
          }
          // só a cor em texto: alguns lugares passam um gradiente (objeto) aqui
          if (prop === "fill" && typeof props.fillStyle === "string") {
            pinturas.push(props.fillStyle);
          }
          if (prop === "beginPath") {
            pontos = 0;
            quina = null;
          }
          if (prop === "arcTo") {
            // o `roundRect` passa pelas quatro quinas: a união delas é a caixa
            for (const [px, py] of [
              [args[0], args[1]],
              [args[2], args[3]],
            ]) {
              const x = Number(px ?? 0);
              const y = Number(py ?? 0);
              quina = quina
                ? { x0: Math.min(quina.x0, x), y0: Math.min(quina.y0, y), x1: Math.max(quina.x1, x), y1: Math.max(quina.y1, y) }
                : { x0: x, y0: y, x1: x, y1: y };
            }
          }
          if (prop === "closePath" && quina) {
            caixasDesenhadas.push({
              op: ops,
              x0: tx + esc * quina.x0,
              y0: ty + esc * quina.y0,
              x1: tx + esc * quina.x1,
              y1: ty + esc * quina.y1,
            });
          }
          if (prop === "moveTo") {
            pontos++;
            movimentos.push(args as number[]);
            caminho = [[Number(args[0] ?? 0), Number(args[1] ?? 0)]];
          }
          if (prop === "lineTo") {
            pontos++;
            caminho.push([Number(args[0] ?? 0), Number(args[1] ?? 0)]);
          }
          if (prop === "beginPath") caminho = [];
          if (prop === "stroke") {
            // o mesmo caminho pode ser traçado várias vezes (sombra, cor, brilho):
            // os pontos valem até o próximo `beginPath`
            tracosPontos.push(caminho.map(([x, y]) => [x, y]));
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
    textosXAbs,
    caixas,
    caixasDesenhadas,
    textosPos,
    textosCor,
    ordem,
    arcos,
    transforms,
    arcosPos,
    giros,
    tracos,
    tracosPontos,
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

  it("sem arquivo de GPS não inventa velocidade: mostra a inclinação do trecho", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: gpsTrack,
    });
    /*
     * A média do vídeo daria milhares de km/h numa rota longa em clipe curto —
     * velocidade o HUD continua não inventando. Mas também não fica no traço:
     * numa rota que ninguém percorreu (a prévia de percurso) o anel mostra o
     * que a rota **tem** — aqui, a inclinação do trecho (10 m a cada 100 m).
     */
    expect(textos).not.toContain("—");
    expect(textos).not.toContain("sem arquivo");
    expect(textos).not.toContain("km/h");
    expect(textos).toContain("%");
    // 1 m a cada 100 m: a série da inclinação, não um número de conveniência
    expect(textos).toContain("1,0");
    expect(textos).toContain("subindo");
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

  it("a pé sem relógio (nem arquivo, nem cartela) também vira prévia de percurso", () => {
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: gpsTrack,
      style: { ...style, pace: true },
    });
    // sem tempo não existe ritmo — nem médio, nem do instante
    expect(textos).not.toContain("min/km");
    expect(textos).not.toContain("média");
    expect(textos).not.toContain("—");
    expect(textos).toContain("%");
    expect(textos).toContain("subindo");
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
    // e o anel não fica vazio: vira a prévia de percurso
    expect(textos).not.toContain("—");
    expect(textos).toContain("%");
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
    // nenhum relógio (nem o cinco vezes menor), e o anel cai na prévia
    const { ctx: ctx2, textos: textos2 } = fakeCtx();
    desenhar(ctx2, { ...estado(0.5, 14, null, grandes.map((p) => p.t)) }, t);
    expect(textos2.some((x) => /\d:\d\d/.test(x))).toBe(false);
    expect(textos2).toContain("restantes");
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

  it("aparece antes de passar pela parada", () => {
    /*
     * A foto só nascia depois da passagem. Numa parada perto do fim isso é
     * tarde: o personagem já andou, e o bloco (foto, nome e pino) quase sai
     * pela borda. Agora ela entra 1,2 s de vídeo antes, enquanto a parada ainda
     * está na frente do personagem.
     */
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5 - 0.6 / 14, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
  });

  it("não aparece muito antes de passar pela parada", () => {
    const { ctx, imagens } = fakeCtx();
    // 2,5 s de vídeo antes da passagem: cedo demais
    desenhar(ctx, {
      ...estado(0.5 - 2.5 / 14, 14, null),
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

  it("continua na tela depois da passagem pelo mesmo tempo de antes", () => {
    /*
     * Antecipar a entrada não pode encurtar a saída: se a janela só deslizasse,
     * a foto sairia 1,2 s mais cedo do que saía. Aqui, 2,3 s depois da parada
     * (dentro dos 2,6 s de sempre), ela ainda está.
     */
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5 + 2.3 / 14, 14, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
  });

  it("num vídeo longo, a foto dura o mesmo tempo de vídeo (não some por ser rota longa)", () => {
    // o motivo de a janela ser em segundos: em metros, uma foto numa rota de
    // 435 km duraria 0,04 s
    const { ctx, imagens } = fakeCtx();
    desenhar(ctx, {
      ...estado(0.5 + 0.5 / 60, 60, null),
      stops: [parada({ photo: SRC })],
      photos: cacheComFoto,
    });
    expect(fotosGrandes({ imagens } as never).length).toBe(1);
  });

  it("a foto entra com alfa crescente e chega cheia na passagem", () => {
    // o alfa do desenho é calculado (não lido do contexto), então dá para
    // conferir a rampa: começa a entrar 1,2 s antes e está inteira na parada
    const entrando = fakeCtx();
    const naHora = fakeCtx();
    const comum = { stops: [parada({ photo: SRC })], photos: cacheComFoto };
    desenhar(entrando.ctx, { ...estado(0.5 - 1.15 / 14, 14, null), ...comum });
    /*
     * Medido 0,2 s **depois** da passagem: no quadro exato da passagem o bloco
     * acompanha o "pipoco" do pino, que começa pequeno e cresce em ~0,1 s.
     */
    desenhar(naHora.ctx, { ...estado(0.5 + 0.2 / 14, 14, null), ...comum });
    const naEntrada = fotosGrandes(entrando)[0];
    expect(naEntrada).toBeDefined();
    expect(naEntrada.alpha).toBeGreaterThan(0);
    expect(naEntrada.alpha).toBeLessThan(1);
    expect(fotosGrandes(naHora)[0].alpha).toBeCloseTo(1, 2);
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
    // y **na tela** (não no espaço do bloco): é a posição que o usuário vê
    const y = (f: typeof comFoto) => f.textosYAbs[f.textos.indexOf("Ponte")];
    // y menor = mais para cima (o canvas cresce para baixo)
    expect(y(comFoto)).toBeLessThan(y(semFoto));
  });
});

/* ------------------------------------------------------------------ */
/* A parada perto do fim do vídeo                                      */
/* ------------------------------------------------------------------ */

/**
 * Um quadro do fim do vídeo: `t` é o progresso do percurso e `elapsed` é o
 * relógio **do vídeo**, como na exportação (a cartela reserva a sua fatia).
 */
const quadroDoFim = (
  t: number,
  stops: Poi[],
  extra: Partial<FrameState> = {},
): { st: FrameState; tl: Timeline } => {
  const tl = buildTimeline(14, { voo: false, cartela: true });
  return {
    st: {
      ...estado(Math.min(1, t), 14, cartela, null, null, tl),
      elapsed: Math.min(1, t) * tl.percurso,
      stops,
      ...extra,
    },
    tl,
  };
};

/** A caixa de um bloco na tela não encosta na caixa da cartela. */
const encostaNaCartela = (
  e: { x0: number; y0: number; x1: number; y1: number },
  c: { boxX: number; boxY: number; boxW: number; boxH: number },
) =>
  e.x0 < c.boxX + c.boxW && e.x1 > c.boxX && e.y0 < c.boxY + c.boxH && e.y1 > c.boxY;

describe("a parada perto do fim do vídeo", () => {
  const pertoDoFim = parada({ t: 0.97 });
  /**
   * A última perna **sobe** (vai para o norte): no quadro, o selo da chegada
   * fica em cima da parada do fim — que é o caso do usuário (a última parada é
   * praticamente a chegada), e o que faz o pino tapar o nome da parada.
   */
  const ROTA_FINAL_QUE_SOBE = buildTrack([
    { lat: -23.5, lng: -48.4, ele: 700, t: 0 },
    { lat: -23.52, lng: -48.42, ele: 780, t: 900_000 },
    { lat: -23.5195, lng: -48.42, ele: 780, t: 930_000 },
  ]);
  // a parada tem lugar próprio, ~30 m ao sul da chegada: como o ponto está fora
  // da linha (mais de 12 m), o pino não é empurrado para o lado e cai logo
  // abaixo do selo da chegada — é o que o usuário vê na última parada
  const coladaNaChegada = parada({
    t: 0.98,
    pos: { lat: -23.5195 - 0.00027, lng: -48.42 },
  });
  /** os selos de pino no quadro (os A/B têm 17 px de raio, como o da parada) */
  const selosNaTela = (f: ReturnType<typeof fakeCtx>) =>
    f.arcosPos.filter((a) => a[2] > 15 && a[2] < 20);
  const encostaNoSelo = (e: { x0: number; y0: number; x1: number; y1: number }, s: number[]) =>
    e.x0 < s[0] + s[2] && e.x1 > s[0] - s[2] && e.y0 < s[1] + s[2] && e.y1 > s[1] - s[2];

  it("a etiqueta entra antes da passagem — em segundos, não em metros", () => {
    /*
     * Dois defeitos, em duas rodadas.
     *
     * O primeiro: a etiqueta era medida em **metros**, como o pino. Numa rota
     * em que o vídeo anda poucos metros por segundo os últimos metros duram
     * muito tempo de vídeo, e a parada perto do fim só se anunciava depois de o
     * vídeo acabar. Passou a ser medida em segundos.
     *
     * O segundo, este de agora: mesmo em segundos, o nome só nascia **depois**
     * da passagem — e aí o pino já está atrás do personagem e sai da tela em
     * menos de um segundo ("quando aparece, já está sumindo da tela"). Agora o
     * nome entra 2 s de vídeo antes, enquanto a parada ainda está na frente.
     */
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const noMeio = parada({ t: 0.9 });

    // bem antes (2,5 s de vídeo): ainda não
    const cedo = fakeCtx();
    desenhar(cedo.ctx, quadroDoFim(0.9 - 2.5 / tl.percurso, [noMeio]).st);
    expect(etiquetasNaTela(cedo, ["Ponte"]).length).toBe(0);

    // 1,5 s antes da passagem: já está na tela, com o personagem ainda atrás
    const chegando = fakeCtx();
    desenhar(chegando.ctx, quadroDoFim(0.9 - 1.5 / tl.percurso, [noMeio]).st);
    expect(etiquetasNaTela(chegando, ["Ponte"]).length).toBeGreaterThan(0);

    // e continua depois de passar
    const depois = fakeCtx();
    desenhar(depois.ctx, quadroDoFim(0.9 + 0.4 / tl.percurso, [noMeio]).st);
    expect(etiquetasNaTela(depois, ["Ponte"]).length).toBeGreaterThan(0);
  });

  it("a parada colada no fim se anuncia antes de o personagem chegar", () => {
    /*
     * O caso que o usuário descreveu: a última parada é praticamente a
     * chegada. Se o nome nasce só na passagem, ele aparece no apagar das
     * luzes — e o personagem já passou. Aqui: a 10% do percurso do fim (0,85
     * com a parada em 0,97), a etiqueta já está na tela.
     */
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const noFim = parada({ t: 0.97 });
    const f = fakeCtx();
    desenhar(f.ctx, quadroDoFim(0.85, [noFim]).st);
    expect(0.85).toBeLessThan(0.97); // o personagem ainda não chegou
    expect(etiquetasNaTela(f, ["Ponte"]).length).toBeGreaterThan(0);
    expect(tl.percurso).toBeGreaterThan(0);
  });

  it("a parada que ainda vem ganha um halo, para ser vista no mapa", () => {
    /*
     * O pino da parada futura era 0,7 com 55% de opacidade e sumia no meio das
     * ruas ("não dá para ver direito os pontos"). O halo de 26 px (no quadro de
     * 1280×720, onde `sf` é 1) marca a próxima parada; ele desaparece depois da
     * passagem, quando o pino já está inteiro.
     */
    const indo = fakeCtx();
    desenhar(indo.ctx, quadroDoFim(0.5, [parada({ t: 0.9 })]).st);
    const halo = indo.arcosPos.filter((a) => Math.abs(a[2] - 26) < 0.01);
    expect(halo.length).toBeGreaterThan(0);

    // depois de passar, o halo sai de cena (o pino inteiro basta)
    const passou = fakeCtx();
    desenhar(passou.ctx, quadroDoFim(0.95, [parada({ t: 0.9 })]).st);
    expect(passou.arcosPos.filter((a) => Math.abs(a[2] - 26) < 0.01).length).toBe(0);
  });

  it("num trajeto curto, a parada colada no fim também se anuncia no mapa", () => {
    /*
     * A regra antiga media a etiqueta em **metros** (a mesma janela do pino).
     * Num trajeto curto essa janela é uma fatia enorme do caminho: numa volta de
     * 60 m, os 28 m da janela do pino são quase metade dele — e a parada a 97%
     * nunca acendia a etiqueta antes de o vídeo acabar. Só sobrava o aviso do
     * topo, que é o que o usuário via ("ele aparece como toast").
     */
    const curto = buildTrack([
      { lat: 0, lng: 0, ele: 0, t: 0 },
      { lat: 0, lng: 0.00027, ele: 0, t: 30_000 },
      { lat: 0, lng: 0.00054, ele: 0, t: 60_000 },
    ]);
    expect(curto.total).toBeLessThan(80);
    const f = fakeCtx();
    desenhar(f.ctx, quadroDoFim(1, [parada({ t: 0.97 })]).st, curto);
    expect(etiquetasNaTela(f, ["Ponte"]).length).toBeGreaterThan(0);
  });

  it("a parada colada na chegada não fica atrás do pino da chegada", () => {
    /*
     * Sem o desvio, o bloco da parada era desenhado por baixo dos pinos (que
     * entram depois no quadro): a chegada fica a poucos metros da última parada,
     * e o selo dela tapava metade do nome.
     */
    // a câmera que acompanha põe o fim do trajeto no centro da tela: a parada
    // do fim (98%) cai a poucos pixels do selo da chegada
    const st = quadroDoFim(1, [coladaNaChegada], {
      camera: { mode: "follow", followZoom: 16 },
      style: { ...style, showSummary: false },
    }).st;
    const f = fakeCtx();
    desenhar(f.ctx, st, ROTA_FINAL_QUE_SOBE);
    const etiquetas = etiquetasNaTela(f, ["Ponte"]);
    expect(etiquetas.length).toBeGreaterThan(0);
    const selos = selosNaTela(f);
    expect(selos.length).toBeGreaterThan(1); // a partida e a chegada no quadro
    for (const e of etiquetas) {
      for (const sel of selos) expect(encostaNoSelo(e, sel)).toBe(false);
    }
  });

  it("a parada que cai em cima da cartela não fica atrás dela", () => {
    // a câmera acompanha e o fim do trajeto cai no meio da tela, que é onde a
    // cartela nasce. Sem os pinos no quadro, a cartela sai exatamente onde o
    // `summaryBox` diz — dá para comparar as duas caixas.
    const st = quadroDoFim(1, [coladaNaChegada], {
      camera: { mode: "follow", followZoom: 16 },
      style: { ...style, showEndpoints: false },
    }).st;
    const f = fakeCtx();
    desenhar(f.ctx, st, ROTA_FINAL_QUE_SOBE);
    const etiquetas = etiquetasNaTela(f, ["Ponte"]);
    expect(etiquetas.length).toBeGreaterThan(0);
    const caixa = summaryBox(fakeCtx().ctx, 1280, 720, st, 1, []);
    expect(caixa).not.toBeNull();
    for (const e of etiquetas) expect(encostaNaCartela(e, caixa!)).toBe(false);
  });

  it("na última cena a etiqueta está na tela inteira — e fora da cartela", () => {
    // sem partida/chegada no quadro, a cartela fica exatamente onde o
    // `summaryBox` diz: assim dá para comparar a caixa dela com a da etiqueta
    const semPontas = { style: { ...style, showEndpoints: false } };
    const { st } = quadroDoFim(1, [pertoDoFim], semPontas);
    const f = fakeCtx();
    desenhar(f.ctx, st);

    const etiquetas = etiquetasNaTela(f, ["Ponte"]);
    expect(etiquetas.length).toBeGreaterThan(0);
    const caixa = summaryBox(fakeCtx().ctx, 1280, 720, st, 1, []);
    expect(caixa).not.toBeNull();
    const selos = selosNaTela(f);
    expect(selos.length).toBeGreaterThan(0); // a chegada está na tela
    for (const e of etiquetas) {
      for (const sel of selos) expect(encostaNoSelo(e, sel)).toBe(false);
      // dentro da moldura, sem encostar na cartela (que é desenhada por cima)
      expect(e.x0).toBeGreaterThanOrEqual(0);
      expect(e.y0).toBeGreaterThanOrEqual(0);
      expect(e.x1).toBeLessThanOrEqual(1280);
      expect(e.y1).toBeLessThanOrEqual(720);
      expect(encostaNaCartela(e, caixa!)).toBe(false);
    }
  });

  it("em retrato e na terceira pessoa, a etiqueta também fica no quadro", () => {
    // o caso mais apertado: a parada cai na parte de baixo do quadro, que é
    // onde a câmera em terceira pessoa põe o personagem
    const { st } = quadroDoFim(1, [pertoDoFim], {
      camera: { mode: "follow", followZoom: 16, chase: { gira: false, tilt: true } },
    });
    const f = fakeCtx();
    desenhar(f.ctx, st, track, 1080, 1920);
    const etiquetas = etiquetasNaTela(f, ["Ponte"]);
    expect(etiquetas.length).toBeGreaterThan(0);
    for (const e of etiquetas) {
      expect(e.x0).toBeGreaterThanOrEqual(0);
      expect(e.y0).toBeGreaterThanOrEqual(0);
      expect(e.x1).toBeLessThanOrEqual(1080);
      expect(e.y1).toBeLessThanOrEqual(1920);
    }
  });
});

describe("o orçamento de blocos com as paradas aproximadas", () => {
  it("a parada perde o ganho de zoom antes de a exportação ser recusada", () => {
    /*
     * O teto de blocos manda mais que a parada. Numa rota de 30 km em 9:16 na
     * terceira pessoa, só a rota pede ~1086 blocos, e cada parada aproximada
     * custa mais uns 100: com a aproximação de 2,2 níveis o teto de 1400 é
     * alcançado no meio da lista de paradas. O certo é a parada **seguinte**
     * ficar sem a vista extra — e não a exportação ser recusada por causa de um
     * enfeite (sem o corte, essa mesma rota pede ~1506 blocos).
     */
    const graus = 30 / 111.32;
    const rota = buildTrack(
      Array.from({ length: 4000 }, (_, i) => ({
        lat: -23.5 + (i / 3999) * graus,
        lng: -48.4 + (i / 3999) * graus * 0.35,
      })),
    );
    const camera = { mode: "follow" as const, followZoom: 16, chase: { gira: false, tilt: true } };
    const sem = tilesForAnimation(rota, camera, 1080, 1920, "osm", null).length;
    const com = tilesForAnimation(rota, camera, 1080, 1920, "osm", {
      opening: false,
      stops: true,
      stopTs: [0.2, 0.4, 0.6, 0.8],
      chegada: true,
    }).length;
    expect(sem).toBeLessThan(TILE_BUDGET); // a rota sozinha cabe
    expect(com).toBeLessThanOrEqual(TILE_BUDGET); // com as paradas também
    expect(com).toBeGreaterThan(sem); // as paradas que couberam ganharam a vista
  });
});

describe("o lugar do bloco de uma parada", () => {
  const quadro = { width: 1080, height: 1920 };
  const largura = 420;
  const altura = 220;

  it("fica acima do pino; sem chão acima, desce", () => {
    expect(lugarDoBloco({ x: 540, y: 120 }, largura, altura, 26, 8, quadro, 10).acima).toBe(false);
    expect(lugarDoBloco({ x: 540, y: 960 }, largura, altura, 26, 8, quadro, 10).acima).toBe(true);
  });

  it("nunca sai do quadro — nem em cima, nem embaixo, nem de lado", () => {
    for (const y of [10, 60, 960, 1900, 1960]) {
      const l = lugarDoBloco({ x: 20, y }, largura, altura, 26, 8, quadro, 10);
      expect(l.y).toBeGreaterThanOrEqual(10);
      expect(l.y + altura).toBeLessThanOrEqual(1920 - 10);
      expect(l.x - largura / 2).toBeGreaterThanOrEqual(10);
      expect(l.x + largura / 2).toBeLessThanOrEqual(1080 - 10);
    }
  });

  it("sai de baixo da cartela final (ela é desenhada por cima)", () => {
    const carta = { x: 240, y: 700, w: 600, h: 520 };
    const l = lugarDoBloco({ x: 540, y: 1180 }, largura, altura, 26, 8, quadro, 10, [carta]);
    const encosta =
      l.x - largura / 2 < carta.x + carta.w &&
      l.x + largura / 2 > carta.x &&
      l.y < carta.y + carta.h &&
      l.y + altura > carta.y;
    expect(encosta).toBe(false);
    expect(l.y).toBeGreaterThanOrEqual(10);
    expect(l.y + altura).toBeLessThanOrEqual(1910);
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

describe("parada passada duas vezes", () => {
  it("a foto aparece na ida, some, e aparece de novo na volta", () => {
    const ida = fakeCtx();
    const meio = fakeCtx();
    const volta = fakeCtx();
    /*
     * As duas passagens ficam mais afastadas do que no `DUAS_VEZES` (0,5 e 0,8):
     * a foto agora abre 1,2 s **antes** de cada passagem, então com 3 s entre as
     * duas ela ficaria na tela o tempo todo — e o que este teste guarda é que
     * ela aparece de novo na volta, não que fica ligada.
     */
    const comum = {
      ...comVolta({ photo: SRC }),
      passages: { p1: [0.5, 0.9] },
      photos: cacheComFoto,
    };
    // 1 s de vídeo depois de cada passagem: dentro da janela da foto
    desenhar(ida.ctx, { ...estado(0.5 + 1 / 14, 14, null), ...comum });
    desenhar(meio.ctx, { ...estado(0.7, 14, null), ...comum });
    desenhar(volta.ctx, { ...estado(0.9 + 1 / 14, 14, null), ...comum });
    expect(fotosGrandes(ida).length).toBe(1);
    expect(fotosGrandes(meio).length).toBe(0);
    expect(fotosGrandes(volta).length).toBe(1);
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

  it("a cartela sai de cima da chegada (em vez de o pino sair de baixo dela)", () => {
    /*
     * Com a câmera que acompanha o personagem, a chegada cai no meio da tela —
     * exatamente onde a cartela nasce. O pedido é literal: "ajuste a cartela
     * para não ficar em cima do ponto B na chegada". Quem se desloca agora é o
     * **painel**: o pino, o nome e a foto ficam onde estavam.
     */
    const seguir = { camera: { mode: "follow" as const, followZoom: 16 } };
    const marcas = { a: null, b: LOCAL_B };
    const com = fakeCtx();
    desenhar(com.ctx, {
      ...estado(1, 14, cartela),
      ...seguir,
      endpoints: marcas,
      photos: cacheComFoto,
    });
    // o pino da chegada fica na âncora da vista (a câmera está pousada nele)
    const caixa = summaryBox(com.ctx, 1280, 720, { ...estado(1, 14, cartela), ...seguir }, 1, [
      { x: 640, y: 360, r: 104 },
    ]);
    expect(caixa).not.toBeNull();
    const dentro = (y: number) => y > caixa!.boxY && y < caixa!.boxY + caixa!.boxH;
    expect(dentro(360)).toBe(false); // o pino não está debaixo dela
    expect(dentro(yAbsDe(com, "Cachoeira"))).toBe(false); // nem o nome

    const sem = fakeCtx();
    desenhar(sem.ctx, {
      ...estado(1, 14, null),
      ...seguir,
      endpoints: marcas,
      photos: cacheComFoto,
    });
    // e o nome ficou exatamente onde estava: o que se mexeu foi a cartela
    expect(yAbsDe(com, "Cachoeira")).toBeCloseTo(yAbsDe(sem, "Cachoeira"), 6);
  });

  it("a cartela escolhe o lado mais perto do pino — e não sai da tela", () => {
    const seguir = estado(1, 14, cartela);
    const base = summaryBox(fakeCtx().ctx, 1280, 720, seguir, 1)!;
    const altura = base.boxH;
    const centro = base.boxY;
    /** A caixa com um pino no lugar dado. */
    const com = (y: number, r = 60) =>
      summaryBox(fakeCtx().ctx, 1280, 720, seguir, 1, [{ x: 640, y, r }])!;
    const encosta = (L: ReturnType<typeof com>, y: number, r: number) =>
      L.boxY + L.boxH > y - r && L.boxY < y + r;

    // 1) pino longe da caixa: a cartela fica onde sempre ficou
    expect(com(20).boxY).toBeCloseTo(centro, 6);

    // 2) pino colado no alto, encostando na caixa: ela desce e cabe inteira
    const alto = com(centro - 40);
    expect(alto.boxY).toBeGreaterThan(centro);
    expect(alto.boxY + altura).toBeLessThanOrEqual(720.001);
    expect(encosta(alto, centro - 40, 60)).toBe(false);

    // 3) pino no fundo: ela sobe, e também cabe
    const fundo = com(centro + altura + 40);
    expect(fundo.boxY).toBeLessThan(centro);
    expect(fundo.boxY).toBeGreaterThanOrEqual(0);
    expect(encosta(fundo, centro + altura + 40, 60)).toBe(false);

    // 4) empate (pino centrado na tela): desce — em cima ficam o HUD e o aviso
    const empate = com(360);
    expect(empate.boxY).toBeGreaterThan(centro);
    expect(encosta(empate, 360, 60)).toBe(false);

    // 5) pino grande cobrindo a tela toda: não há para onde ir, ela fica
    const semSaida = com(360, 400);
    expect(semSaida.boxY).toBeCloseTo(centro, 6);
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
     * 3° = 90°/s a 30 quadros/s. Um traçado que **volta sobre si** (o pior caso:
     * 180° de mudança de direção) ainda encosta no teto — é para isso que ele
     * existe. Sem ele, o filtro daria 9,7° de uma vez (180° × 0,054) no quadro
     * da inversão, que era o giro seco.
     *
     * O valor caiu de 120°/s para 90°/s junto com a suavização do rumo **na
     * distância**: o teto deixou de ser o mecanismo e virou rede de segurança —
     * numa curva comum do traçado ele não entra mais (é o teste seguinte).
     */
    const maior = Math.max(...saltos);
    expect(maior).toBeLessThanOrEqual(3.001);
    expect(maior).toBeGreaterThan(2.8);
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

  it("nas curvas o corpo se inclina **devagar**: sem degrau de um quadro para o outro", () => {
    /*
     * O outro lado do "brusco nas curvas": `inclinacaoDaCurva` olha 30 m de
     * traçado e, quando o índice muda de ponto, o ângulo muda de degrau. O
     * usuário viu isso como o corpo entortando de uma vez. Aqui a inclinação é
     * suavizada no tempo e o teste mede o maior degrau entre quadros.
     */
    const G = 1 / 111320;
    const rad = (25 * Math.PI) / 180;
    const pts = [{ lat: 0, lng: 0 }];
    let x = 0;
    let y = 0;
    for (let i = 0; i < 8; i++) {
      x += 20;
      pts.push({ lat: y * G, lng: x * G });
    }
    for (let i = 0; i < 24; i++) {
      x += 20 * Math.cos(rad);
      y += 20 * Math.sin(rad);
      pts.push({ lat: y * G, lng: x * G });
    }
    const curva = buildTrack(pts);
    const tl = buildTimeline(14, { voo: false, cartela: false });
    const r = new SceneRenderer("dark");
    const serie: number[] = [];
    const N = Math.round(tl.percurso * 30);
    for (let i = 0; i <= N; i++) {
      const instante = i / 30;
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(Math.min(1, instante / tl.percurso), 14, null, null, null, tl),
        track: curva,
        elapsed: instante,
      });
      serie.push(r.inclinacaoDoQuadro as number);
    }
    const saltos = serie.slice(1).map((v, i) => Math.abs(v - serie[i]));
    // 1,5° num quadro de 30 quadros/s = 45°/s: acima disso o corpo "entorta"
    expect(Math.max(...saltos)).toBeLessThan(1.5);
    // e mesmo assim a curva inclina o corpo de verdade
    expect(Math.max(...serie.map(Math.abs))).toBeGreaterThan(3);
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

/**
 * Os nomes desenhados **junto dos pinos** (não os do aviso do topo).
 *
 * A etiqueta de partida/chegada divide o texto com o aviso do topo — os dois
 * escrevem "Casa", por exemplo. O que separa os dois é a altura: o aviso vive no
 * alto da tela e a etiqueta viaja com o pino.
 */
const rotulosDosPinos = (f: ReturnType<typeof fakeCtx>, nomes: string[], altura: number) =>
  f.textos.filter((t, i) => nomes.includes(t) && f.textosYAbs[i] > altura * 0.35);

/**
 * Todas as etiquetas de um nome, com o retângulo que ocupam na tela.
 *
 * O retângulo vem do `roundRect` que desenha a etiqueta (medido pelo `fakeCtx`),
 * não de uma estimativa de largura — é a mesma caixa que o usuário vê.
 */
function etiquetasNaTela(f: ReturnType<typeof fakeCtx>, nomes: string[]) {
  const out: { nome: string; x0: number; x1: number; y0: number; y1: number; x: number; y: number }[] = [];
  f.textos.forEach((t, i) => {
    if (!nomes.includes(t)) return;
    const caixa = f.caixas[i];
    if (!caixa) return;
    out.push({ nome: t, ...caixa, x: f.textosXAbs[i], y: f.textosYAbs[i] });
  });
  return out;
}

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

describe("a virada nas curvas do traçado", () => {
  /**
   * Uma rota em zigue-zague: cada quina é uma mudança de 90° no rumo do
   * segmento — exatamente o que existe num GPX com pontos a cada poucos metros.
   */
  const zigue = (() => {
    const G = 1 / 111320;
    const pts: { lat: number; lng: number }[] = [];
    let x = 0;
    let y = 0;
    for (const [dx, dy] of [
      [800, 0],
      [0, 800],
      [-800, 0],
      [0, 800],
      [800, 0],
      [0, 800],
    ] as [number, number][]) {
      for (let i = 1; i <= 40; i++) {
        x += dx / 40;
        y += dy / 40;
        pts.push({ lat: -23.5 + y * G, lng: -46.6 + x * G });
      }
    }
    return buildTrack(pts);
  })();

  it("o rumo do traçado em quina não salta: é contínuo na distância", () => {
    // o defeito: a direção do segmento muda de um degrau só na quina
    const total = zigue.total;
    const degrau = (janela: number) => {
      let maior = 0;
      for (let i = 1; i <= 2000; i++) {
        const a = rumoSuave(zigue, (i - 1) / 2000, janela);
        const b = rumoSuave(zigue, i / 2000, janela);
        let d = Math.abs(b - a);
        if (d > 180) d = 360 - d;
        maior = Math.max(maior, d);
      }
      return maior;
    };
    // sem janela (o rumo do segmento) o salto na quina é de 90°
    expect(degrau(0)).toBeGreaterThan(60);
    // com a janela do vídeo, o maior passo entre dois pontos vizinhos é pequeno
    const janela = janelaDoRumo(total, 20);
    expect(degrau(janela)).toBeLessThan(3);
  });

  it("numa curva comum o teto de giro não entra: a virada é uma rampa", () => {
    /*
     * O "a cada curva parece que está pulando a imagem" era isto: com o alvo em
     * degraus, o teto de giro entrava em 21% dos quadros e o mapa girava em
     * rampa reta (a velocidade de giro pulava de 0 para o teto, e do teto para
     * 0). Com o rumo contínuo, a virada vira uma curva: o pico fica abaixo do
     * teto e a aceleração é pequena.
     */
    const r = new SceneRenderer("dark");
    const fps = 30;
    const serie: number[] = [];
    const N = 20 * fps;
    for (let i = 0; i <= N; i++) {
      const f = fakeCtx();
      r.render(f.ctx as never, 1280, 720, {
        ...estado(i / N, 20, null),
        track: zigue,
        elapsed: i / fps,
      });
      serie.push(r.rumoDoQuadro as number);
    }
    const saltos = serie.slice(1).map((v, i) => Math.abs(v - serie[i]));
    const maior = Math.max(...saltos);
    const teto = (75 / fps) * 1.001; // RUMO_MAX_GRAUS_S a 30 quadros/s
    expect(maior).toBeLessThan(teto * 0.8);
    // e nenhum quadro gira muito mais que o vizinho (a aceleração é pequena)
    const aceleracoes = saltos.slice(1).map((v, i) => Math.abs(v - saltos[i]));
    expect(Math.max(...aceleracoes)).toBeLessThan(0.35);
    // a rota é percorrida: o rumo passa pelas direções das pernas do zigue-zague
    expect(Math.abs(serie[serie.length - 1] - serie[0])).toBeGreaterThan(30);
  });
});

describe("o aviso do topo saiu de cena", () => {
  it("não há mais retângulo de notificação no alto do quadro", () => {
    /*
     * O pedido: "sem o toast em cima da tela". Quem anuncia a passagem é o pino
     * da parada — com a foto e o nome desenhados no mapa —, e a chegada é o pino
     * do B (que cresce) e a cartela final. O texto do aviso não existe mais.
     */
    const passagem = fakeCtx();
    desenhar(passagem.ctx, { ...estado(0.51, 14, null), ...comVolta() });
    const chegada = fakeCtx();
    desenhar(chegada.ctx, {
      ...estado(1, 14, null),
      endpoints: { a: null, b: LOCAL_B },
    });
    for (const txt of [...passagem.textos, ...chegada.textos]) {
      expect(txt).not.toContain("km do início");
      expect(txt).not.toContain("Percurso completo");
      expect(txt).not.toContain("Início do percurso");
    }
  });
});

describe("o nome da partida e da chegada", () => {
  const NOMES = ["Casa", "Cachoeira"];

  it("nunca sai da moldura, em nenhum instante e em nenhum formato", () => {
    /*
     * O pedido: "ajuste o nome do ponto A e B, fica fora da moldura". A etiqueta
     * era centrada no pino; com a câmera que acompanha, o pino vive encostado na
     * borda — e o nome saía pela metade.
     */
    /*
     * A varredura que encontrou o problema: cinco formatos (do 16:9 ao retrato
     * de celular) × quatro câmeras × 121 instantes. A conta da altura do bloco
     * tinha sido feita só para o 16:9 — no 9:16 a etiqueta saía 4 px abaixo do
     * rodapé, e era assim que o usuário via.
     */
    const formatos: [number, number][] = [
      [1280, 720],
      [1920, 1080],
      [960, 960],
      [864, 1080],
      [1080, 1920],
    ];
    const camaras: FrameState["camera"][] = [
      { mode: "follow", followZoom: 16 },
      { mode: "follow", followZoom: 13 },
      { mode: "follow", followZoom: 14.5, chase: { gira: false, tilt: true } },
      { mode: "fit", followZoom: 14 },
    ];
    let desenhadas = 0;
    let coladas = 0;
    for (const [w, h] of formatos) {
      for (const camera of camaras) {
        for (let k = 0; k <= 120; k++) {
          const elapsed = (k / 120) * 14;
          const t = Math.max(0, Math.min(1, elapsed / 14));
          const f = fakeCtx();
          desenhar(
            f.ctx,
            {
              ...estado(t, 14, null),
              camera,
              elapsed,
              // sem o aviso do topo: aqui só interessam as etiquetas dos pinos
              style: { ...style, showStops: false },
              endpoints: { a: LOCAL_A, b: LOCAL_B },
              photos: cacheComFoto,
            },
            track,
            w,
            h,
          );
          for (const e of etiquetasNaTela(f, NOMES)) {
            desenhadas++;
            // colada na borda = o caso que o deslize tem de resolver
            if (e.x0 < 70 || e.x1 > w - 70) coladas++;
            // a caixa vem do próprio desenho (o `roundRect` da etiqueta): não
            // há folga nenhuma a dar — nem um pixel para fora da moldura
            expect(e.x0).toBeGreaterThanOrEqual(-0.001);
            expect(e.x1).toBeLessThanOrEqual(w + 0.001);
            expect(e.y0).toBeGreaterThanOrEqual(-0.001);
            expect(e.y1).toBeLessThanOrEqual(h + 0.001);
          }
        }
      }
    }
    // o teste não pode passar por não ter desenhado nada: as etiquetas aparecem…
    expect(desenhadas).toBeGreaterThan(50);
    // …e o cenário inclui o caso difícil (etiqueta encostando na borda)
    expect(coladas).toBeGreaterThan(0);
  });

  it("sem o pino na tela, o nome não fica solto", () => {
    // trazer o nome para dentro da moldura com o pino já fora deixaria uma
    // etiqueta flutuando sobre o mapa, apontando para nada
    const semAviso = { ...style, showStops: false };
    const dentro = fakeCtx();
    desenhar(dentro.ctx, {
      ...estado(0.5, 14, null),
      style: semAviso,
      endpoints: { a: LOCAL_A, b: null },
      photos: cacheComFoto,
    });
    expect(dentro.textos).toContain("Casa");

    const fora = fakeCtx();
    desenhar(fora.ctx, {
      ...estado(0.5, 14, null),
      style: semAviso,
      camera: { mode: "follow", followZoom: 17 },
      endpoints: { a: LOCAL_A, b: null },
      photos: cacheComFoto,
    });
    expect(fora.textos).not.toContain("Casa");
  });

  it("a etiqueta fica acima ou abaixo do pino — nunca por cima do selo", () => {
    /*
     * O defeito que só apareceu na folha de imagens: o topo da etiqueta era
     * `-(r + gap)` — ou seja, ela começava 6 px acima do **centro** do pino e
     * cobria metade do selo. Depois do conserto, a caixa fica inteira de um dos
     * lados do círculo.
     */
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.98, 14, null),
      style: { ...style, showStops: false },
      endpoints: { a: LOCAL_A, b: LOCAL_B },
      photos: cacheComFoto,
    });
    // o selo do pino: um círculo de raio 17 no tamanho cheio (o fakeCtx anota o
    // raio como ele é pedido, dentro do `scale` do pipoco)
    const selos = f.arcosPos.filter((a) => Math.abs(a[2] - 17) < 0.01);
    expect(selos.length).toBeGreaterThan(0);
    const etiquetas = etiquetasNaTela(f, NOMES);
    expect(etiquetas.length).toBeGreaterThan(0);
    for (const e of etiquetas) {
      const pino = selos.reduce((melhor, a) =>
        Math.hypot(a[0] - e.x, a[1] - e.y) < Math.hypot(melhor[0] - e.x, melhor[1] - e.y) ? a : melhor,
      );
      const acima = e.y1 <= pino[1];
      const folga = acima ? pino[1] - e.y1 : e.y0 - pino[1];
      // a caixa inteira fora do selo (com a folga do `gap`), nunca atravessada
      expect(folga).toBeGreaterThanOrEqual(pino[2] + 1);
    }
  });

  it("com o pino na borda, a foto e o nome também ficam dentro da moldura", () => {
    // o caso do usuário: a chegada encostando na borda, com foto no lugar
    const f = fakeCtx();
    const w = 1280;
    const h = 720;
    desenhar(
      f.ctx,
      {
        ...estado(0.5, 14, null),
        style: { ...style, showStops: false },
        camera: { mode: "follow", followZoom: 16 },
        endpoints: { a: LOCAL_A, b: null },
        photos: cacheComFoto,
      },
      track,
      w,
      h,
    );
    for (const e of etiquetasNaTela(f, NOMES)) {
      expect(e.x0).toBeGreaterThanOrEqual(0);
      expect(e.x1).toBeLessThanOrEqual(w);
    }
  });

  it("o bloco desce quando não cabe em cima, e sobe quando não cabe embaixo", () => {
    expect(ladoDoBloco(500, 60, 720, 8)).toBe("acima");
    expect(ladoDoBloco(40, 60, 720, 8)).toBe("abaixo"); // colado no topo
    expect(ladoDoBloco(700, 60, 720, 8)).toBe("acima"); // colado na base
    // bloco enorme: só troca de lado quando não cabe em cima (300) nem embaixo (500)
    expect(ladoDoBloco(300, 400, 720, 8)).toBe("abaixo");
    expect(ladoDoBloco(500, 400, 720, 8)).toBe("acima");
    // e, sem caber em lugar nenhum, fica do lado com mais chão — nunca fora da tela
    expect(ladoDoBloco(100, 370, 720, 8)).toBe("abaixo");
    expect(ladoDoBloco(700, 370, 720, 8)).toBe("acima");
  });

  it("o deslize do bloco para dentro da moldura é o mínimo possível", () => {
    expect(centroDoBloco(640, 100, 1280, 8)).toBe(640); // no meio, não mexe
    expect(centroDoBloco(10, 100, 1280, 8)).toBe(58); // encostado à esquerda
    expect(centroDoBloco(1275, 100, 1280, 8)).toBe(1222); // encostado à direita
    // bloco maior que o quadro: centraliza em vez de pular de lado
    expect(centroDoBloco(100, 2000, 1280, 8)).toBe(640);
    // o pino continua embaixo da etiqueta: o deslocamento nunca passa do necessário
    expect(centroDoBloco(60, 100, 1280, 8) - 60).toBeLessThan(20);
  });
});

describe("partida e chegada no mesmo lugar", () => {
  /** Uma volta fechada: a partida e a chegada caem no mesmo ponto do mapa. */
  const G = 1 / 111320;
  const volta: { lat: number; lng: number }[] = [];
  {
    let x = 0;
    let y = 0;
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as [number, number][]) {
      for (let i = 0; i < 60; i++) {
        x += (dx * 700) / 60;
        y += (dy * 700) / 60;
        volta.push({ lat: -23.5 + y * G, lng: -46.6 + x * G });
      }
    }
    volta.push({ lat: -23.5, lng: -46.6 });
  }
  const anel = buildTrack(volta);
  // as duas pontas do trajeto: o pino da partida e o da chegada, com nomes
  // diferentes (é a coincidência dos nomes que a regra do "na frente" resolve)
  const PARTIDA = { ...LOCAL_A, label: "Casa" };
  const CHEGADA = { ...LOCAL_B, label: "Chegada" };
  const NOMES = ["Casa", "Chegada"];
  const camera: FrameState["camera"] = {
    mode: "follow",
    followZoom: 16,
    cinematic: { opening: true, stops: false, stopTs: [], chegada: true },
  };

  const rotulosEm = (elapsed: number, tl: Timeline) => {
    const f = fakeCtx();
    desenhar(
      f.ctx,
      {
        ...estado(Math.max(0, Math.min(1, (elapsed - tl.voo) / tl.percurso)), 16, null, null, null, tl),
        camera,
        elapsed,
        // sem o aviso do topo, que também escreve o nome do lugar
        style: { ...style, showStops: false },
        endpoints: { a: PARTIDA, b: CHEGADA },
        photos: cacheComFoto,
      },
      anel,
    );
    return rotulosDosPinos(f, NOMES, 0);
  };

  it("no início quem está na frente é a partida, e o nome é o dela", () => {
    const tl = buildTimeline(16, { voo: true, cartela: false });
    expect(rotulosEm(tl.voo, tl)).toEqual(["Casa"]);
    expect(rotulosEm(tl.voo + 0.4, tl)).toEqual(["Casa"]);
    // e no meio do percurso também: o pino da chegada ainda é o "fantasma"
    expect(rotulosEm(tl.voo + tl.percurso * 0.5, tl)).toEqual(["Casa"]);
  });

  it("no fim a chegada passa por cima e toma o nome", () => {
    const tl = buildTimeline(16, { voo: true, cartela: false });
    const fim = routeEnd(tl);
    // o pipoco da chegada começa 0,7 s antes de ela chegar
    expect(rotulosEm(fim - 1.2, tl)).toEqual(["Casa"]);
    expect(rotulosEm(fim - 0.3, tl)).toEqual(["Chegada"]);
    expect(rotulosEm(fim, tl)).toEqual(["Chegada"]);
  });

  it("na cartela final quem fica na frente continua sendo a chegada", () => {
    const tl = buildTimeline(16, { voo: true, cartela: true });
    expect(rotulosEm(routeEnd(tl) + 1.5, tl)).toEqual(["Chegada"]);
  });

  it("com as duas pontas longe uma da outra, cada pino tem o seu nome", () => {
    // fora da coincidência, os dois nomes aparecem — a regra do “na frente” só
    // vale quando os dois pinos caem no mesmo lugar
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 14, null),
      style: { ...style, showStops: false },
      camera: { mode: "fit", followZoom: 16 },
      endpoints: { a: LOCAL_A, b: LOCAL_B },
      photos: cacheComFoto,
    });
    expect(f.textos).toContain("Casa");
    expect(f.textos).toContain("Cachoeira");
  });
});

/* ------------------------------------------------------------------ */
/* A emenda dos blocos de mapa                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* O orçamento de blocos com a aproximação das paradas                 */
/* ------------------------------------------------------------------ */

/** Traçado reto de `km` quilômetros (o mesmo formato do teste do orçamento). */
function percursoLongo(km: number, n = 4000) {
  const graus = km / 111.32;
  return Array.from({ length: n }, (_, i) => ({
    lat: -23.5 + (i / (n - 1)) * graus,
    lng: -48.4 + (i / (n - 1)) * graus * 0.35,
  }));
}

describe("o foco no ícone do ponto", () => {
  /* a rota do usuário — 21,4 km — com uma parada em cima da linha e uma fora */
  const CAMINHO = buildTrack(percursoLongo(21.4));
  const NO_PONTO = sampleTrack(CAMINHO, 0.6).pos;
  const LONGE = 440; // metros ao norte da linha
  const paradaFora = parada({
    t: 0.6,
    pos: {
      lat: NO_PONTO.lat,
      lng: NO_PONTO.lng + LONGE / (111_320 * Math.cos((NO_PONTO.lat * Math.PI) / 180)),
    },
  });
  const paradaNaLinha = parada({ t: 0.6 });
  const cameraComFoco = (terceira: boolean) => ({
    mode: "follow" as const,
    followZoom: 15,
    chase: terceira ? { gira: false, tilt: false } : undefined,
    cinematic: { opening: false, stops: true, stopTs: [0.6], chegada: false },
  });

  /**
   * A animação inteira a 30 quadros por segundo, com a câmera de verdade.
   *
   * O renderizador é **um só** de ponta a ponta, como na exportação: é a
   * suavização da câmera (e o adiantamento do alvo) que decide onde o quadro
   * cai. Um quadro isolado não mede isso — o primeiro quadro de um renderizador
   * novo já está no alvo, sem atraso nenhum para compensar.
   *
   * Devolve o quadro do **pico do zoom desenhado** (a câmera suavizada dentro do
   * renderizador, que é o que o usuário vê) e a posição do **personagem** em
   * todos os quadros.
   */
  const animacao = (
    terceira: boolean,
    alvo: ReturnType<typeof parada>,
    tamanho: { w: number; h: number } = { w: 1280, h: 720 },
  ) => {
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const r = new SceneRenderer("dark");
    const emoji = findCharacter("car").emoji;
    const quadros: {
      t: number;
      zoom: number;
      x: number;
      y: number;
      xSelo: number;
      ySelo: number;
    }[] = [];
    for (let seg = 0; seg <= tl.percurso + 1e-6; seg += 1 / 30) {
      const t = routeProgress(tl, seg);
      const f = fakeCtx();
      r.render(f.ctx, tamanho.w, tamanho.h, {
        ...estado(t, 14, null, null, null, tl),
        track: CAMINHO,
        stops: [alvo],
        camera: cameraComFoco(terceira),
      });
      const k = f.textos.indexOf(emoji);
      const selo = f.arcosPos.filter((a) => a[2] > 15 && a[2] < 20)[0];
      quadros.push({
        t,
        zoom: (r as unknown as { cam: { zoom: number } | null }).cam?.zoom ?? NaN,
        x: f.textosXAbs[k] ?? NaN,
        y: f.textosYAbs[k] ?? NaN,
        xSelo: selo ? selo[0] : NaN,
        ySelo: selo ? selo[1] : NaN,
      });
    }
    const pico = quadros.reduce((a, b) => (b.zoom > a.zoom ? b : a));
    return {
      quadros,
      pico,
      /** segundos de vídeo entre o pico e a parada (é a unidade da ênfase) */
      atraso: Math.abs(pico.t - 0.6) * tl.percurso,
      linha: terceira ? tamanho.h * CHASE_ALTURA : tamanho.h / 2,
    };
  };

  /*
   * O pedido desta rodada: *"está até perdendo o personagem do trajeto quando
   * vai dar o zoom no ponto"*.
   *
   * O pino da parada pode estar longe da linha (o usuário arrasta o pino até a
   * igreja, a cachoeira) e o quadro ia inteiro até ele no ganho cheio de zoom:
   * numa parada a 440 m da linha o personagem saía da moldura — e o vídeo
   * ficava sem ele justamente no momento da parada.
   */
  it("o personagem não sai da moldura em nenhum quadro — nem com o pino fora da linha", () => {
    for (const terceira of [false, true]) {
      for (const alvo of [paradaNaLinha, paradaFora]) {
        const { quadros } = animacao(terceira, alvo);
        const fora = quadros.filter((q) => q.x < 0 || q.x > 1280 || q.y < 0 || q.y > 720);
        expect(fora.length).toBe(0);
      }
    }
  });

  it("a parada fora da linha também não joga o quadro fora do personagem", () => {
    // o quadro desliza até o ponto, mas para onde o personagem ainda aparece: a
    // distância entre os dois, em pixels, é menor que o quadro
    for (const terceira of [false, true]) {
      const { pico, quadros } = animacao(terceira, paradaFora);
      const emoji = quadros.find((q) => Math.abs(q.t - pico.t) < 1e-9);
      expect(emoji).toBeDefined();
      // e o ponto da parada continua dentro do quadro no pico da aproximação
      expect(pico.ySelo).toBeGreaterThan(0);
      expect(pico.ySelo).toBeLessThan(720);
    }
  });

  it("numa parada em cima da linha, o pico do zoom cai em cima do ponto", () => {
    /*
     * Com o pino na linha a distância é de metros e o ganho de zoom é o cheio:
     * o pico do zoom **desenhado** cai sobre o ponto (era 297 m depois dele
     * antes do adiantamento do alvo, medido no GPX do usuário).
     */
    for (const terceira of [false, true]) {
      const { atraso } = animacao(terceira, paradaNaLinha);
      expect(atraso).toBeLessThan(0.05);
    }
  });

  /*
   * A outra metade do pedido continua de pé: a parada **aproxima**.
   *
   * Limitar o deslocamento para não perder o personagem não pode virar "a
   * câmera não vai a lugar nenhum". Numa parada a 440 m da linha, em 720x1280,
   * o selo do pino chega a **15,8 px** do centro do quadro de cima e a **144 px**
   * na terceira pessoa (onde o personagem fica a 68% da altura, com menos espaço
   * embaixo, e o deslocamento tem de ser menor). Sem o deslocamento ele ficaria
   * a 568 px — fora do quadro.
   */
  it("a parada fora da linha continua sendo levada ao centro", () => {
    for (const terceira of [false, true]) {
      const { quadros } = animacao(terceira, paradaFora, { w: 720, h: 1280 });
      const centro = { x: 360, y: 640 };
      const perto = Math.min(
        ...quadros
          .filter((q) => Number.isFinite(q.xSelo) && Number.isFinite(q.ySelo))
          .map((q) => Math.hypot(q.xSelo - centro.x, q.ySelo - centro.y)),
      );
      // medido: 15,8 px de cima e 144,4 px na terceira pessoa
      expect(perto).toBeLessThan(200);
    }
  });

  it("longe de qualquer ponto, o enquadramento é o de sempre", () => {
    // o peso da ênfase é a própria força da aproximação: a zero, nada muda
    const emoji = findCharacter("car").emoji;
    const personagem = (comFoco: boolean) => {
      const f = fakeCtx();
      desenhar(f.ctx, {
        ...estado(0.2, 14, null), // bem longe da parada de t = 0,6
        stops: [paradaFora],
        camera: {
          mode: "follow",
          followZoom: 15,
          chase: { gira: false, tilt: false },
          cinematic: { opening: false, stops: comFoco, stopTs: [0.6], chegada: false },
        },
      });
      return f.textosYAbs[f.textos.indexOf(emoji)];
    };
    expect(personagem(true)).toBeCloseTo(personagem(false), 6);
  });
});

/*
 * O buraco do nível de zoom que ainda não chegou.
 *
 * O desenho pede o bloco do nível em vigor. Quando a câmera muda de nível — o
 * zoom da parada são 2,2 níveis de uma vez — o nível novo não está no mapa, e o
 * que ficava no lugar era **nada**: um pedaço do fundo no meio do quadro até o
 * bloco chegar. É o "mapa pulando" que o usuário viu no arquivo dele. Com o pai
 * esticado, o buraco não existe: aparece a imagem do nível anterior, borrada por
 * um instante, no lugar certo.
 */
describe("o bloco que ainda não chegou", () => {
  const imagem = (lado = TILE_SIZE) => ({ width: lado, height: lado }) as unknown as never;
  const guardado = (
    blocos: Record<string, ReturnType<typeof imagem>>,
  ): { get: (z: number, x: number, y: number) => never | null } => ({
    get: (z, x, y) => blocos[`${z}/${x}/${y}`] ?? null,
  });

  it("o pai cobre o filho: o recorte é o pedaço certo da imagem", () => {
    // o filho 18/5/3 fica no canto de baixo-direita do pai 17/2/1
    const pai = imagem();
    const pega = blocoDeReserva(guardado({ "17/2/1": pai }), 18, 5, 3);
    expect(pega?.img).toBe(pai);
    expect([pega?.sx, pega?.sy, pega?.sw, pega?.sh]).toEqual([128, 128, 128, 128]);
  });

  it("o canto superior esquerdo do pai é o filho par", () => {
    const pega = blocoDeReserva(guardado({ "17/2/1": imagem() }), 18, 4, 2);
    expect([pega?.sx, pega?.sy]).toEqual([0, 0]);
  });

  it("sobe mais de um nível quando o pai também não está lá", () => {
    // sem o 17/2/1, o avô 16/1/0 cobre o 18/5/3 — que é 1/4 dele
    const pega = blocoDeReserva(guardado({ "16/1/0": imagem() }), 18, 5, 3);
    expect([pega?.sx, pega?.sy, pega?.sw, pega?.sh]).toEqual([64, 192, 64, 64]);
  });

  it("o tamanho real da imagem manda (bloco de 512 do retina)", () => {
    const pega = blocoDeReserva(guardado({ "17/2/1": imagem(512) }), 18, 5, 3);
    expect([pega?.sx, pega?.sy, pega?.sw, pega?.sh]).toEqual([256, 256, 256, 256]);
  });

  it("sem nenhum ancestral no mapa, não há o que desenhar", () => {
    expect(blocoDeReserva(guardado({}), 18, 5, 3)).toBeNull();
    // e o nível 0 não tem pai: não desce abaixo do zero
    expect(blocoDeReserva(guardado({ "-1/0/0": imagem() }), 0, 0, 0)).toBeNull();
  });

  it("um quadro com o nível novo faltando desenha o pai no lugar do buraco", () => {
    /*
     * A conta do quadro é a do desenho, com a câmera de verdade: os blocos
     * pedidos no primeiro quadro são os que o renderizador vai buscar (o alvo da
     * câmera anda 0,1 s à frente do relógio, então o quadro não é exatamente o da
     * rota — daí pedir a lista em vez de calculá-la à mão).
     */
    const caminho = buildTrack(percursoLongo(12));
    const camera = { mode: "follow" as const, followZoom: 15 };
    const quadro = {
      ...estado(0.3, 14, null),
      track: caminho,
      camera,
      style: {
        ...style,
        showRoute: false,
        showTraveled: false,
        showEndpoints: false,
        showStops: false,
        showHud: false,
        showSummary: false,
        showProgress: false,
        showTitle: false,
      },
    };
    const pedidos: [number, number, number][] = [];
    const r = new SceneRenderer("dark");
    const req = r.tiles.request.bind(r.tiles);
    r.tiles.request = (z: number, x: number, y: number) => {
      pedidos.push([z, x, y]);
      req(z, x, y);
    };

    // 1) sem mapa nenhum: buraco — nenhum bloco desenhado
    const vazio = fakeCtx();
    r.render(vazio.ctx, 1280, 720, quadro);
    expect(pedidos.length).toBeGreaterThan(10);
    expect(vazio.imagens.length).toBe(0);

    // 2) com só o nível anterior (o pai de cada bloco pedido), o quadro é
    //    desenhado: um recorte de pai para cada bloco, nenhum buraco
    const comPai = new SceneRenderer("dark");
    for (const [z, x, y] of pedidos) {
      comPai.tiles.put(z - 1, Math.floor(x / 2), Math.floor(y / 2), imagem() as never);
    }
    const f = fakeCtx();
    comPai.render(f.ctx, 1280, 720, quadro);
    expect(f.imagens.length).toBe(pedidos.length);
    // todos pelo caminho do pai (o desenho do bloco exato tem 4 argumentos; o do
    // pai, 8: o recorte de origem e o retângulo de destino)
    expect(f.imagens.every((i) => i.args.length === 8)).toBe(true);
  });

  /*
   * O mapa que troca de bloco no meio da gravação.
   *
   * Medido quadro a quadro no mp4 do usuário: as mudanças grandes da imagem não
   * eram deslocamento (nenhuma faixa andava junto com as outras) — era **troca de
   * textura**, um bloco chegando e substituindo o nível anterior que estava no
   * lugar. Na gravação em tempo real isso acontece no meio do vídeo, e é o
   * "continua travando" que ele vê. Com a lista de congelados, o que entrou no
   * primeiro quadro fica até o fim.
   */
  it("sem a lista, o bloco exato entra assim que chega", () => {
    const blocos: Record<string, unknown> = { "17/2/1": imagem() };
    const store = { get: (z: number, x: number, y: number) => (blocos[`${z}/${x}/${y}`] ?? null) as never };
    expect("reserva" in (blocoDoQuadro(store, 18, 5, 3, null) ?? {})).toBe(true);
    blocos["18/5/3"] = imagem();
    expect(blocoDoQuadro(store, 18, 5, 3, null)).toEqual({ img: blocos["18/5/3"] });
  });

  it("com a lista, quem caiu no nível anterior fica nele até o fim", () => {
    const blocos: Record<string, unknown> = { "17/2/1": imagem() };
    const store = { get: (z: number, x: number, y: number) => (blocos[`${z}/${x}/${y}`] ?? null) as never };
    const congelados = new Set<string>();
    const primeiro = blocoDoQuadro(store, 18, 5, 3, congelados);
    expect("reserva" in (primeiro ?? {})).toBe(true);
    expect([...congelados]).toEqual(["18/5/3"]);
    // o bloco exato chegou no meio da gravação: e **não** entra no lugar
    blocos["18/5/3"] = imagem();
    expect(blocoDoQuadro(store, 18, 5, 3, congelados)).toEqual(primeiro);
  });

  it("sem nada no mapa, não há o que congelar", () => {
    const store = { get: () => null as never };
    const congelados = new Set<string>();
    expect(blocoDoQuadro(store, 18, 5, 3, congelados)).toBeNull();
    expect(congelados.size).toBe(0);
  });

  it("a gravação conta quantos blocos saíram do nível anterior", () => {
    const caminho = buildTrack(percursoLongo(12));
    const quadro = {
      ...estado(0.3, 14, null),
      track: caminho,
      camera: { mode: "follow" as const, followZoom: 15 },
      style: {
        ...style,
        showRoute: false,
        showTraveled: false,
        showEndpoints: false,
        showStops: false,
        showHud: false,
        showSummary: false,
        showProgress: false,
        showTitle: false,
      },
    };
    const r = new SceneRenderer("dark");
    const pedidos: [number, number, number][] = [];
    const req = r.tiles.request.bind(r.tiles);
    r.tiles.request = (z: number, x: number, y: number) => {
      pedidos.push([z, x, y]);
      req(z, x, y);
    };

    // 1) o primeiro quadro pede os blocos do nível em vigor (o mapa está vazio)
    r.render(fakeCtx().ctx, 1280, 720, quadro);
    expect(pedidos.length).toBeGreaterThan(3);

    // 2) só o nível anterior no mapa, e a gravação começa: o quadro é do pai
    for (const [z, x, y] of pedidos) {
      r.tiles.put(z - 1, Math.floor(x / 2), Math.floor(y / 2), imagem() as never);
    }
    r.congelarBlocos(true);
    const um = fakeCtx();
    r.render(um.ctx, 1280, 720, quadro);
    expect(um.imagens.length).toBeGreaterThan(3);
    expect(um.imagens.every((i) => i.args.length === 8)).toBe(true);
    const travados = r.blocosDeReserva;
    expect(travados).toBe(um.imagens.length);

    // 3) os blocos exatos chegam no meio da gravação: o quadro **não** muda
    for (const [z, x, y] of pedidos) r.tiles.put(z, x, y, imagem() as never);
    const dois = fakeCtx();
    r.render(dois.ctx, 1280, 720, quadro);
    expect(dois.imagens.length).toBe(um.imagens.length);
    expect(dois.imagens.every((i) => i.args.length === 8)).toBe(true);
    expect(r.blocosDeReserva).toBe(travados);
  });});

describe("o aquecimento dos blocos na parada", () => {
  /* a mesma parada fora da linha do outro describe, na rota de 21,4 km */
  const CAMINHO = buildTrack(percursoLongo(21.4));
  const NO_PONTO = sampleTrack(CAMINHO, 0.6).pos;
  const FORA = parada({
    t: 0.6,
    pos: {
      lat: NO_PONTO.lat,
      lng: NO_PONTO.lng + 440 / (111_320 * Math.cos((NO_PONTO.lat * Math.PI) / 180)),
    },
  });
  const camera = { mode: "follow" as const, followZoom: 15, chase: { gira: false, tilt: true } };
  const cine = { opening: false, stops: true, stopTs: [0.6], chegada: false };
  const chave = (t: { z: number; x: number; y: number }) => `${t.z}/${t.x}/${t.y}`;

  /** A vista que o desenho mostra no pico da aproximação. */
  const vistaDoPico = () => {
    const alvo = poiLatLng(FORA, CAMINHO);
    const boost = boostQueCabe(camera, 1080, 1920, haversine(NO_PONTO, alvo), NO_PONTO.lat);
    const zoom = zoomEfetivo(camera) + boost;
    const matriz = vistaDe({
      centro: NO_PONTO,
      zoom,
      width: 1080,
      height: 1920,
      maxZoom: 19,
      altura: CHASE_ALTURA,
      angulo: 0,
      tilt: CHASE_TILT,
    });
    const peso = pesoQueCabe(matriz, NO_PONTO, alvo, CHASE_ALTURA, 1080, 1920);
    return vistaDe({
      centro: {
        lat: NO_PONTO.lat + (alvo.lat - NO_PONTO.lat) * peso,
        lng: NO_PONTO.lng + (alvo.lng - NO_PONTO.lng) * peso,
      },
      zoom,
      width: 1080,
      height: 1920,
      maxZoom: 19,
      altura: CHASE_ALTURA,
      angulo: 0,
      tilt: CHASE_TILT,
    });
  };

  it("o aquecimento traz os blocos do lugar da parada — o que o vídeo desenha", () => {
    /*
     * O defeito: o aquecimento pedia os blocos do **ponto da rota** com o ganho
     * cheio de zoom, e o desenho mostrava o **lugar** da parada (o pino pode
     * estar longe da linha) com o ganho que cabe. Os blocos do quadro que
     * aparece na tela não estavam baixados: o vídeo saía borrado e travava
     * esperando o mapa, justamente na parada.
     */
    const comFoco = new Set(
      tilesForAnimation(CAMINHO, camera, 1080, 1920, "dark", cine, () => poiLatLng(FORA, CAMINHO)).map(chave),
    );
    const vista = vistaDoPico();
    for (const [z, x, y] of tilesDaVista(vista)) {
      expect(comFoco.has(`${z}/${x}/${y}`)).toBe(true);
    }
  });

  it("o `warmup` do renderizador baixa os blocos do lugar da parada", async () => {
    /*
     * O defeito da rodada: o `warmup` chamava `tilesForAnimation` **sem** o foco,
     * então baixava a vista da parada no ponto da **rota** — e o desenho, com o
     * pino fora da linha, ia buscar outros blocos durante a gravação. Era o mapa
     * aparecendo aos pedaços (o "mapa pulando") na aproximação.
     */
    const blocos = { width: 256, height: 256 };
    const pedir = async (comFoco: boolean) => {
      const r = new SceneRenderer("dark");
      const pedidos = new Set<string>();
      r.tiles.fetchTile = async (z: number, x: number, y: number) => {
        pedidos.add(`${z}/${x}/${y}`);
        return blocos as never;
      };
      await r.warmup(
        CAMINHO,
        { ...camera, cinematic: cine },
        1080,
        1920,
        () => undefined,
        comFoco ? () => poiLatLng(FORA, CAMINHO) : null,
      );
      return { pedidos, baixados: r.loadedTiles };
    };

    const com = await pedir(true);
    const sem = await pedir(false);
    // o pico da aproximação (o quadro que o vídeo mostra) está coberto…
    const pico = tilesDaVista(vistaDoPico());
    expect(pico.length).toBeGreaterThan(0);
    for (const [z, x, y] of pico) expect(com.pedidos.has(`${z}/${x}/${y}`)).toBe(true);
    // …e sem o foco aqueles blocos não seriam pedidos (é o defeito, de volta)
    expect(pico.some(([z, x, y]) => !sem.pedidos.has(`${z}/${x}/${y}`))).toBe(true);
    // e o que foi pedido está de fato no mapa, pronto para desenhar
    expect(com.baixados).toBe(com.pedidos.size);
  });

  /*
   * O `preparar`: baixar, **insistir** no que falhou e **contar** o que sobrou.
   *
   * O usuário recebeu "233 blocos do mapa não estavam prontos" no fim de uma
   * gravação: os servidores gratuitos recusaram parte dos downloads e o app
   * seguia em frente em silêncio, com o mapa borrado no vídeo inteiro. Agora a
   * falha tem novas tentativas, e o que sobrar é contado **antes** do primeiro
   * quadro.
   */
  it("o `preparar` insiste nos blocos que falharam e termina com zero faltando", async () => {
    const r = new SceneRenderer("dark");
    const tentativas = new Map<string, number>();
    const bloco = { width: 256, height: 256 };
    r.tiles.fetchTile = async (z: number, x: number, y: number) => {
      const k = `${z}/${x}/${y}`;
      const n = (tentativas.get(k) ?? 0) + 1;
      tentativas.set(k, n);
      // a primeira rodada falha inteira: é o caso da rajada recusada
      return n === 1 ? null : (bloco as never);
    };

    const { total, faltando } = await r.preparar(
      CAMINHO,
      { ...camera, cinematic: cine },
      1080,
      1920,
      () => undefined,
      null,
    );

    expect(total).toBe(tentativas.size);
    expect(total).toBeGreaterThan(0);
    expect(faltando).toBe(0);
    // todo bloco foi pedido de novo — nenhum ficou faltando em silêncio
    expect([...tentativas.values()].every((n) => n >= 2)).toBe(true);
    expect(r.loadedTiles).toBe(total);
  });

  it("conta os blocos que não chegaram nem depois das tentativas", async () => {
    const r = new SceneRenderer("dark");
    const pedidos = new Set<string>();
    r.tiles.fetchTile = async (z: number, x: number, y: number) => {
      pedidos.add(`${z}/${x}/${y}`);
      return null;
    };

    const { total, faltando } = await r.preparar(
      CAMINHO,
      { ...camera, cinematic: cine },
      1080,
      1920,
      () => undefined,
      null,
    );

    expect(total).toBe(pedidos.size);
    expect(faltando).toBe(total);
    expect(r.loadedTiles).toBe(0);
  });

  it("não repete o download de quem chegou na primeira tentativa", async () => {
    const r = new SceneRenderer("dark");
    const tentativas = new Map<string, number>();
    const bloco = { width: 256, height: 256 };
    r.tiles.fetchTile = async (z: number, x: number, y: number) => {
      const k = `${z}/${x}/${y}`;
      tentativas.set(k, (tentativas.get(k) ?? 0) + 1);
      // uma em cada três falha na primeira rodada
      const primeiro = tentativas.get(k) === 1;
      return primeiro && (x + y) % 3 === 0 ? null : (bloco as never);
    };

    const { total, faltando } = await r.preparar(
      CAMINHO,
      { ...camera, cinematic: cine },
      1080,
      1920,
      () => undefined,
      null,
    );

    expect(faltando).toBe(0);
    expect(total).toBe(tentativas.size);
    for (const [k, n] of tentativas) {
      const [z, x, y] = k.split("/").map(Number);
      expect(n).toBe(z === z && (x + y) % 3 === 0 ? 2 : 1);
    }
  });

  it("sem o foco, os blocos do lugar da parada ficavam de fora", () => {
    // é o que o app fazia antes: o foco (e portanto a vista) era o ponto da rota
    const semFoco = new Set(
      tilesForAnimation(CAMINHO, camera, 1080, 1920, "dark", cine).map(chave),
    );
    const faltando = tilesDaVista(vistaDoPico()).filter((t) => !semFoco.has(`${t[0]}/${t[1]}/${t[2]}`));
    expect(faltando.length).toBeGreaterThan(0);
  });
});

describe("o orçamento de blocos com a aproximação das paradas", () => {
  const camera = { mode: "follow" as const, followZoom: 16, chase: { gira: false, tilt: true } };
  const sete = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
  const contar = (km: number, comParadas: boolean) =>
    tilesForAnimation(
      buildTrack(percursoLongo(km)),
      camera,
      1080,
      1920,
      "dark",
      comParadas ? { opening: false, stops: true, stopTs: sete, chegada: true } : null,
    ).length;

  it("a parada perde o ganho de zoom antes de a exportação ser recusada", () => {
    /*
     * Números medidos (1080x1920, terceira pessoa, mapa escuro, zoom 16): uma
     * rota de 20 km pede **750** blocos sozinha; com as sete paradas, **1395** —
     * no teto (1400), mas dentro. O que segura isso é a pergunta "esta vista
     * cabe?" feita **antes** de acrescentá-la: sem ela, a última parada estourava
     * e a exportação era recusada por causa da aproximação — que é um ganho, e
     * não pode ser o motivo de o vídeo não sair.
     */
    const sem = contar(20, false);
    const com = contar(20, true);
    expect(com).toBeLessThanOrEqual(TILE_BUDGET);
    expect(com).toBeGreaterThan(sem); // e a aproximação de fato entrou
    expect(com).toBeGreaterThan(TILE_BUDGET - 200); // …encostando no teto
  });

  it("numa rota que já estoura sozinha, a parada não piora a conta", () => {
    // 40 km: a rota sozinha passa do teto — e aí não entra nenhuma vista de
    // parada (o aviso de "reduza o zoom" é sobre a rota, não sobre a ênfase)
    const sem = contar(40, false);
    expect(sem).toBeGreaterThan(TILE_BUDGET);
    expect(contar(40, true)).toBe(sem);
  });
});

describe("a emenda dos blocos de mapa", () => {
  /** A matriz com que os blocos são desenhados (o `setTransform` do quadro). */
  const matriz = (f: ReturnType<typeof fakeCtx>) => {
    const m = f.transforms.find((t) => t.length === 6);
    expect(m).toBeDefined();
    return m as number[];
  };

  /** Os blocos desenhados no quadro (4 argumentos e tamanho de bloco). */
  const blocos = (f: ReturnType<typeof fakeCtx>) =>
    f.imagens.filter((i) => i.args.length === 4 && i.args[2] > 250 && i.args[2] < 264);

  /**
   * Um quadro com o mapa **pronto**.
   *
   * O `request` do store é assíncrono (baixa e filtra o bloco), e num teste nada
   * chega: aqui ele entrega na hora uma imagem de mentira, que é o que faz o
   * laço de desenho dos blocos rodar de verdade.
   */
  const desenharComMapa = (ctx: CanvasRenderingContext2D, st: FrameState) => {
    const r = new SceneRenderer("dark");
    const store = r.tiles;
    const bloco = { width: 256, height: 256 } as unknown as CanvasImageSource;
    store.request = (z: number, x: number, y: number) => {
      store.put(z, x, y, bloco as never);
    };
    r.render(ctx, 1280, 720, { ...st, track });
    return r;
  };

  const quadroDeBlocos = (followZoom: number, chase?: { gira: boolean; tilt?: boolean }) => {
    const f = fakeCtx();
    desenharComMapa(f.ctx, {
      ...estado(0.5, 14, null),
      camera: { mode: "follow", followZoom, chase },
      style: {
        ...style,
        showRoute: false,
        showTraveled: false,
        showEndpoints: false,
        showStops: false,
        showHud: false,
        showSummary: false,
        showProgress: false,
        showTitle: false,
      },
    });
    return f;
  };

  it("a imagem do mapa anda com a câmera, sem dente de serra", () => {
    /*
     * O defeito que o usuário viu ("melhorar o degrau das imagens, suavizar"): a
     * borda de cada bloco era **presa na grade de pixels** (`Math.round`) para
     * fechar a emenda — e com isso a imagem do mapa andava aos pulos, presa por
     * alguns quadros e pulando 1 px de uma vez, enquanto a rota e o personagem
     * andavam liso. Medido na bancada: com a câmera andando 0,2 px, a borda de um
     * bloco andava 0,8 px e depois 0 px.
     */
    const base = vistaDe({
      centro: { lat: -23.5, lng: -48.4 },
      zoom: 16.4,
      width: 1280,
      height: 720,
    });
    // a escala não é inteira: é justamente o caso em que a borda quebrava
    expect(base.b).toBeCloseTo(0, 9);
    expect(base.c).toBeCloseTo(0, 9);
    expect(Math.abs(base.a - Math.round(base.a))).toBeGreaterThan(0.1);

    const bordas: number[] = [];
    for (const passo of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const v = { ...base, e: base.e + passo };
      const r = retanguloDoBloco(v, 0, 0, TILE_SIZE);
      bordas.push(v.a * r.x + v.e);
    }
    for (let i = 1; i < bordas.length; i++) {
      // a borda anda **o mesmo tanto** que a câmera andou: nada de ficar presa
      // num quadro e pular de 1 px no seguinte (o `e` do mundo é da ordem de
      // 10⁷, então a conta perde os últimos dígitos — daí a tolerância)
      expect(bordas[i] - bordas[i - 1]).toBeCloseTo(0.2, 6);
    }
    // e a folga é meio pixel de tela de cada lado, simétrica em volta do bloco
    // o bloco está no (0,0) do mundo: o que se mede é a folga, em pixels
    const r = retanguloDoBloco(base, 0, 0, TILE_SIZE);
    expect(base.a * r.x).toBeCloseTo(-SANGRIA_PX, 6);
    expect(base.a * (r.x + r.w)).toBeCloseTo(base.a * TILE_SIZE + SANGRIA_PX, 6);
    expect(base.d * r.y).toBeCloseTo(-SANGRIA_PX, 6);
    expect(base.d * (r.y + r.h)).toBeCloseTo(base.d * TILE_SIZE + SANGRIA_PX, 6);
  });

  it("a matriz não carrega o mundo inteiro (é o que fecha a emenda no 9:16)", () => {
    /*
     * As coordenadas do mundo no zoom do mapa são enormes (dezenas de milhões) e
     * somadas na matriz estouram a precisão do rasterizador: a borda de dois
     * blocos vizinhos cai fora do lugar e o fundo do mapa aparece como um fio de
     * 1 px. Medido numa tela 1080x1920 com a inclinação da terceira pessoa: uma
     * linha inteira do quadro (832 px de fundo à mostra numa emenda).
     *
     * A defesa é desenhar cada bloco com a origem no **canto da vista**: o
     * `drawImage` recebe coordenadas na casa dos milhares, e não dos milhões.
     */
    const f = quadroDeBlocos(15.7);
    const desenhados = blocos(f);
    expect(desenhados.length).toBeGreaterThan(4);
    for (const i of desenhados) {
      expect(Math.abs(i.args[0])).toBeLessThan(100_000);
      expect(Math.abs(i.args[1])).toBeLessThan(100_000);
    }
  });

  it("dois vizinhos compartilham exatamente a borda (sem fresta e sem sobreposição)", () => {
    const f = quadroDeBlocos(16.4);
    const [a, , , d, e, fy] = matriz(f);
    const desenhados = blocos(f);
    // uma fileira de blocos: as bordas direita/esquerda têm de encostar
    const porFileira = new Map<number, number[]>();
    for (const i of desenhados) {
      const Y0 = Math.round(d * i.args[1] + fy);
      const lista = porFileira.get(Y0) ?? [];
      lista.push(a * i.args[0] + e);
      porFileira.set(Y0, lista);
    }
    let emendas = 0;
    for (const colunas of porFileira.values()) {
      colunas.sort((p, q) => p - q);
      expect(colunas.length).toBeGreaterThan(1);
      for (let i = 1; i < colunas.length; i++) {
        /*
         * A fronteira de um é a fronteira do outro, na largura exata do bloco na
         * tela (256·a): a folga é a mesma nos dois, então ela só **sobrepõe** a
         * emenda (é o que fecha a fresta) e nunca abre espaço. Se a diferença
         * fosse maior, haveria fresta.
         */
        expect(Math.abs(colunas[i] - colunas[i - 1] - 256 * a)).toBeLessThan(1e-9);
        emendas++;
        // e a sobra é **meio pixel de cada lado**: 1 px de tela de sobreposição
        expect(2 * SANGRIA_PX).toBeCloseTo(1, 9);
      }
    }
    expect(emendas).toBeGreaterThan(3);
  });

  it("o bloco desenhado é o exato mais meio pixel de folga de cada lado", () => {
    // é essa sobra que fecha a emenda: o que um deixa de cobrir na fronteira, o
    // vizinho cobre — e ela é pequena, nada de bloco esticado na tela
    const f = quadroDeBlocos(15.7);
    const [a, , , d, ,] = matriz(f);
    const desenhados = blocos(f);
    expect(desenhados.length).toBeGreaterThan(4);
    for (const i of desenhados) {
      expect(a * i.args[2]).toBeCloseTo(a * TILE_SIZE + 2 * SANGRIA_PX, 6);
      expect(d * i.args[3]).toBeCloseTo(d * TILE_SIZE + 2 * SANGRIA_PX, 6);
    }
  });

  it("com o mapa girado, o bloco ganha a folga que cobre a emenda", () => {
    /*
     * Com giro não há grade de pixels a seguir (as bordas dos blocos são
     * oblíquas): aí a folga de meio pixel em cada lado é o que garante que a
     * emenda não fique por conta da cobertura do rasterizador.
     */
    const f = quadroDeBlocos(15, { gira: true, tilt: false });
    const [a, b, c, , e, fy] = matriz(f);
    expect(Math.abs(b) + Math.abs(c)).toBeGreaterThan(0.1); // está girado
    const desenhados = blocos(f);
    expect(desenhados.length).toBeGreaterThan(4);
    const [b0, c0, d0, e0, f0] = [b, c, matriz(f)[3], e, fy];
    /** a caixa na tela dos quatro cantos de um retângulo do mundo */
    const caixa = (x: number, y: number, w: number, h: number) => {
      const pts = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].map(([X, Y]) => ({ x: a * X + c0 * Y + e0, y: b0 * X + d0 * Y + f0 }));
      return {
        x0: Math.min(...pts.map((p) => p.x)),
        x1: Math.max(...pts.map((p) => p.x)),
        y0: Math.min(...pts.map((p) => p.y)),
        y1: Math.max(...pts.map((p) => p.y)),
      };
    };
    for (const i of desenhados) {
      const desenhado = caixa(i.args[0], i.args[1], i.args[2], i.args[3]);
      const ideal = caixa(
        Math.round((i.args[0] + i.args[2] / 2) / 256 - 0.5) * 256,
        Math.round((i.args[1] + i.args[3] / 2) / 256 - 0.5) * 256,
        256,
        256,
      );
      /*
       * O que a folga tem de fazer: o bloco desenhado **cobre** o ideal por
       * todos os lados — é essa sobra que fecha a emenda quando as bordas dos
       * blocos são oblíquas (não há grade de pixels a seguir).
       */
      expect(desenhado.x0).toBeLessThanOrEqual(ideal.x0 - 0.3);
      expect(desenhado.x1).toBeGreaterThanOrEqual(ideal.x1 + 0.3);
      expect(desenhado.y0).toBeLessThanOrEqual(ideal.y0 - 0.3);
      expect(desenhado.y1).toBeGreaterThanOrEqual(ideal.y1 + 0.3);
      // …e a folga é pequena: nada de bloco esticado na tela
      expect(desenhado.x1 - desenhado.x0).toBeLessThan(ideal.x1 - ideal.x0 + 8);
      // simétrica: a folga é tirada dos dois lados, então o mapa não anda
      const meioX = i.args[0] + i.args[2] / 2 - 128;
      expect(Math.abs((((meioX % 256) + 256) % 256) - 0)).toBeLessThan(0.05);
    }
  });

  it("sem zoom quebrado as contas continuam fechando", () => {
    // zoom inteiro: a grade de pixels coincide com a grade dos blocos
    const f = quadroDeBlocos(16);
    // a matriz é [a, b, c, d, e, f]: sem giro e sem inclinação, b e c são zero
    const [a, , , d] = matriz(f);
    expect(a).toBeCloseTo(1, 9);
    expect(d).toBeCloseTo(1, 9);
    for (const i of blocos(f)) {
      // a folga é meio pixel de **tela** de cada lado: com a escala 1, um pixel
      // no mundo de cada lado
      expect(i.args[2]).toBeCloseTo(TILE_SIZE + 2 * SANGRIA_PX, 6);
      expect(i.args[3]).toBeCloseTo(TILE_SIZE + 2 * SANGRIA_PX, 6);
    }
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

  it("a inclinação do horizonte comprime o alto e não move o personagem", () => {
    /*
     * O pedido: "dar uma inclinação para enxergar o horizonte". Um mapa de cima
     * não tem horizonte; o que se faz é comprimir a parte de cima, de modo que
     * o mundo acima do personagem caiba mais longe na mesma tela (o longe fica
     * pequeno, como o chão visto de rasão).
     */
    const centro = { lat: -23.5, lng: -48.4 };
    const W = 1280;
    const H = 720;
    const sem = vistaDe({ centro, zoom: 16, width: W, height: H, altura: CHASE_ALTURA });
    const com = vistaDe({
      centro,
      zoom: 16,
      width: W,
      height: H,
      altura: CHASE_ALTURA,
      tilt: CHASE_TILT,
    });
    const ponto = project(centro.lat, centro.lng, sem.z);
    // um ponto 200 unidades de mundo **acima** do personagem
    const acima = (v: ReturnType<typeof vistaDe>) =>
      projetorDaVista(v)(ponto.x, ponto.y - 200).y;
    const ancora = H * CHASE_ALTURA;
    // o personagem (a âncora) não se move…
    expect(Math.abs(projetorDaVista(com)(ponto.x, ponto.y).y - ancora)).toBeLessThan(1e-6);
    // …e o que está acima dele chega mais perto do horizonte
    expect(ancora - acima(com)).toBeLessThan(ancora - acima(sem));
    expect(ancora - acima(com)).toBeCloseTo((ancora - acima(sem)) * CHASE_TILT, 6);
    // o mundo que a tela enxerga cresce (é o que dá a sensação de profundidade)
    const alturaSem = (sem.y1 - sem.y0) * sem.s;
    const alturaCom = (com.y1 - com.y0) * com.s;
    expect(alturaCom).toBeGreaterThan(alturaSem * 1.4);
  });

  it("no desenho, a inclinação comprime de verdade o que está à frente", () => {
    /*
     * O teste acima prova a conta da vista; este prova que o **desenho** a usa.
     * Com a inclinação, tudo o que não é a âncora se aproxima dela na vertical
     * — o que está atrás sobe, o que está à frente desce. Se o renderizador
     * esquecesse a inclinação na hora de desenhar, os dois quadros ficariam
     * iguais (e o mapa apareceria com buracos no alto, porque os blocos são
     * pedidos com ela).
     */
    const camera = { mode: "follow" as const, followZoom: 15 };
    const comTilt = { ...camera, chase: { gira: false, tilt: true } };
    const semTilt = { ...camera, chase: { gira: false, tilt: false } };
    // uma parada que o personagem **já passou**: a etiqueta dela está na tela
    const paradaAtras = parada({ t: 0.35 });
    /*
     * A marca no chão da parada (`arc.arc`) é desenhada em coordenadas de tela:
     * é a posição que interessa. O rótulo não serve — ele é desenhado dentro de
     * um `translate`/`scale`, então o que o `fakeCtx` anota é a posição local.
     */
    const quadro = (cam: typeof comTilt | typeof semTilt) => {
      const f = fakeCtx();
      desenhar(f.ctx, { ...estado(0.5, 30, null), camera: cam, stops: [paradaAtras] });
      const marca = f.arcosPos.find((a) => a[2] > 3 && a[2] < 5);
      return marca ? { x: marca[0], y: marca[1] } : null;
    };
    const com = quadro(comTilt);
    const sem = quadro(semTilt);
    expect(com).not.toBeNull();
    expect(sem).not.toBeNull();
    const ancora = 720 * CHASE_ALTURA;
    // a compressão é só vertical: o x não muda em nada
    expect(com!.x).toBeCloseTo(sem!.x, 6);
    // e a distância até o personagem encolhe (o quadro comprimiu a vertical)
    const dSem = Math.abs(sem!.y - ancora);
    const dCom = Math.abs(com!.y - ancora);
    expect(dSem).toBeGreaterThan(100); // a parada está longe o bastante para medir
    expect(dCom).toBeLessThan(dSem * 0.85);
  });

  it("a inclinação faz o vídeo pedir mais blocos de mapa (senão sairia burado)", () => {
    const camera = { mode: "follow" as const, followZoom: 16, chase: { gira: false, tilt: true } };
    const comTilt = tilesForAnimation(track, camera, 1280, 720, "dark").length;
    const semTilt = tilesForAnimation(
      track,
      { ...camera, chase: { gira: false, tilt: false } },
      1280,
      720,
      "dark",
    ).length;
    expect(comTilt).toBeGreaterThan(semTilt);
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

/*
 * O mapa em miniatura no canto — o pedido: "tem como ir desenhando no canto da
 * tela em baixo do título o mapa que está sendo percorrido".
 *
 * O que se prova aqui é o que o usuário vê: ele existe naquele canto, a rota
 * inteira cabe, o personagem aparece marcado dentro da caixa — e, desligado,
 * não sobra nada.
 */
describe("mapa em miniatura", () => {
  const comMini = (ligado: boolean) => ({ ...style, showMinimap: ligado });
  const comMini1 = () => comMini(true);

  it("fica no canto de cima à esquerda, abaixo do título", () => {
    const semTitulo = minimapLayout(1280, 720);
    const depoisDoTitulo = minimapLayout(1280, 720, 96);
    expect(semTitulo.x).toBe(26);
    expect(semTitulo.y).toBe(26);
    // abaixo do título: começa depois de onde ele terminou
    expect(depoisDoTitulo.y).toBeGreaterThan(96);
    expect(depoisDoTitulo.x).toBe(semTitulo.x);
    // e não escapa do quadro
    expect(depoisDoTitulo.x + depoisDoTitulo.w).toBeLessThan(1280);
    expect(depoisDoTitulo.y + depoisDoTitulo.h).toBeLessThan(720);
  });

  it("ocupa a mesma fração do menor lado no 16:9 e no 9:16", () => {
    const largura = minimapLayout(1280, 720);
    const retrato = minimapLayout(720, 1280);
    expect(largura.w / 720).toBeCloseTo(retrato.w / 720, 1);
    expect(retrato.x + retrato.w).toBeLessThan(720);
  });

  it("desenha a rota e o ponto do personagem dentro da caixa", () => {
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 10, null), style: comMini(true) });
    const L = minimapLayout(1280, 720);
    const dentro = (x: number, y: number) =>
      x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h;
    // o marcador do personagem: um círculo de ~6 px de raio dentro da caixa
    const marcador = f.arcos.find(([x, y, r]) => r >= 5 && r <= 8 && dentro(x, y));
    expect(marcador).toBeDefined();
    // a rota inteira (apagada) e o percorrido (na cor do app, mais grosso)
    expect(f.tracos.some((t) => t.cor === "rgba(163,230,53,0.4)" && t.largura > 2)).toBe(true);
    expect(f.tracos.some((t) => t.cor === "rgba(163,230,53,1)" && t.largura > 3)).toBe(true);
  });

  it("desligado, não desenha nada no canto", () => {
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 10, null), style: comMini(false) });
    const L = minimapLayout(1280, 720);
    const dentro = (x: number, y: number) =>
      x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h;
    expect(f.arcos.some(([x, y, r]) => r >= 5 && r <= 8 && dentro(x, y))).toBe(false);
  });

  /*
   * O canto é só contorno: o usuário pediu para tirar o mapa do fundo ("coloca
   * só o contorno, não precisa do mapa no fundo"). Isso também tira o custo:
   * nenhum bloco a mais no aquecimento, nenhuma requisição por quadro.
   */
  it("o canto não pede bloco de mapa nenhum", () => {
    const camera: FrameState["camera"] = { mode: "follow", followZoom: 15 };
    const comMini = tilesForAnimation(track, camera, 1280, 720, "dark", null, null);
    expect(comMini.length).toBeGreaterThan(0);
    // e o desenho não faz `drawImage` no canto (nada de fundo de mapa ali)
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 10, null), style: comMini1() });
    const L = minimapLayout(1280, 720);
    const dentro = (x: number, y: number, w: number, h: number) =>
      x >= L.x - 1 && x + w <= L.x + L.w + 1 && y >= L.y - 1 && y + h <= L.y + L.h + 1;
    expect(f.imagens.some((i) => dentro(i.args[0], i.args[1], i.args[2], i.args[3]))).toBe(false);
  });
});

/*
 * O avatar do personagem — o pedido: "teria como colocar tipo um avatar no
 * personagem".
 *
 * O que se prova: com a foto pronta no cache, ela entra **dentro do selo** (um
 * `drawImage` no lugar do emoji); sem foto, ou com a foto ainda chegando, o
 * emoji continua ali — o personagem nunca some do vídeo.
 */
describe("avatar do personagem", () => {
  const FOTO = "data:image/jpeg;base64,AAAA";
  const imagem = { width: 400, height: 400 } as unknown as PhotoImage;
  const cache = (pronta: boolean): PhotoLookup => ({
    get: (src) => (pronta && src === FOTO ? imagem : null),
    has: () => pronta,
  });

  it("com a foto pronta, o selo mostra a foto e não o emoji", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 10, null),
      style: { ...style, avatar: FOTO },
      photos: cache(true),
    });
    // o emoji do "carro" não foi escrito na tela
    expect(f.textos).not.toContain("🚗");
    // e uma imagem foi desenhada (a foto dentro do selo)
    expect(f.imagens.length).toBeGreaterThan(0);
  });

  it("sem foto (ou enquanto ela não chega), cai no emoji", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 10, null),
      style: { ...style, avatar: FOTO },
      photos: cache(false),
    });
    expect(f.textos).toContain("🚗");
  });

  it("sem avatar escolhido, nada muda", () => {
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 10, null), photos: cache(true) });
    expect(f.textos).toContain("🚗");
  });
});

/*
 * O rastro do vídeo não pode passar do personagem.
 *
 * Numa rota de cidade o exagero era de metros; num traçado de poucos pontos —
 * uma travessia — cada segmento tem milhares de km, e o rastro ia até o **fim**
 * do segmento antes de voltar para o personagem: a cor do percorrido pintava o
 * caminho que ainda falta.
 */
describe("rastro percorrido", () => {
  it("para no personagem, e não no fim do segmento", () => {
    // dois pontos, ~5.000 km: o segmento é a rota inteira
    const longa = buildTrack([
      { lat: -23.5, lng: -48.4 },
      { lat: -23.5 + 5000 / 111, lng: -48.4 },
    ]);
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 10, null), camera: { mode: "fit", followZoom: 16 } }, longa);
    // o selo do personagem tem raio fixo (0,62 do selo)
    const selo = f.arcosPos.find((a) => Math.abs(a[2] - 38.44) < 0.01);
    expect(selo).toBeDefined();
    const [, yPersonagem] = selo!;

    const rastro = f.tracos
      .map((t, i) => ({ ...t, pontos: f.tracosPontos[i] }))
      .filter((t) => t.cor === "#a3e635" && t.largura >= 5 && t.largura <= 7)
      .pop();
    // a rota anda para o norte, então na tela o já percorrido fica **abaixo**
    expect(rastro).toBeDefined();
    expect(rastro!.pontos.length).toBeGreaterThan(1);
    for (const [, y] of rastro!.pontos) expect(y).toBeGreaterThanOrEqual(yPersonagem - 2);
    const ultimo = rastro!.pontos[rastro!.pontos.length - 1];
    expect(Math.abs(ultimo[1] - yPersonagem)).toBeLessThan(3);
  });

  /*
   * O outro lado da mesma conta: numa travessia (dois pontos) o percurso tem de
   * **aparecer** preenchido. Com `visibleRuns` devolvendo lista vazia — não há
   * segmento completo na tela — o `pathOf` ficava só com o `moveTo` no
   * personagem e o rastro sumia do vídeo inteiro.
   */
  it("aparece numa travessia de dois pontos", () => {
    const longa = buildTrack([
      { lat: -23.5, lng: -48.4 },
      { lat: 21.5, lng: -48.4 },
    ]);
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.4, 10, null), camera: { mode: "follow", followZoom: 7 } }, longa);
    const rastro = f.tracos
      .map((t, i) => ({ ...t, pontos: f.tracosPontos[i] }))
      .filter((t) => t.cor === "#a3e635" && t.largura >= 5 && t.largura <= 7)
      .pop();
    expect(rastro).toBeDefined();
    expect(rastro!.pontos.length).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------ */
/* Perfil de elevação                                                  */
/* ------------------------------------------------------------------ */

/**
 * O perfil de elevação no vídeo.
 *
 * A faixa existe para contar a **dureza** do percurso — o que nem o Strava nem
 * o Relive contam, porque mostram o traçado visto de cima e não o relevo. Os
 * testes fixam o que o usuário percebe: a faixa aparece quando há altitude,
 * cresce junto com o personagem, não aparece em rota plana nem durante a
 * cartela, e não encosta na barra de progresso.
 */
describe("perfil de elevação no vídeo", () => {
  const comPerfil = { ...style, showProfile: true } as SceneStyle;
  /** a cor do preenchimento do trecho percorrido, nas duas pontas do gradiente */
  const alturaDoTexto = (f: ReturnType<typeof fakeCtx>, nomes: string[]) =>
    f.textosPos.filter((t) => nomes.some((n) => t.s === n));

  it("aparece no rodapé quando o traçado tem altitude", () => {
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 14, null), style: comPerfil });
    const textos = f.textos.join(" | ");
    // D+ e altitude máxima são os rótulos da faixa
    expect(textos).toMatch(/D\+ 1[0-9]{2} m/);
    expect(textos).toContain("842 m");
  });

  it("não aparece em traçado sem altitude", () => {
    const semEle = buildTrack([
      { lat: -23.5, lng: -48.4 },
      { lat: -23.51, lng: -48.41 },
      { lat: -23.52, lng: -48.42 },
    ]);
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 14, null), style: comPerfil }, semEle);
    expect(f.textos.join(" | ")).not.toMatch(/D\+ /);
  });

  it("o marcador anda para a direita e sobe com o personagem", () => {
    /*
     * O marcador é o ponto de 4,2 px (raio único no quadro). Ele anda pela
     * **largura** da faixa conforme o personagem avança e sobe conforme a
     * altitude: no traçado do teste a rota sobe 700 → 842 m, então o ponto
     * termina mais alto (y menor) e mais à direita.
     */
    const marcador = (f: ReturnType<typeof fakeCtx>) =>
      f.arcosPos.find((a) => Math.abs(a[2] - 4.2) < 0.01) ?? null;
    const quadro = (t: number) => {
      const f = fakeCtx();
      desenhar(f.ctx, { ...estado(t, 14, null), style: comPerfil });
      return marcador(f);
    };
    const inicio = quadro(0.05)!;
    const meio = quadro(0.5)!;
    const fim = quadro(0.97)!;
    expect(inicio).not.toBeNull();
    expect(meio[0]).toBeGreaterThan(inicio[0]);
    expect(fim[0]).toBeGreaterThan(meio[0]);
    // sobe no quadro (a altitude cresce no traçado do teste)
    expect(fim[1]).toBeLessThan(inicio[1]);
    // e o marcador vive dentro da faixa do rodapé
    const L = profileLayout(1280, 720, 1, false);
    for (const m of [inicio, meio, fim]) {
      expect(m[1]).toBeGreaterThanOrEqual(L.y);
      expect(m[1]).toBeLessThanOrEqual(L.y + L.h);
    }
  });

  it("sai de cena quando a cartela final entra", () => {
    const tl = buildTimeline(14, { voo: false, cartela: true });
    const antes = fakeCtx();
    const durante = fakeCtx();
    const st = { ...estado(1, 14, cartela, null, null, tl), style: comPerfil };
    desenhar(antes.ctx, { ...st, elapsed: 8 });
    desenhar(durante.ctx, { ...st, elapsed: 13.5 });
    expect(antes.textos.join(" ")).toMatch(/D\+ /);
    expect(durante.textos.join(" ")).not.toMatch(/D\+ /);
  });

  it("desligado no painel, não desenha nada", () => {
    const f = fakeCtx();
    desenhar(f.ctx, { ...estado(0.5, 14, null), style: { ...style, showProfile: false } });
    expect(f.textos.join(" | ")).not.toMatch(/D\+ /);
  });

  it("fica acima da barra de progresso, sem encostar", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(0.5, 14, null),
      style: { ...comPerfil, showProgress: true },
    });
    // o rótulo "X de Y km" da barra e o "D+" do perfil
    const dmais = f.textosPos.find((t) => /^D\+ /.test(t.s));
    const barra = f.textosPos.find((t) => / de .* km$/.test(t.s));
    expect(dmais).toBeDefined();
    expect(barra).toBeDefined();
    expect(dmais!.y).toBeLessThan(barra!.y);
    expect(alturaDoTexto(f, ["842 m"]).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Legenda da rota colorida x faixa do perfil                          */
/* ------------------------------------------------------------------ */

/**
 * Os dois moram no rodapé esquerdo.
 *
 * A legenda é desenhada **depois** da faixa do perfil, então — sem conta — ela
 * cobria o começo do gráfico e o rótulo da altitude máxima. Foi o que o usuário
 * viu: "o gráfico de elevação está atrás da legenda de elevação".
 */
describe("legenda da rota colorida e perfil de elevação", () => {
  /**
   * A caixa do painel da legenda.
   *
   * Não dá para pegar pelo texto: o casamento do `fakeCtx` exige o retângulo
   * **centrado** no texto, e o título fica no canto do painel. O painel é o
   * `roundRect` de 44 px de altura e largura da escala.
   */
  const caixaDaEscala = (f: ReturnType<typeof fakeCtx>) => {
    if (!f.textos.includes("inclinação %")) return null;
    return (
      f.caixasDesenhadas.find(
        (b) => Math.abs(b.y1 - b.y0 - 44) < 1.5 && b.x1 - b.x0 > 120 && b.x1 - b.x0 < 360,
      ) ?? null
    );
  };

  it("a legenda sobe e não encosta na faixa do perfil", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(1, 14, null, null),
      colored: colorida,
      style: { ...style, showProfile: true, showProgress: true } as SceneStyle,
    }, trackSubida);
    const legenda = caixaDaEscala(f);
    expect(legenda).not.toBeNull();
    const faixa = profileLayout(1280, 720, 1, true);
    // a legenda inteira fica **acima** da faixa
    expect(legenda!.y1).toBeLessThanOrEqual(faixa.y);
    // sanidade: a faixa existe e está no rodapé
    expect(f.textos.join(" ")).toMatch(/D\+ /);
  });

  it("com o perfil desligado, a legenda desce para o lugar de sempre", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(1, 14, null, null),
      colored: colorida,
      style: { ...style, showProfile: false, showProgress: true } as SceneStyle,
    }, trackSubida);
    const legenda = caixaDaEscala(f);
    expect(legenda).not.toBeNull();
    // encosta na barra de progresso, e não na faixa do perfil
    const faixa = profileLayout(1280, 720, 1, true);
    expect(legenda!.y1).toBeGreaterThan(faixa.y);
  });

  it("o crédito do mapa também fica acima da faixa", () => {
    const f = fakeCtx();
    desenhar(f.ctx, {
      ...estado(1, 14, null, null),
      colored: colorida,
      style: { ...style, showProfile: true, showProgress: true } as SceneStyle,
    }, trackSubida);
    const credito = f.textosPos.find((t) => /OpenStreetMap|OpenTopoMap|Esri/.test(t.s));
    expect(credito).toBeDefined();
    const faixa = profileLayout(1280, 720, 1, true);
    expect(credito!.y).toBeLessThan(faixa.y);
  });
});

/* ------------------------------------------------------------------ */
/* Prévia de percurso                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rota que ninguém percorreu: o arquivo tem posições (e altitude), mas não tem
 * horário. Não existe velocidade nem ritmo para mostrar, e o HUD antigo ficava
 * com um traço e "sem arquivo" o vídeo inteiro — o vídeo dizendo que falta dado.
 *
 * Agora ele mostra o que a rota **tem**: a inclinação do trecho (a mesma que
 * colore a linha) e, sem elevação, a distância que falta.
 */
describe("prévia de percurso (rota sem horário)", () => {
  /**
   * Traçado de 12 pontos a 100 m (1,1 km), com a altitude que a função der —
   * `null` deixa o ponto sem `ele`, como num arquivo só com posições.
   */
  const trilha = (ele: (i: number) => number | null): { lat: number; lng: number; ele?: number }[] =>
    Array.from({ length: 12 }, (_, i) => {
      const base = { lat: 0, lng: (i * 100) / 111_320 };
      const h = ele(i);
      return h === null ? base : { ...base, ele: h };
    });

  const desenharSemHora = (
    pts: { lat: number; lng: number; ele?: number }[],
    t = 0.5,
  ) => {
    const track = buildTrack(pts);
    const { ctx, textos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(t, 14, null, null),
      track,
    });
    return { textos, track };
  };

  it("subida: escreve a inclinação e a palavra do sentido", () => {
    // 8 m a cada 100 m = 8%
    const { textos } = desenharSemHora(trilha((i) => 700 + i * 8));
    expect(textos).toContain("8,0");
    expect(textos).toContain("%");
    expect(textos).toContain("subindo");
  });

  it("descida: o número não leva sinal, quem diz o sentido é a palavra", () => {
    const { textos } = desenharSemHora(trilha((i) => 900 - i * 5));
    expect(textos).toContain("5,0");
    expect(textos).toContain("descendo");
    expect(textos).not.toContain("-5,0");
  });

  it("trecho plano diz plano", () => {
    const { textos } = desenharSemHora(trilha(() => 640));
    expect(textos).toContain("plano");
    expect(textos).toContain("0,0");
  });

  it("a inclinação do anel é a mesma que pinta a linha", () => {
    // perfil ondulado: cada trecho tem a sua rampa
    const pts = trilha((i) => 700 + 40 * Math.sin(i / 2));
    const { textos, track } = desenharSemHora(pts, 0.62);
    const esperado = slopeAt(slopeSeries(track.pts, cumDoDesenho(track)), cumDoDesenho(track), 0.62);
    expect(esperado).not.toBeNull();
    const escrito = Math.abs(esperado!).toFixed(1).replace(".", ",");
    expect(textos).toContain(escrito);
    expect(textos).toContain(esperado! > 0 ? "subindo" : "descendo");
  });

  it("sem elevação no arquivo, mostra quanto falta", () => {
    const { textos, track } = desenharSemHora(trilha(() => null), 0.5);
    expect(textos).toContain("restantes");
    expect(textos).toContain("km");
    expect(textos).not.toContain("—");
    // metade do traçado andado: falta a outra metade, em km com uma casa
    const falta = (track.total / 2 / 1000).toFixed(1).replace(".", ",");
    expect(textos).toContain(falta);
  });

  it("numa rota que falta pouco, o número é pequeno — não é relógio disfarçado", () => {
    const { textos } = desenharSemHora(trilha(() => null), 0.95);
    expect(textos).toContain("restantes");
    expect(textos).not.toContain("sem arquivo");
  });
});

/* ------------------------------------------------------------------ */
/* Destaques do percurso no vídeo                                      */
/* ------------------------------------------------------------------ */

/**
 * A melhor parcial e a maior subida, desenhadas.
 *
 * A conta do que é "melhor" e "maior" é testada em `highlights.test.ts`; aqui
 * interessa o que o usuário vê: o aviso entra na hora certa, sai depois, fica
 * fora das faixas fixas do quadro e obedece ao interruptor.
 */
describe("destaques do percurso no vídeo", () => {
  /** 5 km a 10 m por ponto, com o km 4 em 300 s; sobe 60 m do km 2 ao 4 */
  const PONTOS_POR_KM = 100;
  const DESTAQUE = Array.from({ length: 5 * PONTOS_POR_KM + 1 }, (_, i) => {
    const km = Math.floor(i / PONTOS_POR_KM);
    const dentro = (i % PONTOS_POR_KM) / PONTOS_POR_KM;
    const ritmo = km === 3 ? 300 : 360;
    let seg = 0;
    for (let k = 0; k < km; k++) seg += k === 3 ? 300 : 360;
    seg += dentro * ritmo;
    // sobe 60 m do km 0,5 ao 2,5: o cume (0,5 do percurso) fica longe da
    // melhor parcial (0,8), então os dois avisos cabem no mesmo vídeo
    const subida = Math.max(0, Math.min(1, (i - 0.5 * PONTOS_POR_KM) / (2 * PONTOS_POR_KM)));
    return {
      lat: -23.5 + i * 0.00009,
      lng: -48.4,
      ele: 700 + subida * 60,
      t: T0 + seg * 1000,
    };
  });
  const trackDestaque = buildTrack(DESTAQUE);
  const horasDestaque = DESTAQUE.map((p) => p.t);

  /** onde cada destaque cai no percurso, pela conta da biblioteca */
  const lista = destaques({
    track: trackDestaque,
    times: horasDestaque,
    perfil: trailProfile(trackDestaque),
    pace: true,
  });
  const melhor = lista.find((d) => d.tipo === "melhorKm")!;
  const subida = lista.find((d) => d.tipo === "maiorSubida")!;

  const quadro = (t: number, patch: Partial<(typeof style)> = {}) => {
    const { ctx, textos, textosPos } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(t, 14, null, horasDestaque),
      track: trackDestaque,
      style: { ...style, showHighlights: true, pace: true, ...patch },
    });
    return { textos, textosPos };
  };

  it("a melhor parcial aparece quando o personagem chega nela", () => {
    const { textos } = quadro(melhor.em);
    expect(textos).toContain("★");
    expect(textos).toContain("MELHOR KM");
    expect(textos).toContain(formatPace(300)); // 1 km em 300 s
    expect(textos).toContain("/km");
    expect(textos.some((t) => t.includes("km 4 de 5,0"))).toBe(true);
  });

  it("fora da janela ela não aparece", () => {
    const { textos } = quadro(melhor.em - 0.4);
    expect(textos).not.toContain("MELHOR KM");
  });

  it("a maior subida aparece no cume, com os metros ganhos", () => {
    const { textos } = quadro(subida.em);
    expect(textos).toContain("MAIOR SUBIDA");
    expect(textos).toContain("60");
    expect(textos).toContain("m");
  });

  it("com título, o aviso nasce abaixo da caixa dele", () => {
    const { textosPos } = quadro(melhor.em, { showTitle: true });
    const titulo = textosPos.find((t) => t.s === "MELHOR KM")!;
    expect(titulo).toBeDefined();
    // a caixa do título (40 do título + 26 do subtítulo + margens) vai até ~130
    expect(titulo.y).toBeGreaterThan(130);
    // e o aviso inteiro fica acima da faixa do perfil
    const faixa = profileLayout(1280, 720, 1, true);
    expect(titulo.y + 60).toBeLessThan(faixa.y);
  });

  it("sem título, o aviso sobe para o alto do quadro", () => {
    const { textosPos } = quadro(melhor.em, { showTitle: false });
    const titulo = textosPos.find((t) => t.s === "MELHOR KM")!;
    expect(titulo.y).toBeLessThan(80);
    expect(titulo.y).toBeGreaterThan(10);
  });

  it("não entra na coluna do HUD", () => {
    const { textosPos } = quadro(melhor.em, { showTitle: true, showHud: true });
    const linha = textosPos.filter((t) => t.s === "MELHOR KM" || t.s === "★");
    expect(linha.length).toBe(2);
    // o anel do HUD mora nos 200 px da direita
    for (const t of linha) expect(t.x).toBeLessThan(1280 - 200);
  });

  it("com o interruptor desligado não há aviso nenhum", () => {
    const { textos } = quadro(melhor.em, { showHighlights: false });
    expect(textos).not.toContain("MELHOR KM");
    expect(textos).not.toContain("★");
  });

  it("sem hora no arquivo sobra a subida; sem altitude não sobra nada", () => {
    // a rota tem altitude: com o arquivo sem hora, o aviso é o da subida
    const { textos } = quadro(subida.em);
    expect(textos).toContain("MAIOR SUBIDA");

    // agora uma rota sem altitude e sem hora: nenhum aviso (nada de número
    // inventado), e o "★" nem chega a ser desenhado
    const plana = buildTrack(
      Array.from({ length: 300 }, (_, i) => ({ lat: -23.5 + i * 0.00009, lng: -48.4 })),
    );
    const { ctx, textos: semNada } = fakeCtx();
    new SceneRenderer("dark").render(ctx, 1280, 720, {
      ...estado(0.5, 14, null, null),
      track: plana,
      style: { ...style },
    });
    expect(semNada).not.toContain("★");
  });
});

/* ------------------------------------------------------------------ */
/* Um lugar só para a distância                                        */
/* ------------------------------------------------------------------ */

/**
 * O mesmo número não pode aparecer duas vezes no quadro.
 *
 * O selo do canto superior direito (dentro do título) escrevia a distância
 * percorrida em `6.00 km`, e a faixa sob o anel do HUD escrevia a **mesma**
 * distância em `6,00 km`: dois formatos do mesmo número, um acima e outro abaixo
 * do anel. O usuário viu ("tanto em cima quanto em baixo dele, tem a marcação de
 * km"). O selo saiu; o contador de paradas, que mora no mesmo canto e não tem
 * nada a ver com isso, ficou.
 */
describe("a distância aparece num lugar só", () => {
  it("o canto do título não repete a distância da faixa do anel", () => {
    const { ctx, textos } = fakeCtx();
    desenhar(
      ctx,
      { ...estado(0.5, 14, null, null), style: { ...style, showTitle: true, showHud: true } },
      trackSubida,
    );
    // o selo antigo: ponto decimal e " km" no fim
    expect(textos.some((t) => /^\d+\.\d+ km$/.test(t))).toBe(false);
    // a faixa do anel continua sendo o lugar da distância, em pt-BR...
    const linha = formatDistance(sampleTrack(trackSubida, 0.5).distance);
    expect(textos).toContain(linha);
    // ...e uma vez só
    expect(textos.filter((t) => t === linha)).toHaveLength(1);
  });

  it("o contador de paradas continua no canto quando está ligado", () => {
    const { ctx, textos } = fakeCtx();
    const parada = {
      id: "p1",
      label: "Cachoeira",
      lat: -23.5 + 0.000075 * 150,
      lng: -48.4,
      color: "#22d3ee",
    };
    desenhar(
      ctx,
      {
        ...estado(1, 14, null, null),
        stops: [parada as never],
        style: { ...style, showTitle: true, showStopCounter: true },
      },
      trackSubida,
    );
    expect(textos.some((t) => /\d\/\d paradas/.test(t))).toBe(true);
  });
});
