/** Como o personagem anda: a pé, rolando ou flutuando. */
export type Gait = "passo" | "roda" | "flutua";

export type Character = {
  id: string;
  name: string;
  emoji: string;
  group: "Veículos" | "Pessoas" | "Ofícios" | "Bichos" | "Voadores" | "Esportes";
  /** gira o emoji conforme a direção da rota */
  rotate?: boolean;
  /** compensação (graus) do desenho do emoji (0 = aponta para cima) */
  baseAngle?: number;
  /** tamanho relativo do emoji */
  size?: number;
  /**
   * Como ele se move no vídeo.
   *
   * O emoji é um desenho parado: quem "anda" é o selo em volta. Sem isto, o
   * personagem desliza pelo traçado como um pino — o usuário viu exatamente
   * isso ("o personagem ficou muito robótico ao caminhar pelo traçado"). Quem
   * não tem passo declarado ganha o padrão do seu grupo (`gaitOf`), então só
   * os casos fora do comum precisam aparecer aqui.
   */
  gait?: Gait;
  /** passadas por segundo de vídeo (o padrão vem do tipo de andar) */
  gaitHz?: number;
  /**
   * Um emoji **pequeno** no canto do selo, por cima da figura.
   *
   * Existe porque o Unicode simplesmente não tem peregrino nem padre: o jeito
   * de ter os dois é compor — a pessoa que anda (🚶) mais a mochila (🎒), o
   * homem de preto (🤵) mais a cruz (✝️). O acessório entra com um disco escuro
   * atrás para não se perder no emoji grande, do mesmo tamanho no painel, na
   * prévia e no vídeo.
   */
  acessorio?: string;
};

export const CHARACTERS: Character[] = [
  { id: "car", name: "Carro", emoji: "🚗", group: "Veículos", size: 1 },
  { id: "suv", name: "SUV", emoji: "🚙", group: "Veículos", size: 1 },
  { id: "moto", name: "Moto", emoji: "🏍️", group: "Veículos", size: 1 },
  { id: "taxi", name: "Táxi", emoji: "🚕", group: "Veículos", size: 1 },
  { id: "bus", name: "Ônibus", emoji: "🚌", group: "Veículos", size: 1.1 },
  { id: "truck", name: "Caminhão", emoji: "🚚", group: "Veículos", size: 1.1 },
  { id: "ambulance", name: "Ambulância", emoji: "🚑", group: "Veículos", size: 1.05 },
  { id: "police", name: "Polícia", emoji: "🚓", group: "Veículos", size: 1 },
  { id: "bike", name: "Bike", emoji: "🚲", group: "Veículos", size: 1 },
  { id: "scooter", name: "Patins", emoji: "🛴", group: "Veículos", size: 1 },
  { id: "train", name: "Trem", emoji: "🚆", group: "Veículos", size: 1.1 },
  { id: "boat", name: "Barco", emoji: "🚤", group: "Veículos", size: 1, rotate: true, baseAngle: 180 },
  { id: "sail", name: "Veleiro", emoji: "⛵", group: "Veículos", size: 1, rotate: true, baseAngle: 180 },
  { id: "van", name: "Van", emoji: "🚐", group: "Veículos", size: 1.05 },
  { id: "pickup", name: "Picape", emoji: "🛻", group: "Veículos", size: 1.05 },
  { id: "fire", name: "Bombeiro", emoji: "🚒", group: "Veículos", size: 1.1 },
  { id: "tractor", name: "Trator", emoji: "🚜", group: "Veículos", size: 1.1 },
  { id: "race", name: "Fórmula", emoji: "🏎️", group: "Veículos", size: 1 },
  { id: "tuktuk", name: "Tuk-tuk", emoji: "🛺", group: "Veículos", size: 1 },
  /*
   * --- veículos que faltavam ---
   *
   * Os que existem em emoji e aparecem numa rota de verdade: a lambreta da
   * cidade, a carreta da estrada, o trem (locomotiva, trem-bala, bonde) e o
   * teleférico da serra.
   */
  { id: "moped", name: "Lambreta", emoji: "🛵", group: "Veículos", size: 1 },
  { id: "heavytruck", name: "Carreta", emoji: "🚛", group: "Veículos", size: 1.15 },
  { id: "steam", name: "Locomotiva", emoji: "🚂", group: "Veículos", size: 1.1 },
  { id: "bullet", name: "Trem-bala", emoji: "🚄", group: "Veículos", size: 1.1 },
  { id: "tram", name: "Bonde", emoji: "🚋", group: "Veículos", size: 1.05 },
  { id: "cablecar", name: "Teleférico", emoji: "🚡", group: "Veículos", size: 1.05 },
  { id: "ferry", name: "Balsa", emoji: "⛴️", group: "Veículos", size: 1.1 },
  { id: "canoe", name: "Canoa", emoji: "🛶", group: "Veículos", size: 1 },
  // "cruzeiro" também é a cruz de beira de estrada lá nas paradas: o nome diz qual é qual
  { id: "cruise", name: "Navio de cruzeiro", emoji: "🛳️", group: "Veículos", size: 1.15 },
  { id: "walk", name: "Caminhada", emoji: "🚶", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "run", name: "Corrida", emoji: "🏃", group: "Pessoas", size: 1, gait: "passo", gaitHz: 3 },
  { id: "hike", name: "Trilha", emoji: "🥾", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "hero", name: "Super-herói", emoji: "🦸", group: "Pessoas", size: 1 },
  { id: "ninja", name: "Ninja", emoji: "🥷", group: "Pessoas", size: 1 },
  { id: "zombie", name: "Zumbi", emoji: "🧟", group: "Pessoas", size: 1 },
  { id: "robot", name: "Robô", emoji: "🤖", group: "Pessoas", size: 1 },
  { id: "ghost", name: "Fantasma", emoji: "👻", group: "Pessoas", size: 1, gait: "flutua", gaitHz: 0.8 },
  { id: "mage", name: "Mago", emoji: "🧙", group: "Pessoas", size: 1.05 },
  { id: "mermaid", name: "Sereia", emoji: "🧜", group: "Pessoas", size: 1.05, gait: "flutua", gaitHz: 0.9 },
  { id: "guard", name: "Guarda", emoji: "👮", group: "Pessoas", size: 1 },
  /*
   * --- fé e caminhada (os compostos) ---
   *
   * Não existe emoji de peregrino nem de padre. Em vez de inventar um desenho
   * (que brigaria com o resto da lista), os dois são **compostos**: a figura
   * base mais um acessório pequeno no canto do selo. É o mesmo emoji em todo
   * lugar — painel, prévia e vídeo.
   */
  {
    id: "peregrino",
    name: "Peregrino",
    emoji: "🚶",
    acessorio: "🎒",
    group: "Pessoas",
    size: 1,
    gait: "passo",
    gaitHz: 1.6,
  },
  {
    id: "padre",
    name: "Padre",
    emoji: "🤵",
    acessorio: "✝️",
    group: "Pessoas",
    size: 1,
    gait: "passo",
    gaitHz: 1.7,
  },
  /*
   * --- o resto de gente que cabe no selo ---
   *
   * Cada um com o seu passo: o bebê e a pessoa idosa andam devagar, o
   * supervilão anda depressa. Quem paira (anjo, fada, gênio) sobe e desce
   * devagar, como o fantasma.
   */
  { id: "angel", name: "Anjo", emoji: "👼", group: "Pessoas", size: 0.95, gait: "flutua", gaitHz: 0.7 },
  { id: "fairy", name: "Fada", emoji: "🧚", group: "Pessoas", size: 0.95, gait: "flutua", gaitHz: 1.1 },
  { id: "vampire", name: "Vampiro", emoji: "🧛", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "genie", name: "Gênio", emoji: "🧞", group: "Pessoas", size: 1.05, gait: "flutua", gaitHz: 0.8 },
  { id: "villain", name: "Supervilão", emoji: "🦹", group: "Pessoas", size: 1, gait: "passo", gaitHz: 2.3 },
  { id: "santa", name: "Papai Noel", emoji: "🎅", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.5 },
  { id: "mrs-claus", name: "Mamãe Noel", emoji: "🤶", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.5 },
  { id: "bride", name: "Noiva", emoji: "👰", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "groom", name: "Noivo", emoji: "🤵", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "prince", name: "Príncipe", emoji: "🤴", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "princess", name: "Princesa", emoji: "👸", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "grandpa", name: "Vovô", emoji: "👴", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.5 },
  { id: "grandma", name: "Vovó", emoji: "👵", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.5 },
  { id: "baby", name: "Bebê", emoji: "👶", group: "Pessoas", size: 0.9, gait: "passo", gaitHz: 2.2 },
  { id: "elder", name: "Pessoa idosa", emoji: "🧓", group: "Pessoas", size: 1, gait: "passo", gaitHz: 1.4 },
  /*
   * --- ofícios ---
   *
   * Um grupo novo: a pessoa pelo que ela faz. É o que dá sentido a uma rota de
   * entrega, de obra ou de visita — o mapa passa a ter quem trabalha nela.
   */
  { id: "farmer", name: "Fazendeiro", emoji: "🧑‍🌾", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "cook", name: "Cozinheiro", emoji: "🧑‍🍳", group: "Ofícios", size: 1, gait: "passo", gaitHz: 2 },
  { id: "doctor", name: "Médico", emoji: "🧑‍⚕️", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "teacher", name: "Professor", emoji: "🧑‍🏫", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "student", name: "Estudante", emoji: "🧑‍🎓", group: "Ofícios", size: 1, gait: "passo", gaitHz: 2 },
  { id: "scientist", name: "Cientista", emoji: "🧑‍🔬", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "dev", name: "Programador", emoji: "🧑‍💻", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "mechanic", name: "Mecânico", emoji: "🧑‍🔧", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "worker", name: "Operário", emoji: "🧑‍🏭", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "judge", name: "Juiz", emoji: "🧑‍⚖️", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "pilot", name: "Piloto", emoji: "🧑‍✈️", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.9 },
  { id: "astronaut", name: "Astronauta", emoji: "🧑‍🚀", group: "Ofícios", size: 1, gait: "flutua", gaitHz: 0.7 },
  { id: "artist", name: "Artista", emoji: "🧑‍🎨", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "singer", name: "Cantor", emoji: "🧑‍🎤", group: "Ofícios", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "dog", name: "Cachorro", emoji: "🐕", group: "Bichos", size: 1, gait: "passo", gaitHz: 3.4 },
  { id: "cat", name: "Gato", emoji: "🐈", group: "Bichos", size: 1, gait: "passo", gaitHz: 2.6 },
  { id: "horse", name: "Cavalo", emoji: "🐎", group: "Bichos", size: 1, gait: "passo", gaitHz: 2.2 },
  { id: "turtle", name: "Tartaruga", emoji: "🐢", group: "Bichos", size: 1, gait: "passo", gaitHz: 1.1 },
  { id: "snail", name: "Caracol", emoji: "🐌", group: "Bichos", size: 1, gait: "passo", gaitHz: 0.6 },
  { id: "shark", name: "Tubarão", emoji: "🦈", group: "Bichos", size: 1, rotate: true, baseAngle: 180 },
  { id: "dino", name: "Dino", emoji: "🦖", group: "Bichos", size: 1.1 },
  { id: "dragon", name: "Dragão", emoji: "🐉", group: "Bichos", size: 1.15 },
  { id: "eagle", name: "Águia", emoji: "🦅", group: "Bichos", size: 1.05 },
  { id: "elephant", name: "Elefante", emoji: "🐘", group: "Bichos", size: 1.15 },
  { id: "deer", name: "Cervo", emoji: "🦌", group: "Bichos", size: 1.05 },
  { id: "penguin", name: "Pinguim", emoji: "🐧", group: "Bichos", size: 1 },
  { id: "croc", name: "Jacaré", emoji: "🐊", group: "Bichos", size: 1.05 },
  { id: "bee", name: "Abelha", emoji: "🐝", group: "Bichos", size: 0.85 },
  /*
   * --- o resto da fauna ---
   *
   * Boi, ovelha e galo de sítio; lobo, raposa e urso de trilha; o bicharedo de
   * zoológico. Quem nada ou voa paira devagar; quem anda tem passo.
   */
  { id: "cow", name: "Vaca", emoji: "🐄", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 1.6 },
  { id: "ox", name: "Boi", emoji: "🐂", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 1.6 },
  { id: "sheep", name: "Ovelha", emoji: "🐑", group: "Bichos", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "goat", name: "Cabra", emoji: "🐐", group: "Bichos", size: 1, gait: "passo", gaitHz: 2.4 },
  { id: "rooster", name: "Galo", emoji: "🐓", group: "Bichos", size: 0.95, gait: "passo", gaitHz: 2.8 },
  { id: "duck", name: "Pato", emoji: "🦆", group: "Bichos", size: 0.9, gait: "passo", gaitHz: 2.4 },
  { id: "owl", name: "Coruja", emoji: "🦉", group: "Bichos", size: 0.95, gait: "flutua", gaitHz: 1.4 },
  { id: "wolf", name: "Lobo", emoji: "🐺", group: "Bichos", size: 1.05, gait: "passo", gaitHz: 3 },
  { id: "fox", name: "Raposa", emoji: "🦊", group: "Bichos", size: 0.95, gait: "passo", gaitHz: 2.8 },
  { id: "bear", name: "Urso", emoji: "🐻", group: "Bichos", size: 1.15, gait: "passo", gaitHz: 1.8 },
  { id: "panda", name: "Panda", emoji: "🐼", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 1.4 },
  { id: "kangaroo", name: "Canguru", emoji: "🦘", group: "Bichos", size: 1.05, gait: "passo", gaitHz: 2.2 },
  { id: "camel", name: "Camelo", emoji: "🐫", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 1.3 },
  { id: "llama", name: "Lhama", emoji: "🦙", group: "Bichos", size: 1, gait: "passo", gaitHz: 1.8 },
  { id: "giraffe", name: "Girafa", emoji: "🦒", group: "Bichos", size: 1.15, gait: "passo", gaitHz: 1.4 },
  { id: "zebra", name: "Zebra", emoji: "🦓", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 2.2 },
  { id: "lion", name: "Leão", emoji: "🦁", group: "Bichos", size: 1.1, gait: "passo", gaitHz: 2 },
  { id: "tiger", name: "Tigre", emoji: "🐯", group: "Bichos", size: 1.05, gait: "passo", gaitHz: 2.4 },
  { id: "sloth", name: "Preguiça", emoji: "🦥", group: "Bichos", size: 1, gait: "passo", gaitHz: 0.5 },
  { id: "rabbit", name: "Coelho", emoji: "🐇", group: "Bichos", size: 0.95, gait: "passo", gaitHz: 2.6 },
  { id: "parrot", name: "Papagaio", emoji: "🦜", group: "Bichos", size: 0.95, gait: "flutua", gaitHz: 1.8 },
  { id: "butterfly", name: "Borboleta", emoji: "🦋", group: "Bichos", size: 0.85, gait: "flutua", gaitHz: 2.4 },
  { id: "whale", name: "Baleia", emoji: "🐳", group: "Bichos", size: 1.15, gait: "flutua", gaitHz: 0.5 },
  { id: "dolphin", name: "Golfinho", emoji: "🐬", group: "Bichos", size: 1.05, gait: "flutua", gaitHz: 1.4 },
  { id: "octopus", name: "Polvo", emoji: "🐙", group: "Bichos", size: 1, gait: "flutua", gaitHz: 0.9 },
  { id: "snake", name: "Cobra", emoji: "🐍", group: "Bichos", size: 1, gait: "flutua", gaitHz: 1 },
  { id: "plane", name: "Avião", emoji: "✈️", group: "Voadores", size: 1.05, rotate: true, baseAngle: -45 },
  { id: "jet", name: "Jato", emoji: "🛩️", group: "Voadores", size: 1.05, rotate: true, baseAngle: -45 },
  { id: "heli", name: "Helicóptero", emoji: "🚁", group: "Voadores", size: 1.05, rotate: true, baseAngle: 180 },
  { id: "rocket", name: "Foguete", emoji: "🚀", group: "Voadores", size: 1.1, rotate: true, baseAngle: -45 },
  { id: "ufo", name: "OVNI", emoji: "🛸", group: "Voadores", size: 1.1 },
  { id: "balloon", name: "Balão", emoji: "🎈", group: "Voadores", size: 1 },
  { id: "chute", name: "Paraquedas", emoji: "🪂", group: "Voadores", size: 1 },
  { id: "sat", name: "Satélite", emoji: "🛰️", group: "Voadores", size: 1.05 },
  { id: "cyclist", name: "Ciclista", emoji: "🚴", group: "Esportes", size: 1 },
  { id: "jockey", name: "Cavaleiro", emoji: "🏇", group: "Esportes", size: 1.05, gait: "passo", gaitHz: 2.6 },
  { id: "climb", name: "Escalada", emoji: "🧗", group: "Esportes", size: 1, gait: "passo", gaitHz: 1.2 },
  { id: "ski", name: "Esqui", emoji: "⛷️", group: "Esportes", size: 1, gait: "roda" },
  { id: "surf", name: "Surfe", emoji: "🏄", group: "Esportes", size: 1, gait: "flutua", gaitHz: 1.2 },
  { id: "swim", name: "Natação", emoji: "🏊", group: "Esportes", size: 1, gait: "flutua", gaitHz: 1.1 },
  { id: "row", name: "Remo", emoji: "🚣", group: "Esportes", size: 1, gait: "flutua", gaitHz: 1 },
  { id: "skate", name: "Skate", emoji: "🛹", group: "Esportes", size: 1, gait: "roda" },
  { id: "sled", name: "Trenó", emoji: "🛷", group: "Esportes", size: 1, gait: "roda" },
  /*
   * --- esportes ---
   *
   * Os que se vê numa rota de fim de semana: mountain bike na terra, snowboard
   * e esqui na neve, e o resto (ginástica, yoga, musculação, basquete, golfe,
   * esgrima) para uma rota que passa pela academia, pela quadra ou pelo campo.
   */
  { id: "mtb", name: "Mountain bike", emoji: "🚵", group: "Esportes", size: 1, gait: "roda" },
  { id: "snowboard", name: "Snowboard", emoji: "🏂", group: "Esportes", size: 1, gait: "roda" },
  { id: "xcski", name: "Esqui de fundo", emoji: "🎿", group: "Esportes", size: 1, gait: "roda" },
  { id: "gymnast", name: "Ginasta", emoji: "🤸", group: "Esportes", size: 1, gait: "passo", gaitHz: 2.6 },
  { id: "yoga", name: "Yoga", emoji: "🧘", group: "Esportes", size: 1, gait: "flutua", gaitHz: 0.5 },
  { id: "lifter", name: "Musculação", emoji: "🏋️", group: "Esportes", size: 1, gait: "passo", gaitHz: 1.4 },
  { id: "basket", name: "Basquete", emoji: "⛹️", group: "Esportes", size: 1, gait: "passo", gaitHz: 2.6 },
  { id: "golf", name: "Golfe", emoji: "🏌️", group: "Esportes", size: 1, gait: "passo", gaitHz: 1.6 },
  { id: "fencing", name: "Esgrima", emoji: "🤺", group: "Esportes", size: 1, gait: "passo", gaitHz: 2.6 },
];

/** Passadas por segundo de cada tipo de andar (padrão). */
const HZ_PADRAO: Record<Gait, number> = { passo: 3, roda: 4.5, flutua: 0.8 };

/**
 * Como este personagem anda.
 *
 * Sem declaração explícita, vale o grupo: quem é do grupo "Voadores" paira,
 * "Veículos" rola (roda não tem passo — e um carro pulando pareceria defeito),
 * e o resto anda a pé. Assim os personagens novos já nascem andando.
 */
export function gaitOf(c: Character): { gait: Gait; hz: number } {
  if (c.gait) return { gait: c.gait, hz: c.gaitHz ?? HZ_PADRAO[c.gait] };
  if (c.group === "Voadores") return { gait: "flutua", hz: 0.55 };
  if (c.group === "Veículos") return { gait: "roda", hz: HZ_PADRAO.roda };
  return { gait: "passo", hz: 2.4 };
}

export const ACCENTS = [
  { id: "lime", name: "Limão", value: "#a3e635" },
  { id: "cyan", name: "Ciano", value: "#22d3ee" },
  { id: "sky", name: "Azul", value: "#60a5fa" },
  { id: "violet", name: "Violeta", value: "#a78bfa" },
  { id: "pink", name: "Rosa", value: "#f472b6" },
  { id: "amber", name: "Âmbar", value: "#fbbf24" },
  { id: "orange", name: "Laranja", value: "#fb923c" },
  { id: "red", name: "Vermelho", value: "#f87171" },
];

export function findCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}
