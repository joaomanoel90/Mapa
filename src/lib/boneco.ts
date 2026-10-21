/**
 * O **boneco com o rosto**: a foto de quem fez o percurso como cabeça de uma
 * figura desenhada — pedalando, correndo ou andando.
 *
 * É a resposta ao "colocar o rosto no boneco que parece pedalando, correndo,
 * andando". O avatar que já existia trocava o emoji **dentro do selo** (a foto
 * num aro redondo, sem corpo); aqui a foto vira a cabeça de um boneco de corpo
 * inteiro, com pernas e braços que se mexem no ritmo do percurso e um quadro de
 * bike quando a pose é pedalar.
 *
 * Três decisões que valem a leitura antes de mexer:
 *
 * - **o rosto nunca é espelhado.** O corpo vira para o lado do rumo (a figura
 *   olha para onde vai), mas a foto é desenhada fora do espelho: um rosto
 *   espelhado é uma pessoa diferente.
 * - **o boneco é desenhado em unidades do selo**, não em pixels: o mesmo desenho
 *   sai igual no 16:9 e no 9:16, no zoom de perto e no de longe. Quem chama
 *   passa o `badge` (o raio do personagem em pixels) e o resto é proporção.
 * - **nada de pulo.** O corpo sobe no máximo 4% do selo — o usuário já reclamou
 *   de personagem quicando, e um boneco de verdade anda com o quadril estável.
 *
 * A geometria é uma função pura (`geometriaDoBoneco`), e é ela que os testes
 * conferem: pés no chão, pernas alternando, cabeça no lugar. O desenho só
 * pinta o que a geometria diz.
 */

import { coverSquare, type PhotoImage } from "./photos";

/** Como o boneco se mexe. */
export type BonecoPose = "pedala" | "corre" | "anda";

/** O ajuste do painel: uma pose, ou desligado. */
export type Boneco = BonecoPose | "off";

export const BONECO_POSES: { id: BonecoPose; label: string; icon: string }[] = [
  { id: "pedala", label: "Pedalando", icon: "🚴" },
  { id: "corre", label: "Correndo", icon: "🏃" },
  { id: "anda", label: "Andando", icon: "🚶" },
];

/** O ajuste vale uma pose? (`"off"`, vazio e lixo não valem.) */
export function bonecoLigado(b: Boneco | undefined | null): b is BonecoPose {
  return b === "pedala" || b === "corre" || b === "anda";
}

/**
 * Para que lado o boneco olha: 1 = direita, -1 = esquerda.
 *
 * O rumo é em graus (0 = norte). Só vira para a esquerda quando o percurso vai
 * claramente para a esquerda (`sen < -0.25`): no rumo quase reto (subindo ou
 * descendo no quadro) a figura fica de perfil para a direita, como os emojis do
 * app — e não pisca de lado a lado a cada ponto do traçado.
 */
export function viradoPara(rumoGraus: number): 1 | -1 {
  const rad = (rumoGraus * Math.PI) / 180;
  return Math.sin(rad) < -0.25 ? -1 : 1;
}

/**
 * Cadência de cada pose, em ciclos por segundo.
 *
 * É fixa por pose (e não a do personagem escolhido): pedalada de 1,15 volta por
 * segundo é o ritmo de quem pedala de verdade (~70 rpm); os 4,5 "passos" por
 * segundo de quem tem roda fariam a bike girar como um ventilador.
 */
const CADENCIA: Record<BonecoPose, number> = { pedala: 1.15, corre: 2.9, anda: 1.8 };

/** A volta do ciclo (0, 0.5, 1, …) no instante `seg` do percurso. */
export function faseDoBoneco(pose: BonecoPose, seg: number): number {
  return Math.max(0, seg) * CADENCIA[pose];
}

/* ------------------------------------------------------------------ */
/* Geometria (unidades do selo, y para baixo, chão em y = 0)          */
/* ------------------------------------------------------------------ */

export type Ponto = { x: number; y: number };

/** Um membro de dois ossos: raiz → articulação → ponta. */
export type Membro = { raiz: Ponto; articulacao: Ponto; ponta: Ponto };

export type GeometriaBoneco = {
  /** centro da cabeça (onde entra a foto) */
  cabeca: Ponto;
  ombro: Ponto;
  quadril: Ponto;
  /** perna mais perto de quem olha (a que fica por cima do quadro da bike) */
  pernaPerto: Membro;
  pernaLonge: Membro;
  bracoPerto: Membro;
  bracoLonge: Membro;
  /** rodas do quadro (só na pose de pedalar) */
  rodas: { tras: Ponto; frente: Ponto; raio: number } | null;
  /** o quadro da bike, em polilinha (só na pose de pedalar) */
  quadro: Ponto[] | null;
  /** o selim (só na pose de pedalar) — fecha o quadro entre o pedal e a frente */
  selim: Ponto | null;
  /** onde o guidão é segurado (só na pose de pedalar) */
  guidao: Ponto | null;
  /** deslocamento do corpo no ciclo (fração do selo; negativo = sobe) */
  embalo: number;
};

/**
 * Raio da cabeça (a foto), em unidades do selo.
 *
 * A proporção é de desenho animado — a cabeça é ~1/3 da altura, e não 1/7 como
 * num corpo real. É o que faz o rosto ser reconhecível num selo de 60 px: um
 * rosto em escala real vira um pontinho.
 */
export const BONECO_CABECA = 0.235;
/**
 * Onde os pés tocam o mapa, em unidades do selo.
 *
 * É **zero**: o boneco fica em pé **no ponto do percurso**, e não centrado nele
 * como o selo redondo. É o que faz a figura "andar sobre a linha" — deslocada
 * para baixo, ela flutuaria abaixo do traçado.
 */
export const BONECO_CHAO = 0;
/**
 * Altura do boneco (do chão ao alto da cabeça), em unidades do selo.
 *
 * Serve para quem precisa **sair da frente** dele: o bloco de uma parada usa
 * este número para não cobrir a figura quando ela passa.
 */
export const BONECO_ALTURA = 1.62;

/**
 * A caixa que o boneco ocupa na tela, em pixels — do chão ao alto da cabeça.
 *
 * Serve para os blocos das paradas **saírem da frente dele**: o selo redondo é
 * um círculo em volta do ponto, e o boneco é uma figura em pé, quase três vezes
 * mais alta que o selo. Com a caixa do selo, o nome da parada continuava
 * aparecendo no meio do corpo.
 */
export function caixaDoBoneco(
  at: { x: number; y: number },
  badge: number,
): { x: number; y: number; w: number; h: number } {
  const meia = 0.62 * badge;
  const alto = BONECO_ALTURA * badge;
  return { x: at.x - meia, y: at.y - alto, w: meia * 2, h: alto + 0.12 * badge };
}

const QUADRIL_Y = -0.58;
const COXA = 0.30;
const CANELA = 0.30;
const TRONCO = 0.46;
const BRACO = 0.17;
const ANTEBRACO = 0.15;

/** Ponto a `comprimento` de `a`, com o ângulo 0 apontando para baixo. */
function aoLongo(a: Ponto, angulo: number, comprimento: number): Ponto {
  return {
    x: a.x + Math.sin(angulo) * comprimento,
    y: a.y + Math.cos(angulo) * comprimento,
  };
}

/**
 * A articulação de um membro de dois ossos que liga `raiz` a `ponta`.
 *
 * Serve para a perna de quem pedala (o pé está no pedal, e o joelho tem de
 * ficar onde os dois ossos alcançam) e para o braço no guidão. Entre as duas
 * soluções possíveis, fica a que põe a articulação **para a frente** (+x) — é o
 * joelho de quem pedala e o cotovelo de quem segura o guidão.
 */
function articulacao(raiz: Ponto, ponta: Ponto, l1: number, l2: number): Ponto {
  const dx = ponta.x - raiz.x;
  const dy = ponta.y - raiz.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const alcance = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d));
  const a = (l1 * l1 - l2 * l2 + alcance * alcance) / (2 * alcance);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d;
  const uy = dy / d;
  const base = { x: raiz.x + ux * a, y: raiz.y + uy * a };
  const p1 = { x: base.x - uy * h, y: base.y + ux * h };
  const p2 = { x: base.x + uy * h, y: base.y - ux * h };
  return p1.x > p2.x ? p1 : p2;
}

/** A perna de quem anda/corre: pêndulo com o joelho dobrando para trás. */
function pernaDePasso(quadril: Ponto, angulo: number, dobra: number): Membro {
  const flexao = Math.max(0, -angulo) * dobra + 0.08;
  const joelho = aoLongo(quadril, angulo, COXA);
  const pe = aoLongo(joelho, angulo - flexao, CANELA);
  return { raiz: quadril, articulacao: joelho, ponta: pe };
}

const semRodas = { rodas: null, quadro: null, selim: null, guidao: null } as const;

/**
 * Onde cada parte do boneco está, no ciclo `fase` (0..1 = uma passada).
 *
 * Tudo em unidades do selo, com o chão em y = 0 e o corpo para cima (y
 * negativo). O boneco olha para +x; quem desenha espelha quando precisa.
 */
export function geometriaDoBoneco(pose: BonecoPose, fase: number): GeometriaBoneco {
  const volta = fase * Math.PI * 2;

  if (pose === "pedala") {
    const raio = 0.20;
    const rodas = {
      tras: { x: -0.40, y: -raio },
      frente: { x: 0.42, y: -raio },
      raio,
    };
    const eixo = { x: 0.01, y: -0.33 };
    const manivela = 0.085;
    const quadril = { x: -0.10, y: -0.62 };
    const ombro = { x: quadril.x + Math.sin(0.5) * 0.38, y: quadril.y - Math.cos(0.5) * 0.38 };
    const cabeca = {
      x: ombro.x + Math.sin(0.32) * 0.285,
      y: ombro.y - Math.cos(0.32) * 0.285,
    };
    const guidao = { x: 0.32, y: -0.72 };
    const selim = { x: -0.17, y: -0.62 };
    const testa = { x: 0.32, y: -0.62 };

    const pedal = (angulo: number) => ({
      x: eixo.x + Math.cos(angulo) * manivela,
      y: eixo.y + Math.sin(angulo) * manivela,
    });
    const pePerto = pedal(volta);
    const peLonge = pedal(volta + Math.PI);

    return {
      cabeca,
      ombro,
      quadril,
      pernaPerto: {
        raiz: quadril,
        articulacao: articulacao(quadril, pePerto, COXA, CANELA),
        ponta: pePerto,
      },
      pernaLonge: {
        raiz: quadril,
        articulacao: articulacao(quadril, peLonge, COXA, CANELA),
        ponta: peLonge,
      },
      bracoPerto: {
        raiz: ombro,
        articulacao: articulacao(ombro, guidao, BRACO, ANTEBRACO),
        ponta: guidao,
      },
      bracoLonge: {
        raiz: ombro,
        articulacao: articulacao(ombro, guidao, BRACO, ANTEBRACO),
        ponta: guidao,
      },
      rodas,
      // escora, tubo diagonal e garfo: a espinha do quadro
      quadro: [rodas.tras, eixo, testa, rodas.frente],
      selim,
      guidao,
      // a bike não pula: o corpo só respira com a pedalada
      embalo: Math.sin(volta * 2) * 0.006,
    };
  }

  const correndo = pose === "corre";
  const amplitude = correndo ? 0.85 : 0.55;
  const dobra = correndo ? 1.5 : 1.0;
  const inclinacao = correndo ? 0.17 : 0.03;
  const balancoBraco = correndo ? 0.85 : 0.40;
  const dobraBraco = correndo ? 1.25 : 0.55;

  const quadril = { x: 0, y: QUADRIL_Y };
  const ombro = {
    x: quadril.x + Math.sin(inclinacao) * TRONCO,
    y: quadril.y - Math.cos(inclinacao) * TRONCO,
  };
  const cabeca = {
    x: ombro.x + Math.sin(inclinacao * 0.6) * 0.27,
    y: ombro.y - Math.cos(inclinacao * 0.6) * 0.27,
  };

  const theta = Math.sin(volta) * amplitude;
  const thetaLonge = -theta;

  /*
   * O braço sai do **lado** do ombro (e não do meio do peito): saindo do centro,
   * ele ficava escondido dentro do tronco e a figura parecia sem braços.
   */
  const braco = (angulo: number, lado: 1 | -1): Membro => {
    const raiz = { x: ombro.x + lado * 0.10, y: ombro.y + 0.02 };
    const cotovelo = aoLongo(raiz, angulo, BRACO);
    return {
      raiz,
      articulacao: cotovelo,
      ponta: aoLongo(cotovelo, angulo + dobraBraco, ANTEBRACO),
    };
  };

  return {
    cabeca,
    ombro,
    quadril,
    pernaPerto: pernaDePasso(quadril, theta, dobra),
    pernaLonge: pernaDePasso(quadril, thetaLonge, dobra),
    bracoPerto: braco(-theta * balancoBraco, 1),
    bracoLonge: braco(theta * balancoBraco, -1),
    ...semRodas,
    /*
     * O embalo é o quadril subindo e descendo no ritmo do passo — 2% do selo na
     * caminhada e 4% na corrida. É o mínimo para o corpo não parecer flutuando,
     * e longe do "pulinho" que o usuário recusou.
     */
    embalo: -Math.abs(Math.sin(volta)) * (correndo ? 0.04 : 0.02),
  };
}

/* ------------------------------------------------------------------ */
/* Desenho                                                            */
/* ------------------------------------------------------------------ */

/** `#rgb` / `#rrggbb` + alfa → `rgba(...)`. (O renderer tem um igual, privado.) */
function comAlfa(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * A cor do corpo.
 *
 * O boneco é uma **silhueta clara** no mapa escuro e uma silhueta escura no mapa
 * claro — o contrário some. O contorno é sempre o acento do app: é ele que
 * separa a figura do mapa quando o tom do fundo é parecido com o do corpo.
 */
const corpoDe = (onDark: boolean) => (onDark ? "#eef2fb" : "#161d2b");
const longeDe = (onDark: boolean) => (onDark ? "#9aa6bd" : "#5b6b85");

/** Um membro desenhado com contorno: o interior por cima da borda. */
function pintarMembro(
  ctx: CanvasRenderingContext2D,
  m: Membro,
  largura: number,
  cor: string,
  borda: string,
) {
  ctx.beginPath();
  ctx.moveTo(m.raiz.x, m.raiz.y);
  ctx.lineTo(m.articulacao.x, m.articulacao.y);
  ctx.lineTo(m.ponta.x, m.ponta.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = largura;
  ctx.strokeStyle = borda;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.015, largura - 0.035);
  ctx.strokeStyle = cor;
  ctx.stroke();
}

/**
 * O tronco: ombros mais largos que o quadril, com o contorno do acento.
 *
 * É um trapézio de cantos arredondados, e não uma cápsula: a cápsula deixava o
 * boneco com cara de pino de totem — o ombro estreito é o que lê como "gente".
 */
function pintarTronco(
  ctx: CanvasRenderingContext2D,
  quadril: Ponto,
  ombro: Ponto,
  cor: string,
  borda: string,
) {
  const dx = ombro.x - quadril.x;
  const dy = ombro.y - quadril.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  // perpendicular ao tronco: é a largura de cada lado
  const px = -dy / d;
  const py = dx / d;
  const larguraOmbro = 0.135;
  const larguraQuadril = 0.105;

  ctx.beginPath();
  ctx.moveTo(ombro.x - px * larguraOmbro, ombro.y - py * larguraOmbro);
  ctx.lineTo(quadril.x - px * larguraQuadril, quadril.y - py * larguraQuadril);
  ctx.quadraticCurveTo(
    quadril.x - px * larguraQuadril * 1.25,
    quadril.y + 0.04,
    quadril.x + px * larguraQuadril,
    quadril.y + py * larguraQuadril,
  );
  ctx.lineTo(ombro.x + px * larguraOmbro, ombro.y + py * larguraOmbro);
  ctx.quadraticCurveTo(
    ombro.x + px * larguraOmbro * 0.75,
    ombro.y - 0.07,
    ombro.x - px * larguraOmbro,
    ombro.y - py * larguraOmbro,
  );
  ctx.closePath();
  ctx.fillStyle = cor;
  ctx.fill();
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = borda;
  ctx.stroke();
}

/**
 * O pé: uma linha curta no fim da perna, apontando para a frente.
 *
 * Sem ele a perna termina num toco redondo, e o boneco parece um manequim sem
 * sapatos. A linha é desenhada no espaço já espelhado, então o pé aponta para
 * onde o boneco olha.
 */
function pintarPe(
  ctx: CanvasRenderingContext2D,
  ponta: Ponto,
  cor: string,
  borda: string,
) {
  ctx.beginPath();
  ctx.moveTo(ponta.x - 0.035, ponta.y);
  ctx.lineTo(ponta.x + 0.085, ponta.y);
  ctx.lineCap = "round";
  ctx.lineWidth = 0.085;
  ctx.strokeStyle = borda;
  ctx.stroke();
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = cor;
  ctx.stroke();
}

/** A foto no lugar da cabeça, com o aro do app. */
function pintarCabeca(
  ctx: CanvasRenderingContext2D,
  r: number,
  avatar: PhotoImage,
  accent: string,
  onDark: boolean,
) {
  // o fundo aparece por trás das bordas da foto recortada
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = onDark ? "#0d1119" : "#f4f7fd";
  ctx.fill();

  const c = coverSquare(Number(avatar.width) || r * 2, Number(avatar.height) || r * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    avatar as CanvasImageSource,
    c.sx,
    c.sy,
    c.size,
    c.size,
    -r,
    -r,
    r * 2,
    r * 2,
  );
  ctx.restore();

  // aro branco fino (separa a foto do aro do acento, como no avatar do selo)
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.stroke();

  // aro do acento por fora
  ctx.beginPath();
  ctx.arc(0, 0, r + ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, r * 0.11);
  ctx.strokeStyle = accent;
  ctx.stroke();
}

/** A sombra no chão: é ela que assenta o boneco no mapa. */
function pintarSombra(ctx: CanvasRenderingContext2D, largura: number) {
  ctx.beginPath();
  ctx.ellipse(0, 0, largura, largura * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fill();
}

/** As rodas: aro do acento e três raios que giram com a pedalada. */
function pintarRodas(
  ctx: CanvasRenderingContext2D,
  rodas: { tras: Ponto; frente: Ponto; raio: number },
  giro: number,
  accent: string,
) {
  for (const centro of [rodas.tras, rodas.frente]) {
    ctx.beginPath();
    ctx.arc(centro.x, centro.y, rodas.raio, 0, Math.PI * 2);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = giro + (i * Math.PI * 2) / 3;
      ctx.moveTo(centro.x, centro.y);
      ctx.lineTo(centro.x + Math.cos(a) * rodas.raio * 0.86, centro.y + Math.sin(a) * rodas.raio * 0.86);
    }
    ctx.lineWidth = 0.014;
    ctx.strokeStyle = comAlfa(accent, 0.75);
    ctx.stroke();
  }
}

/**
 * Desenha o boneco com a foto no lugar da cabeça.
 *
 * A origem é o **ponto do personagem** no quadro (quem chama já transladou até
 * lá). O boneco é desenhado em unidades do selo: 1 = `badge` pixels.
 */
export function desenharBoneco(
  ctx: CanvasRenderingContext2D,
  o: {
    pose: BonecoPose;
    /** segundos de percurso decorridos (0 no voo e na cartela: o boneco para) */
    seg: number;
    /** 1 = olhando para a direita; -1 = para a esquerda */
    virado: 1 | -1;
    /** raio do selo do personagem, em pixels */
    badge: number;
    accent: string;
    avatar: PhotoImage;
    /** o mapa embaixo é escuro? (decide a cor do corpo) */
    onDark: boolean;
  },
) {
  const { pose, seg, virado, badge, accent, avatar, onDark } = o;
  const CORPO = corpoDe(onDark);
  const CORPO_LONGE = longeDe(onDark);
  const fase = faseDoBoneco(pose, seg);
  const g = geometriaDoBoneco(pose, fase);
  const u = badge;

  ctx.save();
  ctx.translate(0, BONECO_CHAO * u);

  // a sombra fica no chão: ela não sobe com o embalo do corpo
  ctx.save();
  ctx.scale(u * virado, u);
  pintarSombra(ctx, pose === "pedala" ? 0.62 : 0.40);
  ctx.restore();

  /*
   * O corpo (menos a cabeça) é desenhado espelhado quando o rumo vai para a
   * esquerda. A cabeça fica de fora: espelhar a foto mostraria outra pessoa.
   */
  ctx.save();
  ctx.scale(u, u);
  ctx.translate(0, g.embalo);
  ctx.save();
  ctx.scale(virado, 1);

  // a perna de trás primeiro: o corpo fica na frente dela
  pintarMembro(ctx, g.pernaLonge, 0.10, CORPO_LONGE, comAlfa(accent, 0.45));
  pintarPe(ctx, g.pernaLonge.ponta, CORPO_LONGE, comAlfa(accent, 0.45));

  if (g.rodas && g.quadro) {
    pintarRodas(ctx, g.rodas, fase * 2.4 * Math.PI * 2, accent);
    ctx.beginPath();
    ctx.moveTo(g.quadro[0].x, g.quadro[0].y);
    for (const p of g.quadro.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // o selim e o tubo do selim: o banco em que o corpo está sentado
    if (g.selim) {
      ctx.beginPath();
      ctx.moveTo(g.quadro[1].x, g.quadro[1].y);
      ctx.lineTo(g.selim.x, g.selim.y);
      ctx.lineTo(g.quadro[2].x, g.quadro[2].y);
      ctx.lineWidth = 0.045;
      ctx.strokeStyle = comAlfa(accent, 0.85);
      ctx.stroke();
    }

    // o guidão, onde as mãos chegam
    if (g.guidao) {
      ctx.beginPath();
      ctx.moveTo(g.quadro[2].x, g.quadro[2].y);
      ctx.lineTo(g.guidao.x, g.guidao.y);
      ctx.lineWidth = 0.045;
      ctx.strokeStyle = accent;
      ctx.stroke();
    }
  }

  // o braço de trás, antes do tronco (ele passa por trás do corpo)
  pintarMembro(ctx, g.bracoLonge, 0.075, CORPO_LONGE, comAlfa(accent, 0.4));

  pintarTronco(ctx, g.quadril, g.ombro, CORPO, comAlfa(accent, 0.95));

  // a perna da frente, por cima do quadro da bike
  pintarMembro(ctx, g.pernaPerto, 0.10, CORPO, comAlfa(accent, 0.95));
  pintarPe(ctx, g.pernaPerto.ponta, CORPO, comAlfa(accent, 0.95));

  // e o braço da frente
  pintarMembro(ctx, g.bracoPerto, 0.075, CORPO, comAlfa(accent, 0.9));

  ctx.restore(); // fim do espelho
  ctx.restore(); // fim do embalo e da escala em unidades do selo

  /*
   * A cabeça: posição espelhada, desenho **sem** espelho, em pixels (como o
   * resto dos selos do app).
   */
  ctx.save();
  ctx.translate(virado * g.cabeca.x * u, (g.cabeca.y + g.embalo) * u);
  pintarCabeca(ctx, BONECO_CABECA * u, avatar, accent, onDark);
  ctx.restore();

  ctx.restore();
}
