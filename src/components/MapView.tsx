import { useEffect, useRef } from "react";
import L from "leaflet";
import {
  BASEMAPS,
  HILLSHADE,
  pontoEmPixelInteiro,
  relevoDoMapa,
  type BasemapId,
} from "../lib/tiles";
import {
  completarTrilha,
  nearestTOnTrack,
  pontoValido,
  sampleTrack,
  type LatLng,
  type Track,
} from "../lib/geo";
import { HOME_CITY } from "../lib/geocode";
import { gaitOf, iconeDe, type Character } from "../lib/characters";
import { svgDoIcone } from "../lib/icones";
import { bonecoLigado, viradoPara, type Boneco } from "../lib/boneco";
import { CHASE_ALTURA, CHASE_ZOOM } from "../lib/camera";
import { poiAnchor, poiLatLng, poiOffset, type Poi } from "../lib/pois";
import { hasMark, type Endpoints } from "../lib/endpoints";
import { keepsMarker, pinsAsDots } from "../lib/pins";
import { tilesForAnimation } from "../lib/renderer";
import { PREVIA_ESPERA_MS, blocosEssenciais } from "../lib/previa";

export type FlyTarget = {
  /** muda sempre que o usuário escolhe um destino novo */
  key: string;
  center: LatLng;
  zoom: number;
  bbox?: [number, number, number, number];
};

type Props = {
  waypoints: LatLng[];
  track: Track;
  progress: number;
  playing: boolean;
  flyTo?: FlyTarget | null;
  /** incrementa para pedir um reenquadramento da rota (0 = nunca) */
  fitRequest?: number;
  character: Character;
  /**
   * O rosto do boneco: quando existe (e o boneco está ligado), a prévia mostra
   * a **foto** dentro do selo, como o vídeo — e não o emoji do personagem.
   */
  avatar?: string;
  boneco?: Boneco;
  rotate: boolean;
  accent: string;
  basemap: BasemapId;
  /** sombreado do relevo por cima do mapa (ver `RELEVO_DO_MAPA`) */
  relevo?: boolean;
  follow: boolean;
  followZoom: number;
  /** câmera de terceira pessoa: mais perto e o personagem abaixo do centro */
  thirdPerson: boolean;
  showRoute: boolean;
  onAddPoint: (p: LatLng) => void;
  onMovePoint: (index: number, p: LatLng) => void;
  onRemovePoint: (index: number) => void;
  /** pino escolhido no mapa (vira marcador arrastável quando há muitos pinos) */
  selectedWp: number | null;
  onSelectPoint: (index: number) => void;
  /** locais marcados de partida/chegada */
  endpoints: Endpoints;
  /* paradas do percurso */
  pois: Poi[];
  showStops: boolean;
  selectedPoi: string | null;
  /** quando ativo, clicar no mapa posiciona parada (e não ponto de rota) */
  poiMode: boolean;
  onSelectPoi: (id: string | null) => void;
  onAddPoiAt: (t: number) => void;
  /** move a parada para uma coordenada livre (pode ser fora da rota) */
  onMovePoi: (id: string, pos: LatLng) => void;
  /** cria/move a parada exatamente onde o usuário clicou */
  onPlacePoi: (pos: LatLng) => void;
  /**
   * A prévia está **esperando o mapa do começo** antes de andar: o mapa baixa os
   * primeiros blocos e devolve `onPreparo(null)` quando pode tocar.
   */
  preparando?: boolean;
  /** progresso do preparo (`null` = pronto para tocar) */
  onPreparo?: (estado: { feito: number; total: number } | null) => void;
  /** solta uma parada arrastada do catálogo no ponto exato do mapa */
  onDropPoi: (kindId: string, pos: LatLng) => void;
};

/** protege o nome da parada antes de injetar no HTML do ícone */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function MapView(props: Props) {
  const {
    waypoints,
    track,
    progress,
    playing,
    flyTo,
    fitRequest,
    character,
    avatar,
    boneco,
    rotate,
    accent,
    basemap,
    relevo = false,
    follow,
    followZoom,
    thirdPerson,
    showRoute,
    onAddPoint,
    onMovePoint,
    onRemovePoint,
    selectedWp,
    onSelectPoint,
    endpoints,
    pois,
    showStops,
    selectedPoi,
    poiMode,
    onSelectPoi,
    onAddPoiAt,
    onMovePoi,
    onPlacePoi,
    onDropPoi,
    preparando,
    onPreparo,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const relevoRef = useRef<L.TileLayer | null>(null);
  const plannedRef = useRef<L.Polyline | null>(null);
  const plannedHitRef = useRef<L.Polyline | null>(null);
  const traveledRef = useRef<L.Polyline | null>(null);
  const charRef = useRef<L.Marker | null>(null);
  /**
   * O rumo **desenrolado** do marcador (soma os giros em vez de voltar de 179°
   * para -179°). Sem isso a transição de 0,3 s do CSS giraria pelo caminho
   * longo — o selo daria uma volta inteira ao cruzar o norte.
   */
  const rumoRef = useRef<number | null>(null);
  const wpLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const poiElsRef = useRef<{ id: string; el: HTMLElement | null }[]>([]);
  const cbRef = useRef({
    onAddPoint,
    onMovePoint,
    onRemovePoint,
    onSelectPoint,
    onSelectPoi,
    onAddPoiAt,
    onMovePoi,
    onPlacePoi,
    onDropPoi,
    poiMode,
  });
  cbRef.current = {
    onAddPoint,
    onMovePoint,
    onRemovePoint,
    onSelectPoint,
    onSelectPoi,
    onAddPoiAt,
    onMovePoi,
    onPlacePoi,
    onDropPoi,
    poiMode,
  };

  /* --- criação do mapa --- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [HOME_CITY.center.lat, HOME_CITY.center.lng],
      zoom: HOME_CITY.zoom,
      zoomControl: false,
      preferCanvas: true,
      worldCopyJump: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    wpLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (cbRef.current.poiMode) cbRef.current.onPlacePoi(p);
      else cbRef.current.onAddPoint(p);
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);

    // reage a mudanças de layout (ex.: alternar painel no celular)
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(hostRef.current);

    // --- soltar paradas arrastadas do catálogo direto no mapa ---
    const host = hostRef.current;
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (
        e.dataTransfer.types.includes("application/x-poi-kind") ||
        e.dataTransfer.types.includes("text/plain")
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        host.classList.add("poi-dropping");
      }
    };
    const onDragLeave = () => host.classList.remove("poi-dropping");
    const onDrop = (e: DragEvent) => {
      host.classList.remove("poi-dropping");
      const kindId =
        e.dataTransfer?.getData("application/x-poi-kind") ||
        e.dataTransfer?.getData("text/plain");
      if (!kindId) return;
      e.preventDefault();
      const ll = map.mouseEventToLatLng(e as unknown as MouseEvent);
      cbRef.current.onDropPoi(kindId, { lat: ll.lat, lng: ll.lng });
    };
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("dragleave", onDragLeave);
    host.addEventListener("drop", onDrop);

    return () => {
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("dragleave", onDragLeave);
      host.removeEventListener("drop", onDrop);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /*
   * --- todas as imagens de mapa em cima de pixels inteiros ---
   *
   * O Leaflet move o "map pane" com `translate3d` em coordenadas quebradas
   * (`setPosition` não arredonda), e com a câmera "Seguir" ele se move a cada
   * quadro. Com o pane em cima de meio pixel, cada imagem de mapa é reamostrada
   * e a emenda entre duas vizinhas pode ficar com menos de um pixel de
   * cobertura — é a **linha preta na emenda das imagens** que o usuário viu
   * (no escuro ela passa despercebida; no satélite, não).
   *
   * Aqui a posição do pane é presa na grade de pixels do **dispositivo** logo
   * depois de cada movimento. O ajuste é de menos de meio pixel (invisível) e
   * não acumula: o Leaflet sempre subtrai a próxima posição da última guardada,
   * que passa a ser a arredondada.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pane = map.getPane("mapPane");
    if (!pane) return;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const prender = () => {
      const atual = L.DomUtil.getPosition(pane);
      if (!atual) return;
      const { x, y } = pontoEmPixelInteiro(atual.x, atual.y, dpr);
      if (x === atual.x && y === atual.y) return;
      L.DomUtil.setPosition(pane, L.point(x, y));
    };
    map.on("move", prender);
    map.on("moveend", prender);
    map.on("zoom", prender);
    map.on("zoomend", prender);
    prender();
    return () => {
      map.off("move", prender);
      map.off("moveend", prender);
      map.off("zoom", prender);
      map.off("zoomend", prender);
    };
  }, []);

  /* --- camada de tiles (provedores gratuitos, sem chave de API) --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS[basemap];
    const layer = L.tileLayer(bm.template, {
      subdomains: bm.subdomains.length ? bm.subdomains : [],
      maxZoom: 20,
      maxNativeZoom: bm.maxZoom,
      attribution: bm.attribution,
      /*
       * O mapa da prévia não fica parado: no "Seguir" ele anda ~3 km/s de vídeo.
       * Guardar mais blocos em volta (o padrão é 2) evita jogar fora e pedir de
       * novo os que acabaram de sair da tela — e `updateWhenIdle: false` tira a
       * espera do Leaflet entre um movimento e o pedido dos blocos novos: era
       * por isso que a rolagem engasgava mesmo com a rede em dia.
       */
      keepBuffer: 6,
      updateWhenIdle: false,
    });
    layer.addTo(map);
    tileRef.current = layer;

    // estilos "Escuro"/"Clean" são gerados por filtro sobre os tiles do OSM
    const container = layer.getContainer();
    if (container) container.style.filter = bm.filter ?? "";

    const host = hostRef.current;
    if (host) host.style.background = bm.bg;

    return () => {
      layer.remove();
      tileRef.current = null;
    };
  }, [basemap]);

  /* --- relevo: o sombreado do terreno por cima do mapa --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const estilo = relevo ? relevoDoMapa(basemap) : null;

    if (!estilo) {
      relevoRef.current?.remove();
      relevoRef.current = null;
      return;
    }

    /*
     * O sombreado vive num painel próprio, **entre** o mapa (vinculado à
     * posição) e os desenhos por cima. O modo de mistura é o mesmo do vídeo
     * (`RELEVO_DO_MAPA`): no Escuro, `screen` acende as encostas iluminadas;
     * nos outros, `multiply` escurece as viradas para o lado oposto.
     */
    if (!map.getPane("relevo")) {
      const pane = map.createPane("relevo");
      pane.style.zIndex = "250";
      pane.style.pointerEvents = "none";
    }
    const pane = map.getPane("relevo");
    if (pane) pane.style.mixBlendMode = estilo.modo;

    if (!relevoRef.current) {
      relevoRef.current = L.tileLayer(HILLSHADE.template, {
        pane: "relevo",
        maxZoom: 20,
        maxNativeZoom: HILLSHADE.maxZoom,
        opacity: estilo.alpha,
        keepBuffer: 6,
        updateWhenIdle: false,
        attribution: HILLSHADE.attribution,
      }).addTo(map);
    } else {
      relevoRef.current.setOpacity(estilo.alpha);
    }
  }, [basemap, relevo]);

  /* --- modo de posicionamento de parada (mira no cursor) --- */
  useEffect(() => {
    const host = hostRef.current;
    if (host) host.classList.toggle("poi-mode", poiMode);
  }, [poiMode]);

  /* --- pontos clicados --- */
  useEffect(() => {
    const layer = wpLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // com muitos pinos, um marcador arrastável por ponto trava o arrasto:
    // os pinos viram pontos no canvas e só os importantes seguem marcadores
    const muitos = pinsAsDots(waypoints.length);
    waypoints.forEach((p, i) => {
      /*
       * Ponto sem coordenada não vira marcador — e não some da lista: o índice
       * `i` continua sendo o da lista de verdade (é ele que o app usa para
       * mover/remover o ponto). Era por aqui que um ponto estragado chegava no
       * Leaflet e derrubava o app com "reading 'lat'".
       */
      if (!pontoValido(p)) return;
      if (muitos && !keepsMarker(i, waypoints.length, selectedWp)) {
        L.circleMarker(p, {
          radius: 4,
          color: accent,
          weight: 1,
          fillColor: accent,
          fillOpacity: 0.85,
          // clicar no pino não pode virar "adicionar ponto" no mapa
          bubblingMouseEvents: false,
        })
          .on("click", () => cbRef.current.onSelectPoint(i))
          .addTo(layer);
        return;
      }

      const first = i === 0;
      const last = i === waypoints.length - 1 && waypoints.length > 1;
      const color = first ? "#22c55e" : last ? "#f87171" : accent;

      // partida/chegada podem ser locais marcados (emoji + nome)
      const mark = first ? endpoints.a : last ? endpoints.b : null;
      const marked = (first || last) && hasMark(mark);
      // lugar marcado com foto: o pino mostra a foto (como o selo das paradas)
      const foto = marked ? mark!.photo : undefined;
      const inner = foto
        ? ""
        : marked && mark!.emoji.trim()
          ? `<span class="wp-emoji">${escapeHtml(mark!.emoji.trim())}</span>`
          : first ? "A" : last ? "B" : String(i + 1);
      const tag = marked && mark!.label.trim()
        ? `<span class="wp-name">${escapeHtml(mark!.label.trim())}</span>`
        : "";
      const classes = `wp-pin${marked ? " wp-marked" : ""}${foto ? " wp-photo" : ""}`;
      const fundo = foto ? ` background-image:url(${foto});` : "";
      const icon = L.divIcon({
        className: "wp-icon",
        html: `<div class="${classes}" style="--pin:${color};${fundo}" title="Clique para remover · arraste para mover">${inner}${tag}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const m = L.marker(p, { icon, draggable: true, zIndexOffset: 500 }).addTo(layer);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        cbRef.current.onMovePoint(i, { lat: ll.lat, lng: ll.lng });
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cbRef.current.onRemovePoint(i);
      });
    });
  }, [waypoints, accent, endpoints, selectedWp]);

  /* --- rota planejada --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (plannedRef.current) {
      plannedRef.current.remove();
      plannedRef.current = null;
    }
    if (plannedHitRef.current) {
      plannedHitRef.current.remove();
      plannedHitRef.current = null;
    }
    if (!showRoute || track.pts.length < 2) return;
    const onDark = basemap === "dark" || basemap === "satellite";

    const line = L.polyline(track.pts, {
      color: onDark ? "#ffffff" : "#0f172a",
      weight: 6,
      opacity: onDark ? 0.3 : 0.35,
      dashArray: "2 10",
      lineCap: "round",
      interactive: false,
      /*
       * O traçado é redesenhado a cada quadro (a câmera do "Seguir" anda
       * quilômetros por segundo), e o desenho custa o número de segmentos. O
       * `smoothFactor` é a tolerância, em pixels, do encurtamento que o Leaflet
       * já faz — com 3 em vez de 1, o GPX do usuário (5.704 pontos, 21,4 km)
       * cai de 262 pontos desenhados no zoom 15 para **93**, e de 751 para 325
       * no zoom 17. Num mapa de prévia, 3 px de folga no traço não se vê.
       */
      smoothFactor: 3,
    }).addTo(map);
    plannedRef.current = line;

    /**
     * Área de clique invisível e larga sobre a rota: clicando nela, uma nova
     * parada é inserida exatamente naquele ponto do percurso.
     */
    const hit = L.polyline(track.pts, {
      color: "#000000",
      weight: 26,
      opacity: 0,
      className: "route-hit",
      bubblingMouseEvents: false,
      smoothFactor: 3,
    }).addTo(map);
    hit.on("click", (e: L.LeafletMouseEvent) => {
      const near = nearestTOnTrack(track, { lat: e.latlng.lat, lng: e.latlng.lng });
      cbRef.current.onAddPoiAt(near.t);
    });
    plannedHitRef.current = hit;
  }, [track, showRoute, basemap]);

  /* --- trilha percorrida --- */
  /**
   * Os pontos da trilha são guardados como `LatLng` **uma vez só**.
   *
   * Antes, cada quadro montava a lista de novo (`track.pts.slice(…)` mais um
   * `concat`, até 5.704 pontos) e o Leaflet convertia cada ponto da lista num
   * `LatLng` novo — dezenas de milhares de objetos por segundo, jogados fora em
   * seguida. Com a animação rodando, o mapa da prévia engasgava ("travando no
   * percurso"). Aqui a lista é a mesma: o que entra é o ponto novo (e a ponta,
   * que é o personagem), e ela é cortada quando o vídeo volta atrás.
   */
  const trilhaRef = useRef<{ track: Track | null; pontos: L.LatLng[] }>({
    track: null,
    pontos: [],
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!traveledRef.current) {
      traveledRef.current = L.polyline([], {
        color: accent,
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
        // a trilha é redesenhada a cada quadro: vale o mesmo encurtamento da rota
        smoothFactor: 3,
      }).addTo(map);
    }
    const line = traveledRef.current;
    line.setStyle({ color: accent });
    const trilha = trilhaRef.current;
    if (track.pts.length < 2) {
      line.setLatLngs([]);
      trilha.track = null;
      trilha.pontos = [];
      return;
    }
    if (trilha.track !== track) {
      trilha.track = track;
      // um ponto estragado do traçado viraria `undefined` dentro da lista — e o
      // Leaflet estoura ao projetar (`reading 'lat'`)
      trilha.pontos = track.pts.filter(pontoValido).map((p) => L.latLng(p.lat, p.lng));
    }
    const s = sampleTrack(track, progress);
    if (!pontoValido(s.pos)) return;
    /*
     * A lista é sempre a mesma: corta no ponto atual — o que descarta a ponta do
     * quadro anterior e, quando o vídeo volta atrás (arrastar a barra do tempo,
     * recomeçar), a trilha que ficou para trás — e recoloca a ponta no
     * personagem, que anda dentro do trecho até o trecho virar um ponto novo.
     * Quando o índice **pula à frente**, o pedaço que falta vem do traçado
     * (`completarTrilha`): esticar a lista deixaria buracos, e era isso que
     * derrubava o mapa com "reading 'lat'".
     */
    completarTrilha(trilha.pontos, track.pts, s.index, L.latLng(s.pos.lat, s.pos.lng), (p) =>
      L.latLng(p.lat, p.lng),
    );
    line.setLatLngs(trilha.pontos);
  }, [track, progress, accent]);

  /* --- marcador do personagem --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (charRef.current) {
      charRef.current.remove();
      charRef.current = null;
    }
    rumoRef.current = null;
    if (track.pts.length === 0) return;
    /*
     * O andar também na prévia: o selo do mapa balança no passo do personagem,
     * como no vídeo. A cadência é a do `gaitOf` (corrida ~3 passos por segundo,
     * caminhada ~1,9), e quem tem roda não balança — carro que pula na prévia
     * ficaria tão errado quanto no vídeo.
     */
    const comoAnda = gaitOf(character);
    const classeAndar =
      comoAnda.gait === "passo" ? " char-passo" : comoAnda.gait === "flutua" ? " char-flutua" : "";
    /*
     * Com o boneco ligado e um rosto escolhido, a prévia mostra a foto (o mesmo
     * que o vídeo faz). O emoji fica para quem não escolheu foto.
     */
    const rostoNoBoneco = !!avatar && bonecoLigado(boneco);
    /*
     * O ícone animado entra na prévia como **SVG animado** — o mesmo desenho do
     * vídeo, com as partes girando por `<animateTransform>`. É o que faz o
     * bonequinho andar no mapa antes de gravar, e não só no arquivo final.
     * Com a foto do boneco, ela ganha (é o rosto de quem vai aparecer).
     */
    const icone = rostoNoBoneco ? null : iconeDe(character);
    const dentro = rostoNoBoneco
      ? `<img class="char-face" src="${avatar}" alt="" draggable="false" />`
      : icone
        ? svgDoIcone(icone, {
            accent,
            lado: 40,
            hz: icone.gaitHz,
            classe: "char-svg",
          })
        : character.emoji;
    const icon = L.divIcon({
      className: "char-icon",
      html: `<div class="char-badge${classeAndar}" style="--accent:${accent};--passo:${(1 / comoAnda.hz).toFixed(2)}s">
              <div class="char-rot"><div class="char-arrow"></div></div>
              <div class="char-emoji${rostoNoBoneco ? " char-emoji-foto" : ""}">${dentro}</div>
              ${!rostoNoBoneco && !icone && character.acessorio ? `<span class="char-acessorio">${character.acessorio}</span>` : ""}
            </div>`,
      iconSize: [58, 58],
      iconAnchor: [29, 29],
    });
    const m = L.marker(track.pts[0], { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
    charRef.current = m;
  }, [character, accent, track]);

  /* --- posição/rotação + câmera --- */
  useEffect(() => {
    const map = mapRef.current;
    const marker = charRef.current;
    if (!map || !marker || track.pts.length === 0) return;
    const s = sampleTrack(track, progress);
    if (!pontoValido(s.pos)) return;
    marker.setLatLng(s.pos);
    const el = marker.getElement();
    // o rumo que o CSS vai girar: o mesmo do vídeo, sem o salto de 180°
    let rumo = s.heading;
    if (rumoRef.current !== null) {
      while (rumo - rumoRef.current > 180) rumo -= 360;
      while (rumo - rumoRef.current < -180) rumo += 360;
    }
    rumoRef.current = rumo;
    const rot = el?.querySelector<HTMLDivElement>(".char-rot");
    if (rot) rot.style.transform = `rotate(${rumo}deg)`;
    const emoji = el?.querySelector<HTMLDivElement>(".char-emoji");
    if (emoji) {
      /*
       * O **ícone animado** olha para a direita: indo para a esquerda, ele é
       * espelhado, como no vídeo. Sem isso o caminhante andaria de costas para
       * onde vai — o emoji disfarçava (a figura é quase simétrica), o desenho
       * não.
       */
      emoji.style.transform = rotate
        ? `rotate(${rumo + (character.baseAngle ?? 0)}deg)`
        : iconeDe(character)
          ? `scaleX(${viradoPara(rumo)})`
          : "none";
    }
    if (playing && follow) {
      const maxZ = BASEMAPS[basemap].maxZoom;
      /*
       * Terceira pessoa na prévia: a câmera chega mais perto e o **centro** da
       * vista passa à frente do personagem, de modo que ele caia abaixo do meio
       * — a mesma conta do vídeo (`CHASE_ALTURA`). O mapa não gira na prévia (o
       * Leaflet trabalha com o norte para cima): o giro é do vídeo.
       */
      const zoom = Math.max(3, Math.min(maxZ, followZoom + (thirdPerson ? CHASE_ZOOM : 0)));
      let centro = s.pos;
      if (thirdPerson) {
        const px = map.project(s.pos, zoom);
        centro = map.unproject(
          L.point(px.x, px.y - (CHASE_ALTURA - 0.5) * map.getSize().y),
          zoom,
        );
      }
      map.setView(centro, zoom, { animate: false });
    }
  }, [track, progress, rotate, character, playing, follow, followZoom, basemap, thirdPerson]);

  /*
   * --- o mapa da prévia é baixado **antes** de andar ---
   *
   * O vídeo exportado nunca sofreu disso: antes de gravar, o renderizador baixa
   * todos os blocos da animação (`warmup`, com barra de progresso). A prévia
   * andava sem esse aquecimento: o Leaflet pedia o bloco no instante em que ele
   * entrava na tela, e com a câmera a ~3 km por segundo de vídeo ele nunca
   * chegava a tempo — o mapa aparecia aos pedaços.
   *
   * Aqui a prévia pede os mesmos blocos antes: são os do `tilesForAnimation`, a
   * mesma conta do vídeo (e as mesmas URLs, então quem responde é o cache do
   * navegador). Seis pedidos por vez, na ordem do percurso.
   *
   * E, desde o pedido do usuário (*"entender a rota, baixar todo o mapa
   * necessário para depois criar o vídeo"*), ela **espera o começo**: ao apertar
   * ▶ a animação fica no primeiro quadro enquanto os primeiros blocos chegam
   * ("Preparando o mapa… x %"), com teto de tempo (`PREVIA_ESPERA_MS`) para uma
   * rede ruim não prender a tela. O resto continua chegando durante o percurso.
   *
   * A carga vive numa **sessão** (e não no efeito) de propósito: quando o preparo
   * termina, `preparando` e `playing` mudam, o efeito roda de novo — e a sessão
   * do mesmo mapa tem de continuar de onde estava, em vez de recomeçar.
   */
  const sessaoRef = useRef<{ chave: string; pronto: boolean; cancelar: () => void } | null>(null);
  /** o callback fica em ref: quem baixa não pode depender da identidade dele */
  const preparoRef = useRef(onPreparo);
  preparoRef.current = onPreparo;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (!playing && !preparando) || !follow || track.pts.length < 2) return;
    const size = map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    const maxZoom = BASEMAPS[basemap].maxZoom;
    // o Leaflet prende o zoom em nível inteiro: é esse nível que os blocos têm
    // de casar (é o `zoomSnap` padrão, 1)
    const zoom = Math.max(
      3,
      Math.min(maxZoom, Math.round(followZoom + (thirdPerson ? CHASE_ZOOM : 0))),
    );
    const chave = `${basemap}/${zoom}/${size.x}x${size.y}/${track.total.toFixed(0)}`;
    const anterior = sessaoRef.current;
    if (anterior?.chave === chave) {
      // já está baixando (ou já baixou): se a prévia está esperando e a carga
      // ficou pronta enquanto isso, libera o play
      if (preparando && anterior.pronto) preparoRef.current?.(null);
      return;
    }
    anterior?.cancelar();
    const blocos = tilesForAnimation(
      track,
      {
        mode: "follow",
        // o `chase` entra para o enquadramento ser o da terceira pessoa (o
        // personagem abaixo do centro): sem ele a conta pediria os blocos de
        // uma vista centrada, e faltaria mapa no alto do quadro
        followZoom: zoom - (thirdPerson ? CHASE_ZOOM : 0),
        ...(thirdPerson ? { chase: { gira: false, tilt: false } } : {}),
      },
      size.x,
      size.y,
      basemap,
      null,
    );
    const fila = blocos.map((b) => b.url);
    /** quantos blocos a prévia espera antes de andar (0 = não espera nada) */
    const essencial = preparando ? blocosEssenciais(fila.length) : 0;
    const inicio = Date.now();
    let cancelado = false;
    let prontos = 0;
    let pronto = essencial === 0;
    const sessao = {
      chave,
      pronto,
      cancelar: () => {
        cancelado = true;
      },
    };
    sessaoRef.current = sessao;

    const liberar = () => {
      if (pronto) return;
      pronto = true;
      sessao.pronto = true;
      preparoRef.current?.(null);
    };
    const avisar = () => {
      if (pronto) return;
      // o teto de tempo vale mesmo com a rede devolvendo erro em série
      if (Date.now() - inicio >= PREVIA_ESPERA_MS) {
        liberar();
        return;
      }
      preparoRef.current?.({ feito: prontos, total: essencial });
      if (prontos >= essencial) liberar();
    };

    let i = 0;
    const proximo = () => {
      if (cancelado) return;
      const lote = fila.slice(i, i + 6);
      i += 6;
      if (lote.length === 0) {
        liberar();
        return;
      }
      let noLote = 0;
      for (const url of lote) {
        const img = new Image();
        const fim = () => {
          prontos++;
          avisar();
          if (++noLote === lote.length) proximo();
        };
        img.onload = fim;
        img.onerror = fim;
        img.src = url;
      }
    };
    proximo();
  }, [playing, preparando, follow, followZoom, thirdPerson, basemap, track]);

  /**
   * A pré-visualização com câmera "seguir" move o mapa. Guardamos a vista do
   * usuário ao dar play e devolvemos ao pausar, para não perder o zoom/local
   * onde ele estava trabalhando.
   */
  const savedView = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow) return;
    if (playing) {
      if (!savedView.current) {
        savedView.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      return;
    }
    const saved = savedView.current;
    savedView.current = null;
    if (saved) map.flyTo(saved.center, saved.zoom, { duration: 0.6 });
  }, [playing, follow]);

  /* --- marcadores das paradas --- */
  useEffect(() => {
    const layer = poiLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    poiElsRef.current = [];
    if (!showStops || pois.length === 0 || track.pts.length < 2) return;

    pois.forEach((p) => {
      const pos = poiLatLng(p, track);
      const anchor = poiAnchor(p, track);
      // a parada pode ter vindo de fora (link, armazenamento) sem coordenada
      if (!pontoValido(pos) || !pontoValido(anchor)) return;
      const off = poiOffset(p, track);
      const live = progress >= p.t;
      const sel = selectedPoi === p.id;

      // linha de chamada quando a parada está fora da rota
      if (off > 12) {
        L.polyline([anchor, pos], {
          color: p.color,
          weight: 2,
          opacity: live ? 0.9 : 0.45,
          dashArray: "5 5",
          interactive: false,
        }).addTo(layer);
      }

      const offTxt =
        off >= 25
          ? `<span class="poi-off">${off >= 1000 ? `${(off / 1000).toFixed(1)} km` : `${Math.round(off)} m`}</span>`
          : "";
      const icon = L.divIcon({
        className: "poi-icon",
        html: `<div class="poi-pin ${live ? "is-live" : "is-idle"}${sel ? " is-sel" : ""}${
          off > 12 ? " is-off" : ""
        }" style="--c:${p.color}">
                 <div class="poi-badge${p.photo ? " has-photo" : ""}"${
                   p.photo ? ` style="background-image:url(${p.photo})"` : ""
                 }>${p.photo ? "" : p.emoji}</div>
                 <div class="poi-tag">${escapeHtml(p.label)}${offTxt}</div>
               </div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      const m = L.marker(pos, {
        icon,
        draggable: true,
        autoPan: true,
        zIndexOffset: sel ? 900 : 400,
        bubblingMouseEvents: false,
      }).addTo(layer);
      m.on("click", () => cbRef.current.onSelectPoi(sel ? null : p.id));
      // arraste livre: a parada pode ficar em qualquer lugar do mapa
      m.on("dragend", () => {
        const ll = m.getLatLng();
        cbRef.current.onMovePoi(p.id, { lat: ll.lat, lng: ll.lng });
      });
      poiElsRef.current.push({ id: p.id, el: m.getElement() ?? null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, track, showStops, selectedPoi]);

  /* --- acende a parada quando o personagem passa (barato: só troca classes) --- */
  useEffect(() => {
    for (const { id, el } of poiElsRef.current) {
      if (!el) continue;
      const p = pois.find((x) => x.id === id);
      if (!p) continue;
      const pin = el.querySelector(".poi-pin");
      if (!pin) continue;
      const live = progress >= p.t;
      pin.classList.toggle("is-live", live);
      pin.classList.toggle("is-idle", !live);
    }
  }, [progress, pois]);

  /* --- vai para a cidade escolhida --- */
  const lastFly = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo || lastFly.current === flyTo.key) return;
    lastFly.current = flyTo.key;
    if (flyTo.bbox && flyTo.bbox.every((v) => Number.isFinite(v))) {
      const [south, north, west, east] = flyTo.bbox;
      map.flyToBounds(
        L.latLngBounds([south, west], [north, east]),
        { padding: [40, 40], duration: 1.1, maxZoom: 15 },
      );
    } else if (pontoValido(flyTo.center)) {
      map.flyTo(flyTo.center, flyTo.zoom, { duration: 1.1 });
    }
  }, [flyTo]);

  /**
   * Enquadra a rota SOMENTE quando pedido explicitamente (botão "Enquadrar"
   * ou ao carregar uma rota de exemplo).
   *
   * O enquadramento automático a cada clique era o que fazia o mapa "sair do
   * zoom" — agora a visualização do usuário nunca é alterada ao marcar pontos.
   */
  const lastFit = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitRequest || fitRequest === lastFit.current) return;
    lastFit.current = fitRequest;
    const pts = (waypoints.length > 1 ? waypoints : track.pts).filter(pontoValido);
    if (pts.length < 2) return;
    map.flyToBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [70, 70],
      duration: 0.8,
    });
  }, [fitRequest, waypoints, track.pts]);

  return <div ref={hostRef} className="absolute inset-0 z-0" />;
}
