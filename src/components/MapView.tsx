import { useEffect, useRef } from "react";
import L from "leaflet";
import { BASEMAPS, type BasemapId } from "../lib/tiles";
import { nearestTOnTrack, sampleTrack, type LatLng, type Track } from "../lib/geo";
import { HOME_CITY } from "../lib/geocode";
import type { Character } from "../lib/characters";
import { poiAnchor, poiLatLng, poiOffset, type Poi } from "../lib/pois";
import { hasMark, type Endpoints } from "../lib/endpoints";
import { keepsMarker, pinsAsDots } from "../lib/pins";

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
  rotate: boolean;
  accent: string;
  basemap: BasemapId;
  follow: boolean;
  followZoom: number;
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
    rotate,
    accent,
    basemap,
    follow,
    followZoom,
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
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const plannedRef = useRef<L.Polyline | null>(null);
  const plannedHitRef = useRef<L.Polyline | null>(null);
  const traveledRef = useRef<L.Polyline | null>(null);
  const charRef = useRef<L.Marker | null>(null);
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
      const inner = marked && mark!.emoji.trim()
        ? `<span class="wp-emoji">${escapeHtml(mark!.emoji.trim())}</span>`
        : first ? "A" : last ? "B" : String(i + 1);
      const tag = marked && mark!.label.trim()
        ? `<span class="wp-name">${escapeHtml(mark!.label.trim())}</span>`
        : "";
      const icon = L.divIcon({
        className: "wp-icon",
        html: `<div class="wp-pin${marked ? " wp-marked" : ""}" style="--pin:${color}" title="Clique para remover · arraste para mover">${inner}${tag}</div>`,
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
    }).addTo(map);
    hit.on("click", (e: L.LeafletMouseEvent) => {
      const near = nearestTOnTrack(track, { lat: e.latlng.lat, lng: e.latlng.lng });
      cbRef.current.onAddPoiAt(near.t);
    });
    plannedHitRef.current = hit;
  }, [track, showRoute, basemap]);

  /* --- trilha percorrida --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!traveledRef.current) {
      traveledRef.current = L.polyline([], {
        color: accent,
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
      }).addTo(map);
    }
    const line = traveledRef.current;
    line.setStyle({ color: accent });
    if (track.pts.length < 2) {
      line.setLatLngs([]);
      return;
    }
    const s = sampleTrack(track, progress);
    const pts = track.pts.slice(0, s.index + 1).concat([s.pos]);
    line.setLatLngs(pts);
  }, [track, progress, accent]);

  /* --- marcador do personagem --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (charRef.current) {
      charRef.current.remove();
      charRef.current = null;
    }
    if (track.pts.length === 0) return;
    const icon = L.divIcon({
      className: "char-icon",
      html: `<div class="char-badge" style="--accent:${accent}">
              <div class="char-rot"><div class="char-arrow"></div></div>
              <div class="char-emoji">${character.emoji}</div>
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
    marker.setLatLng(s.pos);
    const el = marker.getElement();
    const rot = el?.querySelector<HTMLDivElement>(".char-rot");
    if (rot) rot.style.transform = `rotate(${s.heading}deg)`;
    const emoji = el?.querySelector<HTMLDivElement>(".char-emoji");
    if (emoji) {
      emoji.style.transform = rotate
        ? `rotate(${s.heading + (character.baseAngle ?? 0)}deg)`
        : "none";
    }
    if (playing && follow) {
      const maxZ = BASEMAPS[basemap].maxZoom;
      map.setView(s.pos, Math.max(3, Math.min(maxZ, followZoom)), { animate: false });
    }
  }, [track, progress, rotate, character, playing, follow, followZoom, basemap]);

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
                 <div class="poi-badge">${p.emoji}</div>
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
    if (flyTo.bbox) {
      const [south, north, west, east] = flyTo.bbox;
      map.flyToBounds(
        L.latLngBounds([south, west], [north, east]),
        { padding: [40, 40], duration: 1.1, maxZoom: 15 },
      );
    } else {
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
    const pts = waypoints.length > 1 ? waypoints : track.pts;
    if (pts.length < 2) return;
    map.flyToBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [70, 70],
      duration: 0.8,
    });
  }, [fitRequest, waypoints, track.pts]);

  return <div ref={hostRef} className="absolute inset-0 z-0" />;
}
