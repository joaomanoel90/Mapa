/**
 * Os **ícones animados**: personagens desenhados em vetor, que se mexem de
 * verdade — as pernas andam, as rodas giram, o barco balança.
 *
 * Por que existem: o emoji é um desenho **parado**. Quem anda é o selo em volta
 * dele (o balanço de 3% do `andar`), e isso se lê como um adesivo sendo
 * carregado, não como alguém caminhando. O boneco com o rosto resolveu para
 * quem tem foto; estes ícones resolvem para quem não tem — e de quebra não
 * dependem da fonte de emoji do sistema, que desenha diferente no Windows, no
 * Android e no iPhone.
 *
 * Um desenho, três lugares:
 *
 * - **no vídeo**, quadro a quadro no canvas (`desenharIcone`);
 * - **na prévia do mapa**, o mesmo desenho em **SVG animado** (`svgDoIcone`),
 *   com `<animateTransform>` — vetor nítido em qualquer tela;
 * - **no painel**, o mesmo SVG, pequeno.
 *
 * A geometria é uma só: uma lista de **partes**, cada uma um polígono ou uma
 * linha, num quadrado de 0 a 100 (x para a direita, y para baixo), com o
 * personagem olhando para a direita.
 *
 * ## A regra do desenho
 *
 * O selo é **sempre escuro** (`rgba(15,18,28,0.92)` no vídeo, `rgba(9,12,20,
 * 0.95)` na prévia), então o ícone é sempre **tinta clara por cima** — não tem
 * "modo claro". E cada parte leva uma **casca** escura em volta: é ela que
 * separa a perna da frente da de trás, como num pictograma de placa. Sem a
 * casca, quatro membros da mesma cor viram um borrão.
 */

const TAU = Math.PI * 2;

/** Um ponto no quadrado de 0 a 100. */
export type Ponto = [number, number];

/** De onde sai a cor de uma parte. */
export type CorDoIcone = "tinta" | "acento" | "suave";

/**
 * O que a parte faz enquanto o personagem anda.
 *
 * - `gira` — roda, pedivela: uma volta por ciclo, sem parar;
 * - `passo` — perna, braço, pata: vai e volta em torno do eixo (o ombro, o
 *   quadril), uma vez por ciclo;
 * - `sobe` — o corpo inteiro (ou só a cabeça): sobe e desce de leve;
 * - `balanca` — casco de barco, rabo: inclina para os lados.
 */
export type GestoDoIcone = "gira" | "passo" | "sobe" | "balanca";

export type ParteDoIcone = {
  /** o desenho, em unidades de 0 a 100 */
  pts: Ponto[];
  cor: CorDoIcone;
  /** espessura do traço; sem traço, a parte é uma forma preenchida */
  traco?: number;
  /** fecha o contorno (forma) */
  fecha?: boolean;
  gesto?: GestoDoIcone;
  /** centro do giro, em unidades do ícone */
  eixo?: Ponto;
  /** graus no giro/balanço, ou unidades no sobe */
  amplitude?: number;
  /** onde a parte está no ciclo (0 a 1): braços e pernas opostos usam 0,5 */
  defasagem?: number;
};

export type Icone = {
  id: string;
  name: string;
  /** o emoji equivalente — fica de reserva se o vetor não for desenhado */
  emoji: string;
  /**
   * O ícone sabe **como ele mesmo se move** — e não herda isso do personagem
   * escolhido: um cavalo desenhado no lugar de um carro continua galopando, e
   * não passa a rolar. `gaitOf`/`andar` recebem estes valores no desenho.
   */
  gait: "passo" | "roda" | "flutua";
  /** ciclos por segundo (o passo, a volta da roda, o balanço) */
  gaitHz: number;
  /** tamanho relativo no selo (1 = o padrão dos personagens) */
  size?: number;
  /** gira o desenho inteiro conforme o rumo (avião, barco a motor) */
  rotate?: boolean;
  /** compensação em graus para `rotate` (o desenho olha para a direita) */
  baseAngle?: number;
  partes: ParteDoIcone[];
};

/** A cor do fundo do selo: é a cor da casca em volta das partes. */
export const CASCA = "#0f131c";

/* ------------------------------------------------------------------ */
/* ajudas de geometria                                                 */
/* ------------------------------------------------------------------ */

/** Duas casas: o SVG fica curto e a comparação de pontos não tropeça. */
const redondo = (v: number) => Math.round(v * 100) / 100;

/** Círculo como polígono fechado: o desenho inteiro é linha e polígono. */
function circulo(cx: number, cy: number, r: number, lados = 22): Ponto[] {
  return Array.from({ length: lados }, (_, i) => {
    const a = (i / lados) * TAU;
    return [redondo(cx + Math.cos(a) * r), redondo(cy + Math.sin(a) * r)] as Ponto;
  });
}

/** Uma perna/braço/pata que gira em torno de `eixo`. */
function membro(
  eixo: Ponto,
  ate: Ponto[],
  traco: number,
  cor: CorDoIcone,
  defasagem: number,
  amplitude: number,
): ParteDoIcone {
  return {
    pts: [eixo, ...ate],
    cor,
    traco,
    gesto: "passo",
    eixo,
    amplitude,
    defasagem,
  };
}

/**
 * Uma roda que gira: o aro, dois raios e o miolo, no mesmo eixo.
 *
 * O aro é um traço grosso e claro; o miolo é o acento. É o desenho que se lê
 * como "roda" mesmo a 40 px.
 */
function roda(cx: number, cy: number, r: number): ParteDoIcone[] {
  return [
    { pts: circulo(cx, cy, r), cor: "tinta", traco: r * 0.34, fecha: true },
    { pts: [[cx - r * 0.72, cy], [cx + r * 0.72, cy]], cor: "acento", traco: r * 0.18, gesto: "gira", eixo: [cx, cy] },
    { pts: [[cx, cy - r * 0.72], [cx, cy + r * 0.72]], cor: "acento", traco: r * 0.18, gesto: "gira", eixo: [cx, cy] },
    { pts: circulo(cx, cy, r * 0.26), cor: "acento", fecha: true },
  ];
}

/* ------------------------------------------------------------------ */
/* os ícones                                                           */
/* ------------------------------------------------------------------ */

/**
 * O caminhante — a base dos de gente.
 *
 * Um pictograma de placa: cabeça redonda, tronco em cápsula e quatro membros
 * girando em torno do ombro e do quadril. Pernas e braços opostos ficam a meio
 * ciclo de distância — é isso que faz o passo parecer passo em vez de quatro
 * membros batendo juntos.
 */
function gente(opts: {
  cabeca: Ponto;
  /** quadril: de onde saem as pernas */
  quadril: Ponto;
  /** ombro: de onde saem os braços */
  ombro: Ponto;
  amplitude: number;
  /** quanto a cabeça se adianta em relação ao tronco (unidades) */
  inclina?: number;
  mochila?: boolean;
  cajado?: boolean;
}): ParteDoIcone[] {
  const { cabeca, quadril, ombro, amplitude } = opts;
  const inclina = opts.inclina ?? 0;
  const partes: ParteDoIcone[] = [];

  // o cajado fica atrás de tudo: é a linha que vai do chão à mão
  if (opts.cajado) {
    partes.push({ pts: [[36, 16], [30, 88]], cor: "acento", traco: 4 });
  }
  if (opts.mochila) {
    // a mochila sai para trás do tronco, e sobe junto com ele
    partes.push({
      pts: [[47, 34], [43, 50]],
      cor: "acento",
      traco: 13,
      gesto: "sobe",
      amplitude: 1.1,
      defasagem: 0.25,
    });
  }

  // perna de trás primeiro: a da frente cobre a de trás no cruzamento
  partes.push(membro(quadril, [[quadril[0] + 6, 70], [quadril[0] + 13, 84]], 8, "tinta", 0.5, amplitude));
  partes.push(membro(quadril, [[quadril[0] - 7, 70], [quadril[0] - 15, 84]], 8, "tinta", 0, amplitude));

  partes.push({
    pts: [ombro, quadril],
    cor: "tinta",
    traco: 11,
    gesto: "sobe",
    amplitude: 1.1,
    defasagem: 0.25,
  });

  partes.push(membro(ombro, [[ombro[0] + 10, ombro[1] + 14]], 6.5, "tinta", 0, amplitude * 0.85));
  partes.push(membro(ombro, [[ombro[0] - 10, ombro[1] + 14]], 6.5, "tinta", 0.5, amplitude * 0.85));

  partes.push({
    pts: circulo(cabeca[0] + inclina, cabeca[1], 9.5, 22),
    cor: "tinta",
    fecha: true,
    gesto: "sobe",
    amplitude: 1.1,
    defasagem: 0.25,
  });

  // o chapéu do peregrino: aba e copa, no acento
  if (opts.mochila) {
    partes.push({ pts: [[cabeca[0] - 13, cabeca[1] - 3], [cabeca[0] + 13, cabeca[1] - 3]], cor: "acento", traco: 4.5 });
    partes.push({ pts: [[cabeca[0] - 6, cabeca[1] - 4], [cabeca[0] - 5, cabeca[1] - 13]], cor: "acento", traco: 8 });
  }
  return partes;
}

export const ICONES: Icone[] = [
  {
    id: "caminhante",
    name: "Caminhante",
    emoji: "🚶",
    gait: "passo",
    gaitHz: 1.9,
    partes: gente({
      cabeca: [59, 17],
      ombro: [55, 31],
      quadril: [50, 55],
      amplitude: 24,
    }),
  },
  {
    id: "peregrino",
    name: "Peregrino",
    emoji: "🎒",
    gait: "passo",
    gaitHz: 1.6,
    partes: gente({
      cabeca: [58, 18],
      ombro: [54, 32],
      quadril: [50, 55],
      amplitude: 22,
      mochila: true,
      cajado: true,
    }),
  },
  {
    id: "corredor",
    name: "Corredor",
    emoji: "🏃",
    gait: "passo",
    gaitHz: 2.9,
    partes: [
      // pernas dobradas e bem abertas, o corpo jogado para a frente
      membro([47, 52], [[37, 64], [24, 72]], 7.5, "tinta", 0.5, 30),
      membro([47, 52], [[57, 63], [71, 69]], 7.5, "tinta", 0, 30),
      { pts: [[57, 32], [47, 52]], cor: "tinta", traco: 11, gesto: "sobe", amplitude: 1.2, defasagem: 0.25 },
      // braços dobrados, opostos às pernas
      membro([55, 35], [[45, 39], [39, 50]], 6, "tinta", 0, 26),
      membro([55, 35], [[66, 41], [74, 34]], 6, "tinta", 0.5, 26),
      { pts: circulo(63, 19, 8.5, 22), cor: "tinta", fecha: true, gesto: "sobe", amplitude: 1.2, defasagem: 0.25 },
    ],
  },
  {
    id: "ciclista",
    name: "Ciclista",
    emoji: "🚴",
    gait: "roda",
    gaitHz: 1.15,
    partes: [
      ...roda(25, 75, 13),
      ...roda(75, 75, 13),
      // quadro, banco e guidão no acento: o escuro contra o aro claro
      { pts: [[25, 75], [50, 69], [45, 50], [66, 50], [75, 75]], cor: "acento", traco: 4.5 },
      { pts: [[41, 47], [49, 47]], cor: "acento", traco: 5 },
      { pts: [[62, 45], [68, 51]], cor: "acento", traco: 5 },
      { pts: circulo(50, 69, 4), cor: "acento", fecha: true },
      // o ciclista, curvado sobre o guidão
      membro([47, 49], [[53, 62], [50, 70]], 7, "tinta", 0.5, 20),
      membro([47, 49], [[41, 61], [44, 69]], 7, "tinta", 0, 20),
      { pts: [[51, 33], [47, 49]], cor: "tinta", traco: 10, gesto: "sobe", amplitude: 0.8, defasagem: 0 },
      { pts: [[50, 35], [63, 46]], cor: "tinta", traco: 6 },
      { pts: circulo(58, 23, 8, 20), cor: "tinta", fecha: true, gesto: "sobe", amplitude: 0.8, defasagem: 0 },
    ],
  },
  {
    id: "carro",
    name: "Carro",
    emoji: "🚗",
    gait: "roda",
    gaitHz: 1.1,
    size: 1.05,
    partes: [
      {
        pts: [
          [8, 64],
          [12, 52],
          [18, 48],
          [34, 46],
          [46, 32],
          [66, 32],
          [80, 47],
          [90, 51],
          [92, 58],
          [92, 64],
        ],
        cor: "tinta",
        fecha: true,
      },
      // vidros no acento
      { pts: [[50, 36], [64, 36], [73, 46], [50, 46]], cor: "acento", fecha: true },
      { pts: [[44, 46], [36, 46], [46, 36]], cor: "acento", fecha: true },
      // farol
      { pts: [[86, 54], [91, 54]], cor: "acento", traco: 4 },
      ...roda(32, 64, 10),
      ...roda(70, 64, 10),
    ],
  },
  {
    id: "cavalo",
    name: "Cavalo",
    emoji: "🐎",
    gait: "passo",
    gaitHz: 2.2,
    size: 1.1,
    partes: [
      // rabo: sai da garupa e cai
      { pts: [[33, 43], [24, 55], [23, 70]], cor: "tinta", traco: 5.5, gesto: "balanca", eixo: [33, 43], amplitude: 10 },
      // patas de trás e da frente, alternadas (bem separadas: a casca engrossa)
      membro([59, 55], [[61, 84]], 6.5, "tinta", 0, 16),
      membro([51, 56], [[49, 84]], 6.5, "tinta", 0.5, 16),
      membro([40, 56], [[38, 84]], 6.5, "tinta", 0.5, 16),
      membro([32, 55], [[34, 84]], 6.5, "tinta", 0, 16),
      // corpo e pescoço
      { pts: [[32, 47], [58, 47]], cor: "tinta", traco: 19, gesto: "sobe", amplitude: 0.9, defasagem: 0.25 },
      { pts: [[57, 45], [65, 30]], cor: "tinta", traco: 12, gesto: "sobe", amplitude: 0.9, defasagem: 0.25 },
      // cabeça: focinho comprido, testa alta
      {
        pts: [[63, 34], [64, 25], [70, 20], [80, 22], [89, 27], [88, 32], [78, 35], [68, 36]],
        cor: "tinta",
        fecha: true,
        gesto: "sobe",
        amplitude: 0.9,
        defasagem: 0.25,
      },
      // orelha em pé
      { pts: [[67, 22], [66, 12], [73, 19]], cor: "tinta", fecha: true, gesto: "sobe", amplitude: 0.9, defasagem: 0.25 },
      // crina no acento, do topo da cabeça à cernelha
      { pts: [[66, 20], [62, 29], [59, 39]], cor: "acento", traco: 3.5, gesto: "sobe", amplitude: 0.9, defasagem: 0.25 },
      // olho
      { pts: circulo(80, 27, 1.8, 8), cor: "acento", fecha: true, gesto: "sobe", amplitude: 0.9, defasagem: 0.25 },
    ],
  },
  {
    id: "cachorro",
    name: "Cachorro",
    emoji: "🐕",
    gait: "passo",
    gaitHz: 2.8,
    size: 0.95,
    partes: [
      // rabo levantado, balançando
      { pts: [[36, 46], [26, 34], [22, 24]], cor: "tinta", traco: 5, gesto: "balanca", eixo: [36, 46], amplitude: 18 },
      membro([60, 58], [[62, 82]], 6.5, "tinta", 0, 20),
      membro([52, 59], [[50, 82]], 6.5, "tinta", 0.5, 20),
      membro([40, 59], [[38, 82]], 6.5, "tinta", 0.5, 20),
      membro([34, 58], [[36, 82]], 6.5, "tinta", 0, 20),
      { pts: [[36, 50], [58, 50]], cor: "tinta", traco: 15, gesto: "sobe", amplitude: 1, defasagem: 0 },
      // pescoço e cabeça
      { pts: [[58, 48], [64, 40]], cor: "tinta", traco: 12, gesto: "sobe", amplitude: 1, defasagem: 0 },
      { pts: circulo(68, 40, 9, 20), cor: "tinta", fecha: true, gesto: "sobe", amplitude: 1, defasagem: 0 },
      // focinho
      { pts: [[74, 43], [84, 42]], cor: "tinta", traco: 7, gesto: "sobe", amplitude: 1, defasagem: 0 },
      // orelha caída
      { pts: [[63, 33], [58, 24], [66, 30]], cor: "acento", fecha: true, gesto: "sobe", amplitude: 1, defasagem: 0 },
      { pts: circulo(84, 42, 1.8, 8), cor: "acento", fecha: true, gesto: "sobe", amplitude: 1, defasagem: 0 },
      // coleira
      { pts: [[59, 50], [66, 46]], cor: "acento", traco: 3 },
    ],
  },
  {
    id: "barco",
    name: "Barco",
    emoji: "⛵",
    gait: "flutua",
    gaitHz: 0.9,
    partes: [
      // a água fica parada; o barco é que balança
      { pts: [[8, 86], [32, 86]], cor: "suave", traco: 3.5 },
      { pts: [[64, 90], [92, 90]], cor: "suave", traco: 3.5 },
      {
        pts: [[14, 62], [88, 62], [76, 82], [26, 82]],
        cor: "tinta",
        fecha: true,
        gesto: "balanca",
        eixo: [51, 64],
        amplitude: 2.5,
      },
      { pts: [[52, 62], [52, 10]], cor: "tinta", traco: 4.5, gesto: "balanca", eixo: [51, 64], amplitude: 2.5 },
      { pts: [[57, 15], [57, 58], [86, 58]], cor: "acento", fecha: true, gesto: "balanca", eixo: [51, 64], amplitude: 2.5 },
      { pts: [[47, 21], [47, 58], [20, 58]], cor: "acento", fecha: true, gesto: "balanca", eixo: [51, 64], amplitude: 2.5 },
    ],
  },
  {
    id: "aviao",
    name: "Avião",
    emoji: "✈️",
    gait: "flutua",
    gaitHz: 0.55,
    rotate: true,
    baseAngle: -90,
    partes: [
      // asa de cima e de baixo, varridas para trás
      {
        pts: [[56, 46], [38, 18], [29, 20], [46, 48]],
        cor: "tinta",
        fecha: true,
        gesto: "sobe",
        amplitude: 1.5,
        defasagem: 0,
      },
      {
        pts: [[56, 54], [38, 82], [29, 80], [46, 52]],
        cor: "tinta",
        fecha: true,
        gesto: "sobe",
        amplitude: 1.5,
        defasagem: 0,
      },
      // estabilizadores da cauda
      {
        pts: [[20, 46], [8, 34], [4, 37], [14, 48]],
        cor: "acento",
        fecha: true,
        gesto: "sobe",
        amplitude: 1.5,
        defasagem: 0,
      },
      {
        pts: [[20, 54], [8, 66], [4, 63], [14, 52]],
        cor: "acento",
        fecha: true,
        gesto: "sobe",
        amplitude: 1.5,
        defasagem: 0,
      },
      // fuselagem
      {
        pts: [[94, 50], [78, 44], [20, 45], [10, 50], [20, 55], [78, 56]],
        cor: "tinta",
        fecha: true,
        gesto: "sobe",
        amplitude: 1.5,
        defasagem: 0,
      },
      // janelas: um risco no acento diz que é avião de passageiros
      { pts: [[30, 50], [72, 50]], cor: "acento", traco: 2.5, gesto: "sobe", amplitude: 1.5, defasagem: 0 },
    ],
  },
];

export function findIcone(id: string | undefined): Icone | null {
  if (!id) return null;
  return ICONES.find((i) => i.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* o desenho, aplicado                                                */
/* ------------------------------------------------------------------ */

/**
 * As cores do desenho.
 *
 * Não há "modo claro": o selo é sempre escuro (é ele que dá contraste sobre o
 * mapa, claro ou escuro), então a tinta é sempre clara.
 */
export function coresDoIcone(accent: string): Record<CorDoIcone, string> {
  return { tinta: "#f4f4f5", acento: accent, suave: "#a1a1aa" };
}

export type PartePintada = {
  pts: Ponto[];
  cor: CorDoIcone;
  traco?: number;
  fecha: boolean;
};

/**
 * Onde cada parte está no ciclo.
 *
 * `ganho` (0 a 1) é a força do movimento: 0 no voo de abertura e na cartela —
 * como o balanço do selo, o desenho entra andando e chega parando.
 */
export function pintarIcone(icone: Icone, fase: number, ganho = 1): PartePintada[] {
  return icone.partes.map((p) => {
    const amp = (p.amplitude ?? 0) * ganho;
    const f = fase + (p.defasagem ?? 0);
    let girar = 0;
    let dy = 0;
    switch (p.gesto) {
      case "gira":
        /*
         * Uma volta por ciclo, sem hesitar no caminho — mas **parada** quando não
         * há ganho: no voo de abertura e na cartela ninguém está pedalando, e uma
         * roda girando sozinha ali seria um ventilador.
         */
        girar = 360 * f * ganho;
        break;
      case "passo":
      case "balanca":
        girar = amp * Math.sin(f * TAU);
        break;
      case "sobe":
        dy = amp * Math.sin(f * TAU);
        break;
    }
    const [ex, ey] = p.eixo ?? [50, 50];
    const rad = (girar * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sen = Math.sin(rad);
    const pts = p.pts.map(([x, y]) => {
      // giro em torno do eixo, e depois o sobe/desce
      const dx = x - ex;
      const dyy = y - ey;
      return [redondo(ex + dx * cos - dyy * sen), redondo(ey + dx * sen + dyy * cos + dy)] as Ponto;
    });
    return { pts, cor: p.cor, traco: p.traco, fecha: !!p.fecha };
  });
}

/** A casca: quanto ela avança para fora de cada traço, em unidades do ícone. */
const CASCA_LARGURA = 3;

function tracarParte(
  ctx: CanvasRenderingContext2D,
  parte: PartePintada,
  cor: string,
  extra: number,
): void {
  ctx.beginPath();
  parte.pts.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (parte.fecha) ctx.closePath();
  const largura = (parte.traco ?? 0) + extra * 2;
  if (largura > 0) {
    ctx.strokeStyle = cor;
    ctx.lineWidth = largura;
    ctx.stroke();
  }
  if (parte.fecha && !parte.traco) {
    ctx.fillStyle = cor;
    ctx.fill();
  } else if (parte.fecha) {
    // forma com contorno: o miolo também é preenchido
    ctx.fillStyle = cor;
    ctx.fill();
  }
}

/**
 * Desenha o ícone no canvas, com o centro do quadrado de 0 a 100 em (x, y) e o
 * lado em pixels. É o desenho do vídeo.
 *
 * Duas passadas: primeiro a **casca** de todas as partes (um traço mais grosso
 * na cor do selo), depois o desenho. É o que separa a perna da frente da de
 * trás sem precisar de duas cores.
 */
export function desenharIcone(
  ctx: CanvasRenderingContext2D,
  opts: {
    icone: Icone;
    /** centro do desenho, em pixels */
    x: number;
    y: number;
    /** lado do quadrado de 100 unidades, em pixels */
    lado: number;
    accent: string;
    /** em que ponto do ciclo está (ver `pintarIcone`) */
    fase?: number;
    ganho?: number;
    /** −1 espelha (personagem indo para a esquerda); 1, não */
    virado?: number;
  },
): void {
  const { icone, x, y, lado, accent } = opts;
  const cores = coresDoIcone(accent);
  const escala = lado / 100;
  const partes = pintarIcone(icone, opts.fase ?? 0, opts.ganho ?? 1);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(opts.virado === -1 ? -1 : 1, 1);
  ctx.scale(escala, escala);
  ctx.translate(-50, -50);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const parte of partes) tracarParte(ctx, parte, CASCA, CASCA_LARGURA);
  for (const parte of partes) {
    // a casca já desenhou o miolo das formas: aqui vai só o traço/tinta
    if (parte.traco) tracarParte(ctx, { ...parte, fecha: false }, cores[parte.cor], 0);
    else tracarParte(ctx, parte, cores[parte.cor], 0);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* o mesmo desenho em SVG, animado                                     */
/* ------------------------------------------------------------------ */

const svgPts = (pts: Ponto[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

/** `rotate(a cx cy)` amostrado — o SMIL interpola entre os pontos. */
function valoresDeGiro(parte: ParteDoIcone): string {
  const amp = parte.amplitude ?? 0;
  const [ex, ey] = parte.eixo ?? [50, 50];
  const n = 16;
  const valores: string[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = amp * Math.sin((parte.defasagem ?? 0) * TAU + (i / n) * TAU);
    valores.push(`${redondo(ang)} ${ex} ${ey}`);
  }
  return valores.join(";");
}

function animateDoGesto(parte: ParteDoIcone, hz: number): string {
  const dur = (1 / Math.max(0.05, hz)).toFixed(3);
  const atraso = `-${((parte.defasagem ?? 0) / Math.max(0.05, hz)).toFixed(3)}s`;
  if (parte.gesto === "gira") {
    const [ex, ey] = parte.eixo ?? [50, 50];
    return `<animateTransform attributeName="transform" type="rotate" values="0 ${ex} ${ey};360 ${ex} ${ey}" dur="${dur}s" repeatCount="indefinite" calcMode="linear"/>`;
  }
  if (parte.gesto === "sobe") {
    const amp = parte.amplitude ?? 0;
    const n = 16;
    const valores: string[] = [];
    for (let i = 0; i <= n; i++) {
      const ang = amp * Math.sin((parte.defasagem ?? 0) * TAU + (i / n) * TAU);
      valores.push(`0 ${redondo(ang)}`);
    }
    return `<animateTransform attributeName="transform" type="translate" values="${valores.join(";")}" dur="${dur}s" begin="${atraso}" repeatCount="indefinite" calcMode="linear"/>`;
  }
  return `<animateTransform attributeName="transform" type="rotate" values="${valoresDeGiro(parte)}" dur="${dur}s" begin="${atraso}" repeatCount="indefinite" calcMode="linear"/>`;
}

/**
 * Uma parte em SVG.
 *
 * `casca` desenha o contorno grosso na cor do selo (a camada de baixo);
 * `solta` desenha o traço vazio, sem preencher o miolo — é o que deixa a casca
 * aparecer no meio de uma forma fechada.
 */
function formaDaParte(
  parte: PartePintada,
  cor: string,
  corDaCasca: string,
  casca: boolean,
): string {
  const tag = parte.fecha ? "polygon" : "polyline";
  const pontos = svgPts(parte.pts);
  if (casca) {
    const largura = (parte.traco ?? 0) + CASCA_LARGURA * 2;
    if (largura <= 0) return "";
    return `<${tag} points="${pontos}" fill="${corDaCasca}" stroke="${corDaCasca}" stroke-width="${largura}"/>`;
  }
  /*
   * Parte **com traço** é contorno, nunca preenchimento — inclusive quando o
   * caminho é fechado (o aro da roda): é o que o canvas faz, e é o que mantém o
   * miolo vazado para a cor do selo aparecer. Sem traço, é silhueta preenchida
   * (o corpo do carro, a cabeça do caminhante).
   */
  if (parte.traco) {
    return `<${tag} points="${pontos}" fill="none" stroke="${cor}" stroke-width="${parte.traco}"/>`;
  }
  return `<${tag} points="${pontos}" fill="${cor}"/>`;
}

/**
 * O ícone como **SVG animado** — o desenho do mapa e do painel.
 *
 * `hz` é a cadência do ícone (a mesma do vídeo): com ela, cada parte ganha o
 * seu `<animateTransform>`; sem ela (ou com 0), sai um quadro parado na `fase`
 * pedida — é o que serve para miniatura, para o painel e para teste.
 */
export function svgDoIcone(
  icone: Icone,
  opts: {
    accent: string;
    /** lado do desenho em px (o quadrado é sempre 0..100) */
    lado?: number;
    /** ciclos por segundo; 0 desliga a animação */
    hz?: number;
    fase?: number;
    ganho?: number;
    virado?: -1 | 1;
    /** classes extras no `<svg>` */
    classe?: string;
  },
): string {
  const { accent } = opts;
  const lado = opts.lado ?? 100;
  const hz = opts.hz ?? 0;
  const cores = coresDoIcone(accent);
  const animado = hz > 0;

  /*
   * A casca é uma camada só, embaixo de tudo: um traço grosso na cor do selo em
   * volta de cada parte. E o desenho vai **parado** quando há animação — quem
   * move é o `<g>` em volta de cada parte, para o navegador animar sozinho.
   */
  const pintadas = pintarIcone(icone, opts.fase ?? 0, opts.ganho ?? 1);
  const geometria = (i: number): PartePintada =>
    animado
      ? {
          pts: icone.partes[i].pts,
          cor: icone.partes[i].cor,
          traco: icone.partes[i].traco,
          fecha: !!icone.partes[i].fecha,
        }
      : pintadas[i];

  /*
   * **Parado**: duas camadas — todas as cascas e depois todo o desenho. É o
   * mesmo que o canvas faz, e o que separa uma perna da outra sem emenda.
   *
   * **Animado**: cada parte é um `<g>` com a sua casca e o seu desenho, e é o
   * `<g>` que gira. A casca anda junto com o membro (senão ela ficaria parada
   * no lugar e o contorno sairia do desenho); como ela é da cor do selo, o
   * contorno de uma parte coberta por outra simplesmente some — é assim que o
   * pictograma se lê.
   */
  const partes = icone.partes.map((original, i) => {
    const parte = geometria(i);
    const casca = formaDaParte(parte, CASCA, CASCA, true);
    const forma = formaDaParte(parte, cores[parte.cor], CASCA, false);
    if (!animado) return { casca, corpo: forma, gesto: null as string | null };
    const gesto = original.gesto ? animateDoGesto(original, hz) : "";
    return { casca, corpo: forma, gesto };
  });

  const cascas = !animado ? partes.map((p) => p.casca).join("") : "";
  const corpo = partes
    .map((p) =>
      p.gesto ? `<g>${p.casca}${p.corpo}${p.gesto}</g>` : `${p.casca}${p.corpo}`,
    )
    .join("");

  const espelho = opts.virado === -1 ? ` style="transform:scaleX(-1)"` : "";
  const classe = opts.classe ? ` class="${opts.classe}"` : "";
  return (
    `<svg${classe} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${lado}" height="${lado}"` +
    ` role="img" aria-label="${icone.name}"${espelho}>` +
    (cascas ? `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${cascas}</g>` : "") +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${corpo}</g>` +
    `</svg>`
  );
}
