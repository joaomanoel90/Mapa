import { BASEMAPS, type BasemapId } from "./tiles";
import type { CameraMode } from "./renderer";
import type { ColorMode } from "./coloring";
import { PHOTO_MAX_CHARS, isPhotoDataUrl } from "./photos";
import type { Profile } from "./routing";

/**
 * Limite de paradas por rota.
 *
 * Cada trecho era uma requisição ao servidor de rotas gratuito — com 60
 * paradas, 59 requisições. Desde que as coordenadas passaram a ir em punhado
 * (até 99 trechos por requisição), 3.000 paradas custam 31 requisições.
 * O teto agora existe para a tela continuar respondendo, e não para o
 * servidor: acima de `PIN_DOT_LIMIT` os pinos viram pontos no mapa.
 */
export const MAX_WAYPOINTS = 3000;

export type AspectId = "16:9" | "9:16" | "1:1" | "4:5";

export const ASPECTS: { id: AspectId; label: string; hint: string; w: number; h: number }[] = [
  { id: "16:9", label: "16:9", hint: "YouTube", w: 1280, h: 720 },
  { id: "9:16", label: "9:16", hint: "Reels / Shorts", w: 720, h: 1280 },
  { id: "1:1", label: "1:1", hint: "Feed", w: 960, h: 960 },
  { id: "4:5", label: "4:5", hint: "Instagram", w: 864, h: 1080 },
];

/**
 * O que o vídeo está mostrando: pedal, corrida ou caminhada.
 *
 * Muda a unidade do HUD: a pé, o número que interessa é o **ritmo** (min/km),
 * não a velocidade. É a única coisa que a atividade muda hoje.
 */
export type ActivityId = "pedal" | "corrida" | "caminhada";

export const ACTIVITIES: { id: ActivityId; label: string; icon: string; hint: string }[] = [
  { id: "pedal", label: "Pedal", icon: "🚴", hint: "HUD em velocidade (km/h)" },
  { id: "corrida", label: "Corrida", icon: "🏃", hint: "HUD em ritmo (min/km)" },
  { id: "caminhada", label: "Caminhada", icon: "🚶", hint: "HUD em ritmo (min/km)" },
];

/** A pé (corrida/caminhada), o HUD mostra ritmo em vez de velocidade. */
export function usaRitmo(activity: ActivityId): boolean {
  return activity !== "pedal";
}

export type Settings = {
  profile: Profile;
  /** ignora mão única: o traçado não dá voltas para "entrar na mão certa" */
  ignoreOneway: boolean;
  /** encaixa cada ponto clicado na rua mais próxima */
  snapToRoad: boolean;
  /** exibe as paradas do percurso no vídeo */
  showStops: boolean;
  /** mostra o nome de cada parada em uma etiqueta */
  showStopLabels: boolean;
  /** mostra o contador "2/5 paradas" no canto do vídeo */
  showStopCounter: boolean;
  characterId: string;
  accent: string;
  rotate: boolean;
  duration: number;
  cameraMode: CameraMode;
  followZoom: number;
  basemap: BasemapId;
  showRoute: boolean;
  showTraveled: boolean;
  showEndpoints: boolean;
  showTitle: boolean;
  showProgress: boolean;
  /** cartela com o resumo do percurso nos últimos segundos do vídeo */
  endCard: boolean;
  /** painel de números no vídeo (velocidade, andamento, distância, relógio) */
  showHud: boolean;
  /**
   * Mapa em miniatura no canto do vídeo, abaixo do título: a rota inteira com o
   * percurso já feito em destaque. Serve para quem acompanha o vídeo saber onde
   * o personagem está — na terceira pessoa só se vê alguns metros à frente.
   */
  minimap: boolean;
  /**
   * Faixa do **perfil de elevação** no rodapé do vídeo.
   *
   * Só desenha quando o traçado tem altitude — num arquivo sem `<ele>` a faixa
   * simplesmente não aparece, em vez de sair uma linha reta inventada.
   */
  elevationProfile: boolean;
  /**
   * Destaques do percurso no vídeo: a **melhor parcial** e a **maior subida**.
   *
   * Cada um aparece uma vez, num aviso curto, quando o personagem chega nele.
   * Sem hora no arquivo não há parcial; sem altitude não há subida — o aviso
   * que não tem dado simplesmente não aparece.
   */
  highlights: boolean;
  /** pedal, corrida ou caminhada — muda a unidade do HUD (km/h ou min/km) */
  activity: ActivityId;
  /**
   * Cor da linha: sólida (o de sempre), por velocidade ou por inclinação.
   * Depende de o arquivo ter hora/elevação — sem o dado a linha sai cinza.
   */
  colorBy: ColorMode;
  /** marcas de km ao longo do traçado */
  showKmMarks: boolean;
  /**
   * O aviso de **dia novo** ("DIA 2 · 41,2 km") no percurso de vários dias.
   *
   * Só tem efeito quando o arquivo tem uma noite no meio (ver
   * `diasDoPercurso`); num percurso de um dia não há o que avisar.
   */
  dias: boolean;
  /** abertura sobrevoando a região + aproximação nas paradas */
  cinematic: boolean;
  /**
   * Câmera de **terceira pessoa**: mais perto, com o personagem abaixo do
   * centro e o caminho à frente ocupando a parte de cima do quadro.
   */
  thirdPerson: boolean;
  /** na terceira pessoa, gira o mapa no rumo (o caminho sempre "para cima") */
  spinMap: boolean;
  /**
   * Na terceira pessoa, **inclina o horizonte**: a parte de cima do quadro é
   * comprimida, como o chão visto de rasão, e o que está longe aparece menor.
   */
  tiltHorizonte: boolean;
  /**
   * Um **fantasma** do personagem, translúcido, andando à frente dele na mesma
   * rota — o caminho que vem, sem tirar o olho de quem está andando.
   *
   * Não muda a velocidade nem a câmera: é um segundo desenho do mesmo
   * personagem, uma fração de quadro à frente (ver `pontoFantasma`), que some
   * perto da chegada para não "atravessar" a linha de chegada antes.
   */
  ghost: boolean;
  /**
   * Os números da cartela são **digitados**, não medidos.
   *
   * O arquivo de GPS é a sugestão (o painel mostra o valor do arquivo como
   * dica e oferece um botão para copiá-lo), mas quem manda é o texto. Campo
   * vazio = a linha não aparece.
   */
  cardDistance: string;
  cardElevation: string;
  cardTime: string;
  /** linha de baixo; vazia mostra a data do percurso, quando o arquivo tem */
  cardNote: string;
  /**
   * Foto do projeto (data URL já reduzida), que aparece no alto da cartela.
   *
   * Fica nas preferências como o resto da cartela, mas **não** entra no link
   * compartilhado: 640 px de foto viram ~70 KB de texto, e um link com isso não
   * passa por mensageiro nenhum.
   */
  cardPhoto: string;
  /**
   * Logo da marca (data URL), desenhado na **cartela final**.
   *
   * A cartela é o quadro que vira print: é ali que a marca do projeto tem de
   * estar. Fica na mesma linha do avatar, à esquerda; sozinho, ocupa o alto do
   * painel. Sem logo escolhido, nada muda.
   */
  logo: string;
  /**
   * Placa clara atrás do logo.
   *
   * Logo escuro (ou com fundo transparente escuro) some no painel escuro da
   * cartela; a placa resolve isso sem obrigar ninguém a editar a imagem.
   */
  logoChip: boolean;
  /**
   * Pops no vídeo: o "toc" da largada, um para cada parada e o acorde da
   * chegada. São **sintetizados** no arquivo (nenhum sample, nenhuma licença),
   * e é por isso que podem vir ligados por padrão.
   */
  /**
   * Sombreado do relevo no mapa (luz e sombra do terreno, visto de cima).
   *
   * Não é 3D e não é uma camada nova no desenho: o sombreado é misturado no
   * próprio bloco do mapa. Custa uma requisição a mais por bloco — e é por isso
   * que, ligado, o teto de blocos cai pela metade.
   */
  relevo: boolean;
  som: boolean;
  /**
   * Volume da música de fundo (0..1).
   *
   * O arquivo de música em si **não** fica aqui: ele tem megabytes e o
   * `localStorage` tem ~5 MB para o site inteiro. Só o volume é guardado.
   */
  musicaVolume: number;
  /**
   * Avatar do personagem: uma foto (data URL) que entra **no lugar do emoji**
   * dentro do selo que anda pelo mapa.
   *
   * É a resposta ao "teria como colocar tipo um avatar no personagem": em vez do
   * carro/bike genérico, a cara de quem fez o percurso (ou o escudo do time).
   * Vazio = o emoji do personagem escolhido, como sempre foi.
   */
  avatar: string;
  title: string;
  subtitle: string;
  aspect: AspectId;
  fps: number;
  formatId: string;
  bitrateMbps: number;
  /**
   * Exportação rápida com WebCodecs: renderiza o vídeo o mais rápido que a
   * máquina conseguir, em vez de gravar em tempo real. Cai sozinha para o
   * `MediaRecorder` quando o navegador não suporta o formato escolhido.
   */
  fastExport: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  profile: "car",
  ignoreOneway: true,
  snapToRoad: true,
  showStops: true,
  showStopLabels: true,
  showStopCounter: true,
  characterId: "car",
  accent: "#a3e635",
  rotate: false,
  duration: 14,
  cameraMode: "follow",
  followZoom: 16,
  basemap: "dark",
  showRoute: true,
  showTraveled: true,
  showEndpoints: true,
  showTitle: true,
  showProgress: true,
  endCard: true,
  showHud: true,
  minimap: true,
  elevationProfile: true,
  highlights: true,
  activity: "pedal",
  colorBy: "solid",
  showKmMarks: false,
  dias: true,
  cinematic: false,
  thirdPerson: false,
  spinMap: false,
  // a inclinação é o que faz a terceira pessoa parecer uma câmera atrás: vem
  // ligada junto com ela (quem não gostar desliga no painel)
  tiltHorizonte: true,
  ghost: false,
  cardDistance: "",
  cardElevation: "",
  cardTime: "",
  cardNote: "",
  cardPhoto: "",
  logo: "",
  logoChip: false,
  relevo: false,
  som: true,
  musicaVolume: 0.55,
  avatar: "",
  title: "Minha rota",
  subtitle: "",
  aspect: "16:9",
  /*
   * 60 por padrão: é o que faz o mapa fluir. Medido nos mp4 do usuário, o que
   * ele achou fluido tinha ~53 quadros por segundo com 93% deles no mesmo
   * intervalo; a 30, o mesmo movimento andava o mesmo tanto por quadro, mas um
   * em cada cinco quadros vinha fora do tempo — e é isso que o olho lê como
   * travada. Quem já tem preferências salvas mantém a sua.
   */
  fps: 60,
  formatId: "",
  bitrateMbps: 10,
  fastExport: true,
};

/**
 * Saneia preferências vindas do localStorage: estilos de mapa antigos
 * (ex.: os da CARTO, que passaram a exigir chave) são descartados.
 */
export function sanitizeSettings(raw: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = { ...raw };
  if (!out.basemap || !(out.basemap in BASEMAPS)) delete out.basemap;
  if (!out.aspect || !ASPECTS.some((a) => a.id === out.aspect)) delete out.aspect;
  if (typeof out.duration !== "number" || out.duration < 3 || out.duration > 60) {
    delete out.duration;
  }
  if (typeof out.followZoom !== "number" || out.followZoom < 3 || out.followZoom > 19) {
    delete out.followZoom;
  }
  if (out.cameraMode !== "fit" && out.cameraMode !== "follow") delete out.cameraMode;
  if (typeof out.ignoreOneway !== "boolean") delete out.ignoreOneway;
  if (typeof out.snapToRoad !== "boolean") delete out.snapToRoad;
  if (typeof out.showStopCounter !== "boolean") delete out.showStopCounter;
  if (typeof out.endCard !== "boolean") delete out.endCard;
  if (typeof out.showHud !== "boolean") delete out.showHud;
  if (typeof out.minimap !== "boolean") delete out.minimap;
  if (typeof out.elevationProfile !== "boolean") delete out.elevationProfile;
  if (typeof out.highlights !== "boolean") delete out.highlights;
  if (!ACTIVITIES.some((a) => a.id === out.activity)) delete out.activity;
  if (out.colorBy !== "solid" && out.colorBy !== "speed" && out.colorBy !== "slope") {
    delete out.colorBy;
  }
  if (typeof out.showKmMarks !== "boolean") delete out.showKmMarks;
  if (typeof out.dias !== "boolean") delete out.dias;
  if (typeof out.cinematic !== "boolean") delete out.cinematic;
  if (typeof out.thirdPerson !== "boolean") delete out.thirdPerson;
  if (typeof out.spinMap !== "boolean") delete out.spinMap;
  if (typeof out.tiltHorizonte !== "boolean") delete out.tiltHorizonte;
  if (typeof out.ghost !== "boolean") delete out.ghost;
  for (const key of ["cardDistance", "cardElevation", "cardTime", "cardNote"] as const) {
    if (typeof out[key] !== "string") delete out[key];
  }
  // a foto guardada precisa ser um data URL de imagem dentro do teto: qualquer
  // outra coisa (URL externa, texto, base64 gigante) é descartada aqui
  if (out.cardPhoto !== undefined && !isPhotoDataUrl(out.cardPhoto)) delete out.cardPhoto;
  // o logo passa pela mesma peneira da foto da cartela: só data URL de imagem,
  // dentro do teto que protege o `localStorage`
  if (out.logo !== undefined && !isPhotoDataUrl(out.logo)) delete out.logo;
  if (typeof out.logo === "string" && out.logo.length > PHOTO_MAX_CHARS) delete out.logo;
  if (typeof out.logoChip !== "boolean") delete out.logoChip;
  if (typeof out.relevo !== "boolean") delete out.relevo;
  if (typeof out.som !== "boolean") delete out.som;
  if (
    typeof out.musicaVolume !== "number" ||
    !Number.isFinite(out.musicaVolume) ||
    out.musicaVolume < 0 ||
    out.musicaVolume > 1
  ) {
    delete out.musicaVolume;
  }
  if (typeof out.cardPhoto === "string" && out.cardPhoto.length > PHOTO_MAX_CHARS) {
    delete out.cardPhoto;
  }
  // o avatar passa pelas mesmas regras da foto da cartela: só data URL de
  // imagem, e dentro do teto que protege o `localStorage`
  if (out.avatar !== undefined && !isPhotoDataUrl(out.avatar)) delete out.avatar;
  if (typeof out.avatar === "string" && out.avatar.length > PHOTO_MAX_CHARS) {
    delete out.avatar;
  }
  if (typeof out.fastExport !== "boolean") delete out.fastExport;
  const profiles = ["car", "bike", "foot", "straight"];
  if (!out.profile || !profiles.includes(out.profile)) delete out.profile;
  return out;
}

/** zoom máximo útil para o estilo escolhido */
export function maxZoomFor(basemap: BasemapId): number {
  return BASEMAPS[basemap]?.maxZoom ?? 19;
}
