import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import MapView, { type FlyTarget } from "./components/MapView";
import { HOME_CITY, type Place } from "./lib/geocode";
import Sidebar from "./components/Sidebar";
import Timeline from "./components/Timeline";
import ExportModal, { type ExportPhase } from "./components/ExportModal";
import {
  ASPECTS,
  DEFAULT_SETTINGS,
  MAX_WAYPOINTS,
  maxZoomFor,
  sanitizeSettings,
  type Settings,
} from "./lib/settings";
import {
  buildTrack,
  formatDistance,
  nearestTOnTrack,
  nudge,
  sampleTrack,
  type LatLng,
} from "./lib/geo";
import { fetchRoute, snapToRoad, type Preset, type RouteResult } from "./lib/routing";
import { makePoi, nextFreeT, sortPois, type Poi } from "./lib/pois";
import { DEFAULT_ENDPOINTS, type Endpoints } from "./lib/endpoints";
import { findCharacter } from "./lib/characters";
import { SceneRenderer, tilesForAnimation, TILE_BUDGET } from "./lib/renderer";
import {
  availableFormats,
  CancelledError,
  downloadBlob,
  recordVideo,
  type VideoFormat,
} from "./lib/recorder";

function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const f = availableFormats();
    const base = { ...DEFAULT_SETTINGS, formatId: f[0]?.id ?? "" };
    try {
      const saved = localStorage.getItem("rotacast:settings");
      if (saved) {
        const parsed = sanitizeSettings(JSON.parse(saved) as Partial<Settings>);
        return {
          ...base,
          ...parsed,
          formatId: f.some((x) => x.id === parsed.formatId)
            ? parsed.formatId!
            : base.formatId,
        };
      }
    } catch {
      /* ignora */
    }
    return base;
  });
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [city, setCity] = useState<Place | null>(HOME_CITY);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  /** contador: cada incremento pede um reenquadramento manual da rota */
  const [fitRequest, setFitRequest] = useState(0);
  /** encaixe do ponto na rua mais próxima */
  const [snapping, setSnapping] = useState(false);
  const [snapStreet, setSnapStreet] = useState<string | null>(null);
  /** paradas do percurso (ponte, cachoeira, igreja…) */
  const [pois, setPois] = useState<Poi[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<string | null>(null);
  /** modo "mira": clicar no mapa posiciona parada (pode ser fora da rota) */
  const [poiMode, setPoiMode] = useState(false);
  const lastKindRef = useRef("destino");
  /** partida/chegada como locais marcados (🏠 Casa → 💦 Cachoeira) */
  const [endpoints, setEndpoints] = useState<Endpoints>(() => {
    try {
      const raw = localStorage.getItem("rotacast:endpoints");
      if (raw) {
        const p = JSON.parse(raw) as Endpoints;
        const ok = (m: unknown) =>
          m == null ||
          (typeof m === "object" &&
            typeof (m as { emoji?: unknown }).emoji === "string" &&
            typeof (m as { label?: unknown }).label === "string");
        if (ok(p?.a) && ok(p?.b)) return { a: p.a ?? null, b: p.b ?? null };
      }
    } catch {
      /* ignora */
    }
    return DEFAULT_ENDPOINTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem("rotacast:endpoints", JSON.stringify(endpoints));
    } catch {
      /* ignora */
    }
  }, [endpoints]);

  const [phase, setPhase] = useState<ExportPhase | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMsg, setExportMsg] = useState<string | undefined>();
  const [video, setVideo] = useState<{
    blob: Blob;
    url: string;
    size: number;
    ext: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cancelRef = useRef(false);
  const progressRef = useRef(0);
  const progressUiRef = useRef(0);
  progressRef.current = progress;

  const formats: VideoFormat[] = useMemo(() => availableFormats(), []);
  /**
   * Enquanto a rota não chega (1 ponto clicado, ou cálculo em andamento) usamos
   * os próprios waypoints — assim o personagem já aparece no primeiro clique.
   */
  const track = useMemo(
    () => buildTrack(route?.points?.length ? route.points : waypoints),
    [route, waypoints],
  );
  const hasRoute = track.pts.length > 1;
  const character = findCharacter(settings.characterId);
  const aspect = ASPECTS.find((a) => a.id === settings.aspect) ?? ASPECTS[0];
  const activeFormat =
    formats.find((f) => f.id === settings.formatId) ?? formats[0] ?? {
      id: "webm",
      label: "WebM",
      ext: "webm",
      mime: "video/webm",
    };

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("rotacast:settings", JSON.stringify(settings));
    } catch {
      /* ignora */
    }
  }, [settings]);

  /* alguns mapas gratuitos têm zoom máximo menor (ex.: Relevo = 17) */
  const maxZoom = maxZoomFor(settings.basemap);
  useEffect(() => {
    setSettings((prev) =>
      prev.followZoom > maxZoom ? { ...prev, followZoom: maxZoom } : prev,
    );
  }, [maxZoom]);

  /* ---------- roteamento (por trecho, com cache) ---------- */
  const routeOptions = useMemo(
    () => ({ profile: settings.profile, ignoreOneway: settings.ignoreOneway }),
    [settings.profile, settings.ignoreOneway],
  );

  // lidas dentro de callbacks estáveis
  const routeOptionsRef = useRef(routeOptions);
  routeOptionsRef.current = routeOptions;
  const snapEnabledRef = useRef(settings.snapToRoad);
  snapEnabledRef.current = settings.snapToRoad;

  useEffect(() => {
    if (waypoints.length < 2) {
      setRoute(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchRoute(waypoints, routeOptions);
        if (!alive) return;
        setRoute(res);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
      setLoading(false);
    };
  }, [waypoints, routeOptions]);

  /* reinicia a animação quando a rota muda */
  const routeKey = route?.points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|") ?? "";
  useEffect(() => {
    setProgress(0);
    progressRef.current = 0;
  }, [routeKey]);

  /* ---------- loop de animação (pré-visualização) ---------- */
  useEffect(() => {
    if (!playing || !hasRoute) return;
    const startedAt = performance.now();
    const from = progressRef.current >= 1 ? 0 : progressRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      const t = from + elapsed / settings.duration;
      if (t >= 1) {
        setProgress(1);
        progressRef.current = 1;
        setPlaying(false);
        return;
      }
      setProgress(t);
      progressRef.current = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hasRoute, settings.duration, routeKey]);

  /* ---------- interações com o mapa ---------- */

  /**
   * Encaixa o ponto na rua mais próxima antes de guardá-lo.
   * O ponto aparece na hora (resposta imediata) e é corrigido assim que o
   * servidor responde — por isso a linha nasce já em cima da via.
   */
  const snapIndex = useRef(0);
  const snapAndFix = useCallback(
    (raw: LatLng, locate: (list: LatLng[]) => number) => {
      if (!snapEnabledRef.current) return;
      const token = ++snapIndex.current;
      setSnapping(true);
      snapToRoad(raw, routeOptionsRef.current)
        .then((res) => {
          if (token !== snapIndex.current) return;
          setSnapStreet(res.snapped ? (res.street ?? "via sem nome") : null);
          if (!res.snapped) return;
          setWaypoints((prev) => {
            const i = locate(prev);
            if (i < 0 || !prev[i]) return prev;
            const next = [...prev];
            next[i] = res.point;
            return next;
          });
        })
        .finally(() => {
          if (token === snapIndex.current) setSnapping(false);
        });
    },
    [],
  );

  const addPoint = useCallback(
    (p: LatLng) => {
      let added = false;
      setWaypoints((prev) => {
        if (prev.length >= MAX_WAYPOINTS) return prev;
        added = true;
        return [...prev, p];
      });
      if (added) {
        // o ponto recém-adicionado é o último com estas coordenadas
        snapAndFix(p, (list) =>
          list.findIndex((w) => w.lat === p.lat && w.lng === p.lng),
        );
      }
    },
    [snapAndFix],
  );

  const movePoint = useCallback(
    (index: number, p: LatLng) => {
      setWaypoints((prev) => prev.map((w, i) => (i === index ? p : w)));
      snapAndFix(p, () => index);
    },
    [snapAndFix],
  );
  const removePoint = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
    setSnapStreet(null);
  }, []);
  const fitRoute = useCallback(() => setFitRequest((n) => n + 1), []);

  /* ---------- paradas do percurso ---------- */
  const addPoi = useCallback((kindId: string, t?: number, pos?: LatLng) => {
    lastKindRef.current = kindId;
    setPois((prev) => {
      const poi = makePoi(kindId, t ?? nextFreeT(prev), undefined, pos);
      setSelectedPoi(poi.id);
      return [...prev, poi];
    });
  }, []);

  /** clique sobre a linha da rota no mapa */
  const addPoiAt = useCallback((t: number) => addPoi(lastKindRef.current, t), [addPoi]);

  const updatePoi = useCallback((id: string, patch: Partial<Poi>) => {
    setPois((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, ...patch, t: patch.t == null ? p.t : Math.max(0.01, Math.min(0.99, patch.t)) }
          : p,
      ),
    );
  }, []);

  const removePoi = useCallback((id: string) => {
    setPois((prev) => prev.filter((p) => p.id !== id));
    setSelectedPoi((sel) => (sel === id ? null : sel));
  }, []);

  const clearPois = useCallback(() => {
    setPois([]);
    setSelectedPoi(null);
  }, []);

  /**
   * Recalcula o gatilho (t) a partir de uma coordenada livre: a parada passa
   * a aparecer quando o personagem chega ao ponto da rota mais próximo dela.
   */
  const placePoiAt = useCallback(
    (pos: LatLng) => {
      const near = nearestTOnTrack(track, pos);
      if (selectedPoi) {
        updatePoi(selectedPoi, { pos, t: near.t });
        return;
      }
      addPoi(lastKindRef.current, near.t, pos);
    },
    [track, selectedPoi, updatePoi, addPoi],
  );

  const movePoiTo = useCallback(
    (id: string, pos: LatLng) => {
      const near = nearestTOnTrack(track, pos);
      updatePoi(id, { pos, t: near.t });
    },
    [track, updatePoi],
  );

  /** ajuste fino em metros */
  const nudgePoi = useCallback(
    (id: string, east: number, north: number) => {
      setPois((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const from = p.pos ?? sampleTrack(track, p.t).pos;
          const pos = nudge(from, east, north);
          return { ...p, pos, t: nearestTOnTrack(track, pos).t };
        }),
      );
    },
    [track],
  );

  const snapPoiToRoute = useCallback(
    (id: string) => updatePoi(id, { pos: undefined }),
    [updatePoi],
  );

  const zoomPoi = useCallback(
    (id: string) => {
      const p = pois.find((x) => x.id === id);
      if (!p) return;
      const pos = p.pos ?? sampleTrack(track, p.t).pos;
      setFlyTo({ key: `poi-${id}-${Date.now()}`, center: pos, zoom: 18 });
    },
    [pois, track],
  );

  const togglePoiMode = useCallback(() => setPoiMode((v) => !v), []);

  /**
   * Parada arrastada do catálogo e solta no mapa: fica exatamente onde caiu.
   * Se cair a menos de 30 m da rota, cola nela (fica "na rota").
   */
  const dropPoi = useCallback(
    (kindId: string, pos: LatLng) => {
      const near = nearestTOnTrack(track, pos);
      const onRoute = near.offset <= 30;
      addPoi(kindId, near.t, onRoute ? undefined : pos);
    },
    [track, addPoi],
  );

  /* atalhos: setas movem a parada selecionada em metros; Esc sai do modo */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (poiMode) setPoiMode(false);
        else if (!typing) setSelectedPoi(null);
        return;
      }
      if (typing || !selectedPoi) return;
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const dir = dirs[e.key];
      if (!dir) return;
      e.preventDefault();
      // alt = 1 m · normal = 5 m · shift = 25 m
      const stepM = e.altKey ? 1 : e.shiftKey ? 25 : 5;
      nudgePoi(selectedPoi, dir[0] * stepM, dir[1] * stepM);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poiMode, selectedPoi, nudgePoi]);

  const applyPreset = useCallback((p: Preset) => {
    setWaypoints(p.points);
    setSettings((prev) => ({ ...prev, profile: p.profile }));
    setPois((p.stops ?? []).map((s) => makePoi(s.kindId, s.t, s.label)));
    setSelectedPoi(null);
    setFitRequest((n) => n + 1); // exemplos: enquadra automaticamente
    setCity({
      id: `preset-${p.id}`,
      name: p.name,
      label: p.name,
      country: "",
      center: p.points[0],
      zoom: 13,
    });
  }, []);

  const replay = useCallback(() => {
    setProgress(0);
    progressRef.current = 0;
    setPlaying(true);
  }, []);

  /** move o mapa para a cidade escolhida */
  const pickCity = useCallback((p: Place) => {
    setCity(p);
    setFlyTo({
      key: `${p.id}-${Date.now()}`,
      center: p.center,
      zoom: p.zoom,
      bbox: p.bbox,
    });
    setShowSidebar(false); // no celular, mostra o mapa já posicionado
  }, []);

  const undoPoint = useCallback(() => {
    setWaypoints((p) => p.slice(0, -1));
    setSnapStreet(null);
  }, []);
  const clearPoints = useCallback(() => {
    setWaypoints([]);
    setPlaying(false);
    setSnapStreet(null);
    setPois([]);
    setSelectedPoi(null);
  }, []);

  /* ---------- exportação ---------- */
  const startExport = useCallback(async () => {
    if (!hasRoute) return;
    setVideo(null);
    setExportMsg(undefined);
    setExportProgress(0);
    progressUiRef.current = 0;
    cancelRef.current = false;
    setPlaying(false); // libera CPU para a gravação
    setPhase("warmup");
    // garante que o modal (e o canvas de render) já estejam montados
    await new Promise((r) => setTimeout(r, 60));

    const renderer = new SceneRenderer(settings.basemap);
    const style = {
      accent: settings.accent,
      basemap: settings.basemap,
      showRoute: settings.showRoute,
      showTraveled: settings.showTraveled,
      showEndpoints: settings.showEndpoints,
      showStops: settings.showStops,
      showStopLabels: settings.showStopLabels,
      showStopCounter: settings.showStopCounter,
      showTitle: settings.showTitle,
      showProgress: settings.showProgress,
      title: settings.title,
      subtitle: settings.subtitle,
    };
    const stops = sortPois(pois);
    const camera = { mode: settings.cameraMode, followZoom: settings.followZoom };

    let paint: (t: number, elapsed: number) => void = () => undefined;
    let canvasForRecord: HTMLCanvasElement | null = null;

    try {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = aspect.w;
      canvas.height = aspect.h;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");
      canvasForRecord = canvas;

      /** desenha um quadro no canvas de exportação */
      paint = (t: number, elapsed: number) =>
        renderer.render(ctx, aspect.w, aspect.h, {
          track,
          t,
          character,
          rotate: settings.rotate,
          camera,
          style,
          stops,
          endpoints,
          elapsed,
          duration: settings.duration,
        });

      // os servidores gratuitos pedem uso moderado
      const needed = tilesForAnimation(
        track,
        camera,
        aspect.w,
        aspect.h,
        settings.basemap,
      ).length;
      if (needed > TILE_BUDGET) {
        throw new Error(
          `Esta rota precisaria de ${needed} blocos de mapa — demais para os servidores ` +
            `gratuitos. Diminua a “Aproximação da câmera” ou use a câmera “Rota toda”.`,
        );
      }

      // mostra o mapa carregando no canvas (não fica uma tela preta)
      paint(0, 0);
      await renderer.warmup(track, camera, aspect.w, aspect.h, (p) => {
        setExportProgress(p);
        paint(Math.min(0.35, p * 0.35), p * 12);
      });
      if (cancelRef.current) throw new CancelledError();

      // o mapa realmente apareceu?
      paint(0, 0);
      if (renderer.loadedTiles === 0) {
        throw new Error(
          "Não foi possível carregar os mapas (sem conexão ou bloqueio de rede). " +
            "Tente novamente ou troque o estilo do mapa.",
        );
      }
      try {
        ctx.getImageData(0, 0, 1, 1);
      } catch {
        throw new Error(
          "O estilo de mapa escolhido bloqueia a exportação de vídeo. Troque o estilo (Escuro, Claro, Colorido) e tente de novo.",
        );
      }

      renderer.reset();
      setExportProgress(0);
      setPhase("recording");

      const blob = await recordVideo({
        canvas: canvasForRecord ?? canvasRef.current ?? document.createElement("canvas"),
        width: aspect.w,
        height: aspect.h,
        fps: settings.fps,
        durationSec: settings.duration,
        format: activeFormat,
        bitrate: Math.round(settings.bitrateMbps * 1_000_000),
        onProgress: (t) => {
          // atualiza a barra sem re-renderizar a app a cada quadro
          if (t - progressUiRef.current > 0.04 || t >= 1) {
            progressUiRef.current = t;
            setExportProgress(t);
          }
        },
        shouldCancel: () => cancelRef.current,
        draw: (c, t, elapsed) => {
          void c;
          paint(t, elapsed);
        },
      });
      setVideo({
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
        ext: activeFormat.ext,
      });
      setPhase("done");
    } catch (err) {
      if (err instanceof CancelledError) {
        setPhase(null);
        return;
      }
      setExportMsg(err instanceof Error ? err.message : "Erro desconhecido na gravação.");
      setPhase("error");
    }
  }, [hasRoute, settings, track, aspect, character, activeFormat, pois, endpoints]);

  const closeModal = useCallback(() => {
    cancelRef.current = true;
    setPhase(null);
    setVideo((v) => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (video) URL.revokeObjectURL(video.url);
    };
  }, [video]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-950 text-white">
      <header className="z-30 flex shrink-0 items-center gap-3 border-b border-white/10 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg shadow-lg shadow-indigo-950/60">
          🧭
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold leading-tight tracking-tight">
            Rota<span className="text-violet-400">Cast</span>
          </h1>
          <p className="truncate text-[11px] text-zinc-400">
            Trace uma rota no mapa, escolha o personagem e exporte em vídeo
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {city && (
            <span className="max-w-[180px] truncate rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-zinc-300">
              📍 {city.name}
            </span>
          )}
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-zinc-300">
            {hasRoute ? `${formatDistance(track.total)} · ${waypoints.length} pontos` : "sem rota"}
          </span>
          <span
            title="OpenStreetMap, CyclOSM, OpenTopoMap e Esri — sem chave de API, sem cadastro"
            className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300"
          >
            🆓 Mapas grátis · sem API key
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSidebar((v) => !v)}
          className="ml-auto rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 lg:hidden"
        >
          {showSidebar ? "Ver mapa" : "Ver controles"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={
            "order-2 min-h-0 flex-1 border-white/10 bg-zinc-950 lg:order-1 lg:w-[396px] lg:flex-none lg:border-r " +
            (showSidebar ? "block" : "hidden lg:block")
          }
        >
          <Sidebar
            settings={settings}
            update={update}
            waypoints={waypoints}
            distance={route?.distance ?? track.total}
            routeSource={route?.source ?? "direct"}
            note={route?.note}
            city={city}
            onCity={pickCity}
            pois={pois}
            track={track}
            progress={progress}
            selectedPoi={selectedPoi}
            poiMode={poiMode}
            onTogglePoiMode={togglePoiMode}
            onSelectPoi={setSelectedPoi}
            onAddPoi={addPoi}
            onUpdatePoi={updatePoi}
            onRemovePoi={removePoi}
            onClearPois={clearPois}
            onNudgePoi={nudgePoi}
            onSnapPoi={snapPoiToRoute}
            onZoomPoi={zoomPoi}
            endpoints={endpoints}
            onEndpoints={setEndpoints}
            loading={loading}
            formats={formats}
            hasRoute={hasRoute}
            maxZoom={maxZoom}
            onUndo={undoPoint}
            onClear={clearPoints}
            onFit={fitRoute}
            onPreset={applyPreset}
            onExport={startExport}
            onReplay={replay}
          />
        </aside>

        <main
          className={
            "relative order-1 min-h-0 shrink-0 lg:order-2 lg:flex-1 " +
            (showSidebar ? "hidden lg:block" : "block h-[56vh] lg:h-auto")
          }
        >
          <MapView
            waypoints={waypoints}
            track={track}
            progress={progress}
            playing={playing}
            flyTo={flyTo}
            fitRequest={fitRequest}
            character={character}
            rotate={settings.rotate}
            accent={settings.accent}
            basemap={settings.basemap}
            follow={settings.cameraMode === "follow"}
            followZoom={settings.followZoom}
            showRoute={settings.showRoute}
            onAddPoint={addPoint}
            onMovePoint={movePoint}
            onRemovePoint={removePoint}
            endpoints={endpoints}
            pois={pois}
            showStops={settings.showStops}
            selectedPoi={selectedPoi}
            poiMode={poiMode}
            onSelectPoi={setSelectedPoi}
            onAddPoiAt={addPoiAt}
            onMovePoi={movePoiTo}
            onPlacePoi={placePoiAt}
            onDropPoi={dropPoi}
          />

          {waypoints.length === 0 && !poiMode && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-2xl border border-white/15 bg-zinc-950/85 px-4 py-2.5 text-center shadow-2xl backdrop-blur-md">
              <p className="text-[12.5px] font-semibold text-white">
                👆 Clique no mapa para traçar a rota
              </p>
              <p className="text-[11px] text-zinc-400">
                📍 {city ? city.name : "Angatuba"}
                {settings.snapToRoad && settings.profile !== "straight" && (
                  <span className="text-zinc-500"> · pontos encaixam na rua</span>
                )}
              </p>
            </div>
          )}

          {waypoints.length === 1 && !poiMode && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-2xl border border-white/15 bg-zinc-950/85 px-4 py-2 text-center text-[12px] font-semibold text-white shadow-2xl backdrop-blur-md">
              <span className="mr-1">{character.emoji}</span> Clique de novo para definir o destino
              e ver a viagem
            </div>
          )}

          {poiMode && (
            <div className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-950/90 px-4 py-2 shadow-2xl shadow-amber-950/40 backdrop-blur-md">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-400 text-sm">
                🎯
              </span>
              <p className="text-[12px] font-semibold leading-tight text-amber-100">
                Clique no mapa para posicionar a parada
                <span className="block text-[10.5px] font-normal text-amber-200/70">
                  {selectedPoi
                    ? "Vai mover a parada selecionada · vale também fora da rota"
                    : "Pode ser fora da rota — uma linha de chamada liga ao trajeto"}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setPoiMode(false)}
                className="shrink-0 rounded-lg border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold text-amber-100 transition-colors hover:bg-amber-400/20"
              >
                Concluir
              </button>
            </div>
          )}

          {waypoints.length >= MAX_WAYPOINTS && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-2xl border border-amber-400/30 bg-amber-950/90 px-4 py-2 text-center text-[12px] font-semibold text-amber-200 shadow-2xl backdrop-blur-md">
              Limite de {MAX_WAYPOINTS} paradas atingido
            </div>
          )}

          {(snapping || snapStreet) && waypoints.length > 0 && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/15 bg-zinc-950/88 px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 shadow-xl backdrop-blur-md">
              {snapping ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
                  Encaixando na rua…
                </>
              ) : (
                <>
                  <span>🛣️</span>
                  <span className="max-w-[240px] truncate">{snapStreet}</span>
                </>
              )}
            </div>
          )}

          {/* controles flutuantes do mapa */}
          <div className="absolute right-3 top-3 z-20 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={fitRoute}
              disabled={waypoints.length < 2}
              title="Enquadrar a rota inteira"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-zinc-950/85 text-sm text-zinc-200 shadow-xl backdrop-blur-md transition hover:text-white disabled:opacity-35"
            >
              ⤢
            </button>
            <button
              type="button"
              onClick={undoPoint}
              disabled={waypoints.length === 0}
              title="Desfazer último ponto"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-zinc-950/85 text-sm text-zinc-200 shadow-xl backdrop-blur-md transition hover:text-white disabled:opacity-35"
            >
              ↩︎
            </button>
          </div>

          <Timeline
            progress={progress}
            playing={playing}
            duration={settings.duration}
            track={track}
            emoji={character.emoji}
            accent={settings.accent}
            disabled={!hasRoute}
            stops={pois}
            onToggle={() => {
              if (!hasRoute) return;
              if (playing) setPlaying(false);
              else if (progressRef.current >= 1) replay();
              else setPlaying(true);
            }}
            onSeek={(t) => {
              setPlaying(false);
              setProgress(t);
              progressRef.current = t;
            }}
            onRestart={replay}
          />
        </main>
      </div>

      {phase && (
        <ExportModal
          phase={phase}
          progress={exportProgress}
          message={exportMsg}
          canvasRef={canvasRef}
          videoUrl={video?.url}
          blobSize={video?.size}
          ext={video?.ext ?? activeFormat.ext}
          width={aspect.w}
          height={aspect.h}
          duration={settings.duration}
          onCancel={() => {
            cancelRef.current = true;
          }}
          onClose={closeModal}
          onDownload={() => {
            if (video) {
              downloadBlob(
                video.blob,
                `rotacast-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${
                  video.ext
                }`,
              );
            }
          }}
          onRetry={() => {
            closeModal();
            setTimeout(startExport, 60);
          }}
        />
      )}
    </div>
  );
}

function AppShell() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppShell;
