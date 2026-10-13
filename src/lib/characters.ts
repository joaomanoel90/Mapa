export type Character = {
  id: string;
  name: string;
  emoji: string;
  group: "Veículos" | "Pessoas" | "Bichos" | "Voadores";
  /** gira o emoji conforme a direção da rota */
  rotate?: boolean;
  /** compensação (graus) do desenho do emoji (0 = aponta para cima) */
  baseAngle?: number;
  /** tamanho relativo do emoji */
  size?: number;
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
  { id: "walk", name: "Caminhada", emoji: "🚶", group: "Pessoas", size: 1 },
  { id: "run", name: "Corrida", emoji: "🏃", group: "Pessoas", size: 1 },
  { id: "hike", name: "Trilha", emoji: "🥾", group: "Pessoas", size: 1 },
  { id: "hero", name: "Super-herói", emoji: "🦸", group: "Pessoas", size: 1 },
  { id: "ninja", name: "Ninja", emoji: "🥷", group: "Pessoas", size: 1 },
  { id: "zombie", name: "Zumbi", emoji: "🧟", group: "Pessoas", size: 1 },
  { id: "robot", name: "Robô", emoji: "🤖", group: "Pessoas", size: 1 },
  { id: "dog", name: "Cachorro", emoji: "🐕", group: "Bichos", size: 1 },
  { id: "cat", name: "Gato", emoji: "🐈", group: "Bichos", size: 1 },
  { id: "horse", name: "Cavalo", emoji: "🐎", group: "Bichos", size: 1 },
  { id: "turtle", name: "Tartaruga", emoji: "🐢", group: "Bichos", size: 1 },
  { id: "snail", name: "Caracol", emoji: "🐌", group: "Bichos", size: 1 },
  { id: "shark", name: "Tubarão", emoji: "🦈", group: "Bichos", size: 1, rotate: true, baseAngle: 180 },
  { id: "dino", name: "Dino", emoji: "🦖", group: "Bichos", size: 1.1 },
  { id: "plane", name: "Avião", emoji: "✈️", group: "Voadores", size: 1.05, rotate: true, baseAngle: -45 },
  { id: "jet", name: "Jato", emoji: "🛩️", group: "Voadores", size: 1.05, rotate: true, baseAngle: -45 },
  { id: "heli", name: "Helicóptero", emoji: "🚁", group: "Voadores", size: 1.05, rotate: true, baseAngle: 180 },
  { id: "rocket", name: "Foguete", emoji: "🚀", group: "Voadores", size: 1.1, rotate: true, baseAngle: -45 },
  { id: "ufo", name: "OVNI", emoji: "🛸", group: "Voadores", size: 1.1 },
  { id: "balloon", name: "Balão", emoji: "🎈", group: "Voadores", size: 1 },
];

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
