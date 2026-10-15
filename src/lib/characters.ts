/** Como o personagem anda: a pé, rolando ou flutuando. */
export type Gait = "passo" | "roda" | "flutua";

export type Character = {
  id: string;
  name: string;
  emoji: string;
  group: "Veículos" | "Pessoas" | "Bichos" | "Voadores" | "Esportes";
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
