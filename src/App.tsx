import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import MapView, { type FlyTarget } from "./components/MapView";
import { HOME_CITY, type Place } from "./lib/geocode";
import Sidebar from "./components/Sidebar";
import Timeline from "./components/Timeline";
import ExportModal, { type ExportPhase } from "./components/ExportModal";
import {
  ASPECTS, usaRitmo,
  DEFAULT_SETTINGS,
  MAX_WAYPOINTS,
  maxZoomFor,
  type Settings,
} from "./lib/settings";
import { pinsAsDots } from "./lib/pins";
import { endCard, rideSummary } from "./lib/stats";
import { timesOf } from "./lib/hud";
import { colorizeRoute, dataCoverage } from "./lib/coloring";
import { kmMarks } from "./lib/km-marks";
import { parseDuration } from "./lib/duration";
import { buildTimeline, routeProgress } from "./lib/timeline";
import {
  buildTrack,
  formatDistance,
  nearestTOnTrack,
  nudge,
  sampleTrack,
  type LatLng,
} from "./lib/geo";
import {
  fetchRoute,
  isAbortError,
  snapToRoad,
  type Preset,
  type RouteResult,
} from "./lib/routing";
import { makePoi, nextFreeT, nextPoiId, poiLatLng, sortPois, type Poi } from "./lib/pois";
import { buildShareUrl, decodeShare, sharedSettingsOverrides } from "./lib/share";
import {
  GpxError,
  gpxFileName,
  parseGpx,
  poiKindForSym,
  simplifyTo,
  toGpx,
} from "./lib/gpx";
import {
  DEFAULT_ENDPOINTS,
  hasEndpointMarks,
  mergeSharedEndpoints,
  type Endpoints,
} from "./lib/endpoints";
import { findCharacter } from "./lib/characters";
import { SceneRenderer, tilesForAnimation, TILE_BUDGET } from "./lib/renderer";
import { budgetAdvice, maxFollowZoom, tilesNeeded } from "./lib/map-budget";
import { focoDasParadas } from "./lib/pois";
import { PhotoCache, photoSources } from "./lib/photos";
import { mapPassages, passageTimes } from "./lib/passages";
import { decodeSettings, loadEndpoints, saveEndpoints, saveSettings } from "./lib/persist";
import {
  availableFormats,
  CancelledError,
  downloadBlob,
  fpsQueCasa,
  medirTaxaDaTela,
  recordVideo,
  type VideoEngine,
  type VideoFormat,
} from "./lib/recorder";
import { isFastEncodeSupported, recordVideoFast } from "./lib/webcodecs";

function App() {
  /** Rota recebida por link (`#r=…`). Lida uma única vez, na montagem. */
  const [shared] = useState(() => decodeShare(window.location.hash));
  /**
   * Traçado vindo de um GPX.
   *
   * Fica separado dos waypoints porque um track gravado **já segue as ruas**:
   * recalcular pelo roteador mudaria a rota e gastaria chamadas ao servidor
   * comunitário à toa. Enquanto isto estiver preenchido, o roteador não é
   * chamado; quando o usuário mexer em qualquer ponto, volta ao normal.
   */
  const [rawTrack, setRawTrack] = useState<LatLng[] | null>(null);
  /** Retorno da importação: erro ou resumo do que entrou. */
  const [gpxMsg, setGpxMsg] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  /** aviso de gravação das preferências (foto grande demais, cota estourada) */
  const [avisoSalvar, setAvisoSalvar] = useState<string | null>(null);

  /**
   * Fotos já decodificadas, compartilhadas entre a prévia e a exportação.
   *
   * Fica num `ref` porque não é estado de tela: quem consulta é o desenho do
   * vídeo, 30 vezes por segundo, e uma decodificação por exportação seria
   * trabalho repetido à toa.
   */
  const fotosRef = useRef<PhotoCache | null>(null);
  if (!fotosRef.current) fotosRef.current = new PhotoCache();
  const fotos = fotosRef.current;

  const [settings, setSettings] = useState<Settings>(() => {
    const f = availableFormats();
    const base = { ...DEFAULT_SETTINGS, formatId: f[0]?.id ?? "" };

    let salvos: Partial<Settings> = {};
    try {
      salvos = decodeSettings(localStorage.getItem("rotacast:settings"));
    } catch {
      /* armazenamento indisponível (aba privada, por exemplo) */
    }

    // o link descreve uma cena específica, então vence o que estava salvo
    const doLink = shared ? sharedSettingsOverrides(shared.settings) : {};
    const merged = { ...base, ...salvos, ...doLink };
    return {
      ...merged,
      formatId: f.some((x) => x.id === merged.formatId) ? merged.formatId : base.formatId,
    };
  });
  const [waypoints, setWaypoints] = useState<LatLng[]>(() => shared?.waypoints ?? []);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  /**
   * A prévia está esperando o mapa do começo antes de andar.
   *
   * Pedido do usuário: *"será que é possível entender a rota, baixar todo o mapa
   * necessário para depois criar o vídeo"*. O que se aplica à prévia é esperar os
   * **primeiros** blocos (o resto chega durante o percurso): o mapa não aparece
   * mais aos pedaços na frente de quem está olhando.
   */
  const [preparando, setPreparando] = useState(false);
  const [preparo, setPreparo] = useState<{ feito: number; total: number } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  /** confirmação visual do "Copiar link" */
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [city, setCity] = useState<Place | null>(() => shared?.city ?? HOME_CITY);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  /** contador: cada incremento pede um reenquadramento manual da rota */
  const [fitRequest, setFitRequest] = useState(0);
  /** encaixe do ponto na rua mais próxima */
  const [snapping, setSnapping] = useState(false);
  const [snapStreet, setSnapStreet] = useState<string | null>(null);
  /** paradas do percurso (ponte, cachoeira, igreja…) */
  const [pois, setPois] = useState<Poi[]>(() => shared?.pois ?? []);
  const [selectedPoi, setSelectedPoi] = useState<string | null>(null);
  /** pino escolhido no mapa: com muitos pinos, é ele que vira marcador arrastável */
  const [selectedWp, setSelectedWp] = useState<number | null>(null);
  /** modo "mira": clicar no mapa posiciona parada (pode ser fora da rota) */
  const [poiMode, setPoiMode] = useState(false);
  const lastKindRef = useRef("destino");
  /** partida/chegada como locais marcados (🏠 Casa → 💦 Cachoeira) */
  const [endpoints, setEndpoints] = useState<Endpoints>(() => {
    const guardados = loadEndpoints(localStorage);
    // a partida/chegada do link vence a que estava salva — mas as fotos são
    // locais: se o lugar do link é o mesmo, a foto escolhida aqui fica
    if (shared && (shared.endpoints.a || shared.endpoints.b)) {
      return mergeSharedEndpoints(guardados, shared.endpoints);
    }
    return hasEndpointMarks(guardados) ? guardados : DEFAULT_ENDPOINTS;
  });

  useEffect(() => {
    // como as preferências: se as fotos do A/B não couberem na cota, grava sem
    // elas e avisa — em vez de perder os locais em silêncio
    const resultado = saveEndpoints(localStorage, endpoints);
    if (resultado !== "ok") {
      setAvisoSalvar(
        resultado === "sem-foto"
          ? "A foto da partida ou da chegada é grande demais para salvar. Ela continua valendo neste vídeo, mas some ao recarregar a página."
          : "Não foi possível salvar a partida e a chegada neste navegador (armazenamento cheio ou bloqueado).",
      );
    } else {
      setAvisoSalvar((atual) => (atual?.startsWith("A foto da partida") || atual?.startsWith("Não foi possível salvar a partida") ? null : atual));
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
    /** como o arquivo foi gravado: WebCodecs (rápida) ou `MediaRecorder` */
    engine: VideoEngine;
    /** fps que o arquivo recebeu (na gravação em tempo real pode diferir do pedido) */
    fps: number;
    /** fps que estava escolhido no painel */
    fpsPedido: number;
    /** taxa da tela medida, em Hz (0 = não deu para medir) */
    taxaDaTela: number;
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
    () => buildTrack(rawTrack ?? (route?.points?.length ? route.points : waypoints)),
    [rawTrack, route, waypoints],
  );
  const hasRoute = track.pts.length > 1;
  const character = useMemo(
    () => findCharacter(settings.characterId),
    [settings.characterId],
  );
  const aspect = useMemo(
    () => ASPECTS.find((a) => a.id === settings.aspect) ?? ASPECTS[0],
    [settings.aspect],
  );

  const activeFormat =
    formats.find((f) => f.id === settings.formatId) ?? formats[0] ?? {
      id: "webm",
      label: "WebM",
      ext: "webm",
      mime: "video/webm",
      container: "webm" as const,
      codec: "vp8",
    };

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    // a gravação conta o que aconteceu: com uma foto grande, o `localStorage`
    // pode estourar a cota, e perder tudo em silêncio seria o pior desfecho
    try {
      const resultado = saveSettings(localStorage, settings);
      setAvisoSalvar(
        resultado === "ok"
          ? null
          : resultado === "sem-foto"
            ? "A foto é grande demais para salvar as preferências. Ela continua valendo neste vídeo, mas some ao recarregar a página."
            : "Não foi possível salvar as preferências neste navegador (armazenamento cheio ou bloqueado).",
      );
    } catch {
      setAvisoSalvar("Não foi possível salvar as preferências neste navegador.");
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

  /**
   * Rota aberta por link: enquadrar assim que o traçado chegar.
   * Enquadrar na montagem só mostraria os pontos clicados, e não as ruas.
   */
  const fitAfterRoute = useRef(Boolean(shared && shared.waypoints.length >= 2));

  useEffect(() => {
    // traçado importado é usado como veio, sem passar pelo roteador
    if (rawTrack) return;
    if (waypoints.length < 2) {
      setRoute(null);
      setLoading(false);
      return;
    }
    let alive = true;
    // cancela o cálculo anterior: sem isso, cada ponto novo deixava uma
    // requisição pendente em servidores comunitários que pedem uso moderado
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchRoute(waypoints, routeOptions, controller.signal);
        if (!alive) return;
        setRoute(res);
        if (fitAfterRoute.current) {
          fitAfterRoute.current = false;
          setFitRequest((n) => n + 1);
        }
      } catch (err) {
        // cancelamento é esperado; outras falhas só mantêm o que já está na tela
        if (!isAbortError(err)) console.error("Falha ao calcular a rota", err);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
      setLoading(false);
    };
  }, [waypoints, routeOptions, rawTrack]);

  /**
   * Resumo do percurso para a cartela final.
   *
   * Calculado sobre o traçado **importado**, quando existe: ele tem todos os
   * pontos do arquivo, enquanto o traçado desenhado passa pelo teto de pontos.
   * Memoizado porque a animação redesenha a cada quadro e varrer milhares de
   * pontos por quadro seria desperdício.
   */
  const resumo = useMemo(
    () => rideSummary(rawTrack ?? track.pts, track.total),
    [rawTrack, track],
  );
  /**
   * Horas dos pontos do traçado, quando o arquivo é de GPS.
   *
   * Sai do traçado **desenhado** (`track.pts`), e não do arquivo cru: o desenho
   * é uma redução do arquivo (teto de 12.000 pontos), e um vetor de horas maior
   * que o traçado apontaria para pontos que não estão na tela — foi assim que o
   * relógio do HUD chegou a ler cinco vezes menos do que devia num GPX de
   * 50.000 pontos. `buildTrack` mantém os mesmos pontos do arquivo (com as
   * mesmas horas), então nada se perde: só passa a bater com o que é desenhado.
   *
   * Memoizado porque a animação redesenha ~30 vezes por segundo.
   */
  const horas = useMemo(() => timesOf(track.pts), [track]);

  /**
   * Tempo escrito na cartela, em segundos.
   *
   * É o relógio do HUD quando o arquivo não traz hora: o usuário já escreveu o
   * tempo no painel, então o vídeo conta até esse número em vez de mostrar a
   * duração do clipe (que é o que a barra de progresso representa).
   */
  const tempoCartela = useMemo(() => parseDuration(settings.cardTime), [settings.cardTime]);

  /**
   * Pontos do traçado que têm hora / elevação (0..1), para avisar no painel em
   * vez de o usuário escolher "inclinação" e ver uma linha cinza sem entender.
   */
  const cobertura = useMemo(() => dataCoverage(track.pts), [track]);

  /**
   * Rota colorida por velocidade ou inclinação.
   *
   * Fora do laço de desenho de propósito: envolve médias móveis sobre o
   * traçado inteiro, e o vídeo é redesenhado ~30 vezes por segundo.
   */
  const colored = useMemo(
    () =>
      colorizeRoute({
        // o traçado desenhado: as faixas precisam casar com os pontos do traçado
        pts: track.pts,
        cum: track.cum,
        times: horas,
        mode: settings.colorBy,
      }),
    [horas, settings.colorBy, track],
  );

  /**
   * Quantas vezes a rota passa por cada parada.
   *
   * Uma parada é um **lugar**; o vídeo mostra quando o personagem chega nele.
   * Numa ida e volta pelo mesmo caminho, ele chega duas vezes — e as duas
   * precisam aparecer (foto, aviso e marca na linha do tempo). Depende da rota
   * e das paradas, então é recalculado só quando uma das duas muda.
   */
  const passagens = useMemo(() => mapPassages(track, pois), [track, pois]);

  /*
   * Prepara as fotos assim que elas mudam.
   *
   * O desenho do vídeo é síncrono e só consulta o cache; sem esta preparação,
   * a primeira imagem só ficaria pronta dentro da exportação (e a foto
   * escolhida agora demoraria a aparecer). Também é aqui que as fotos de
   * partida e chegada entram no cache — antes elas nunca entravam.
   */
  useEffect(() => {
    void fotos.ready(
      photoSources(
        [settings.cardPhoto],
        pois.map((p) => p.photo),
        [endpoints.a?.photo, endpoints.b?.photo],
      ),
    );
  }, [fotos, settings.cardPhoto, pois, endpoints]);

  /**
   * A câmera do vídeo, do painel e da conta de blocos — **uma fonte só**.
   *
   * A terceira pessoa entra aqui e não em cada montagem: ela muda o zoom (a
   * câmera chega mais perto) e a vista (o personagem desce na tela e o mapa
   * pode girar), e as três precisam enxergar a mesma câmera para a conta dos
   * blocos continuar valendo para o vídeo de verdade.
   */
  const cameraDoVideo = useCallback(
    (lista: Poi[]) => ({
      mode: settings.cameraMode,
      followZoom: settings.followZoom,
      cinematic: {
        opening: settings.cinematic,
        stops: settings.cinematic,
        stopTs: passageTimes(lista, passagens),
        chegada: settings.cinematic,
      },
      chase:
        settings.cameraMode === "follow" && settings.thirdPerson
          ? { gira: settings.spinMap, tilt: settings.tiltHorizonte }
          : undefined,
    }),
    [
      settings.cameraMode,
      settings.followZoom,
      settings.cinematic,
      settings.thirdPerson,
      settings.spinMap,
      settings.tiltHorizonte,
      passagens,
    ],
  );

  /**
   * Onde a câmera foca cada parada — **o lugar** dela, que pode estar fora da
   * linha.
   *
   * É a mesma função que o renderizador usa para desenhar, e é ela que entra na
   * conta dos blocos: com o foco diferente dos dois lados, o aquecimento baixa
   * os blocos da rota e o vídeo sai borrado na parada (era o "mostra o video
   * tambem travando").
   */
  const focoDoVideo = useMemo(
    () => focoDasParadas(pois, passagens, track),
    [pois, passagens, track],
  );

  /**
   * Maior zoom de acompanhamento que cabe no teto de blocos.
   *
   * Não depende do zoom escolhido — só da rota, do tamanho da tela e do mapa —
   * então fica memoizado à parte: arrastar o controle de zoom não refaz a
   * busca (que percorre a rota inteira algumas vezes).
   */
  const sugestaoZoom = useMemo(() => {
    if (settings.cameraMode !== "follow") return null;
    const camera = cameraDoVideo(pois);
    return maxFollowZoom({
      track,
      width: aspect.w,
      height: aspect.h,
      basemap: settings.basemap,
      maxZoom: maxZoomFor(settings.basemap),
      camera,
      cinematic: camera.cinematic,
      foco: focoDoVideo,
    });
  }, [
    track,
    aspect,
    settings.basemap,
    settings.cameraMode,
    cameraDoVideo,
    focoDoVideo,
    pois,
  ]);

  /** Blocos que a câmera escolhida vai precisar — muda a cada passo do controle. */
  const blocos = useMemo(() => {
    const camera = cameraDoVideo(pois);
    const needed = tilesNeeded({
      track,
      width: aspect.w,
      height: aspect.h,
      basemap: settings.basemap,
      maxZoom: maxZoomFor(settings.basemap),
      camera,
      // os blocos que o vídeo vai mesmo usar: com a abertura e as paradas
      cinematic: camera.cinematic,
      foco: focoDoVideo,
    });
    return {
      needed,
      fits: needed <= TILE_BUDGET,
      // a sugestão só faz sentido quando a câmera é a "Seguir" e a rota não cabe
      sugestao: settings.cameraMode === "follow" ? sugestaoZoom : null,
    };
  }, [
    track,
    aspect,
    settings.basemap,
    settings.cameraMode,
    cameraDoVideo,
    focoDoVideo,
    pois,
    sugestaoZoom,
  ]);

  /** marcas de km (o traçado inteiro já está medido em `track`) */
  const marcas = useMemo(
    () => (settings.showKmMarks ? kmMarks(track.cum) : null),
    [settings.showKmMarks, track],
  );

  const cartela = useMemo(
    () =>
      endCard(
        {
          cardDistance: settings.cardDistance,
          cardElevation: settings.cardElevation,
          cardTime: settings.cardTime,
          cardNote: settings.cardNote,
        },
        resumo,
      ),
    [
      settings.cardDistance,
      settings.cardElevation,
      settings.cardTime,
      settings.cardNote,
      resumo,
    ],
  );

  /**
   * As janelas do vídeo: voo → percurso → cartela.
   *
   * O voo só existe na câmera "Seguir" (no "Rota toda" o enquadramento já é o
   * da região) e a cartela só reserva tempo quando há números para mostrar.
   */
  const linhaDoTempo = useMemo(
    () =>
      buildTimeline(settings.duration, {
        voo: settings.cinematic && settings.cameraMode === "follow",
        cartela: settings.endCard && cartela !== null,
      }),
    [settings.duration, settings.cinematic, settings.cameraMode, settings.endCard, cartela],
  );

  /**
   * Onde a personagem está **na rota** no instante atual (0..1).
   *
   * É o que a barra da linha do tempo mostra, e tudo o que fala da rota — o
   * mapa, o "já passou por aqui" do painel, a distância percorrida — usa esta
   * mesma posição: a do desenho, e a do vídeo.
   *
   * Era aqui que entrava a **freada** nas paradas (uma curva que esticava o
   * relógio perto de cada ponto). O usuário pediu para tirar: "quero sem a
   * pausa nos pontos, só um zoom e focar no ícone do ponto" — a posição é a de
   * sempre, e a câmera é quem faz a ênfase.
   */
  const rotaDoVideo = progress;

  /**
   * Posição na rota em passos de 1%, para o painel lateral.
   *
   * O painel só precisa saber quais paradas já ficaram para trás — não precisa
   * de 60 quadros por segundo. Como o `Sidebar` é memoizado e todos os seus
   * outros props são estáveis (`useCallback`/`useMemo`), arredondar aqui evita
   * re-renderizar o painel (e o `StopEditor` dentro dele) a cada quadro da
   * animação. O mapa e a linha do tempo continuam recebendo o valor cheio.
   */
  const sidebarProgress = Math.round(rotaDoVideo * 100) / 100;


  /* reinicia a animação quando a rota muda */
  /**
   * Chave estável da rota.
   *
   * Fica em `useMemo` de propósito: a animação chama `setProgress` a cada
   * quadro, e sem isso a geometria inteira do OSRM (overview=full, até 60
   * trechos) seria percorrida e convertida em string ~60x por segundo.
   */
  const routeKey = useMemo(
    () =>
      route?.points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|") ?? "",
    [route],
  );
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
      // `progress` (e o mapa) fala em progresso do percurso; quem manda é o
      // relógio do vídeo, porque é ele que a exportação usa
      const seg = from * settings.duration + (now - startedAt) / 1000;
      const t = routeProgress(linhaDoTempo, seg);
      if (seg >= settings.duration) {
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
  }, [playing, hasRoute, settings.duration, routeKey, linhaDoTempo]);

  /* ---------- interações com o mapa ---------- */

  /**
   * Encaixa o ponto na rua mais próxima antes de guardá-lo.
   * O ponto aparece na hora (resposta imediata) e é corrigido assim que o
   * servidor responde — por isso a linha nasce já em cima da via.
   */
  const snapIndex = useRef(0);
  const snapAbort = useRef<AbortController | null>(null);
  const snapAndFix = useCallback(
    (raw: LatLng, locate: (list: LatLng[]) => number) => {
      if (!snapEnabledRef.current) return;
      const token = ++snapIndex.current;
      // cliques rápidos: cancela o encaixe anterior em vez de deixá-lo em voo
      snapAbort.current?.abort();
      const controller = new AbortController();
      snapAbort.current = controller;
      setSnapping(true);
      snapToRoad(raw, routeOptionsRef.current, controller.signal)
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
        .catch((err) => {
          if (!isAbortError(err)) console.error("Falha ao encaixar na rua", err);
        })
        .finally(() => {
          if (token === snapIndex.current) setSnapping(false);
        });
    },
    [],
  );

  /**
   * Abandona o traçado importado do GPX.
   * Qualquer edição manual significa que o usuário quer traçar de novo — a
   * partir daí o roteador volta a mandar.
   */
  const clearImported = useCallback(() => setRawTrack(null), []);

  const addPoint = useCallback(
    (p: LatLng) => {
      clearImported();
      setSelectedWp(null);
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
    [snapAndFix, clearImported],
  );

  const movePoint = useCallback(
    (index: number, p: LatLng) => {
      clearImported();
      setWaypoints((prev) => prev.map((w, i) => (i === index ? p : w)));
      snapAndFix(p, () => index);
    },
    [snapAndFix, clearImported],
  );
  const removePoint = useCallback(
    (index: number) => {
      clearImported();
      setSelectedWp(null);
      setWaypoints((prev) => prev.filter((_, i) => i !== index));
      setSnapStreet(null);
    },
    [clearImported],
  );
  const fitRoute = useCallback(() => setFitRequest((n) => n + 1), []);

  /* ---------- paradas do percurso ---------- */
  const addPoi = useCallback((kindId: string, t?: number, pos?: LatLng) => {
    lastKindRef.current = kindId;
    // O id é sorteado aqui, e não dentro do updater: o updater precisa ser puro
    // (o StrictMode o executa duas vezes) e a seleção tem de apontar para o id
    // que realmente entrou na lista.
    const id = nextPoiId();
    setPois((prev) => [...prev, makePoi(kindId, t ?? nextFreeT(prev), undefined, pos, id)]);
    setSelectedPoi(id);
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
    clearImported();
    setGpxMsg(null);
    setWaypoints(p.points);
    setSettings((prev) => ({ ...prev, profile: p.profile }));
    setPois((p.stops ?? []).map((s) => makePoi(s.kindId, s.t, s.label)));
    setSelectedPoi(null);
    setSelectedWp(null);
    setFitRequest((n) => n + 1); // exemplos: enquadra automaticamente
    setCity({
      id: `preset-${p.id}`,
      name: p.name,
      label: p.name,
      country: "",
      center: p.points[0],
      zoom: 13,
    });
  }, [clearImported]);

  const replay = useCallback(() => {
    setProgress(0);
    progressRef.current = 0;
    setPlaying(true);
  }, []);

  /**
   * O mapa avisa o preparo: `{feito,total}` enquanto baixa, `null` quando pode
   * tocar. Quem toca é esta função — o relógio da animação é do App.
   */
  const aoPreparar = useCallback((estado: { feito: number; total: number } | null) => {
    if (estado) {
      setPreparo(estado);
      return;
    }
    setPreparo(null);
    setPreparando(false);
    setPlaying(true);
  }, []);

  /* rede ruim não pode prender a prévia: depois do teto, toca de qualquer jeito */
  useEffect(() => {
    if (!preparando) return;
    const t = setTimeout(() => {
      setPreparo(null);
      setPreparando(false);
      setPlaying(true);
    }, 20000);
    return () => clearTimeout(t);
  }, [preparando]);

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
    clearImported();
    setSelectedWp(null);
    setWaypoints((p) => p.slice(0, -1));
    setSnapStreet(null);
  }, [clearImported]);
  const clearPoints = useCallback(() => {
    clearImported();
    setGpxMsg(null);
    setWaypoints([]);
    setPlaying(false);
    setSnapStreet(null);
    setPois([]);
    setSelectedPoi(null);
    setSelectedWp(null);
  }, [clearImported]);

  /* ---------- exportação ---------- */
  /* ---------- GPX (importar / exportar) ---------- */

  /** Lê um arquivo GPX e monta a rota a partir dele. */
  const importarGpx = useCallback(async (file: File) => {
    setGpxMsg(null);
    try {
      const dados = parseGpx(await file.text());

      const temTracado = dados.points.length > 1;
      // o traçado completo fica guardado; os waypoints são a versão editável
      const pontos = temTracado ? simplifyTo(dados.points, MAX_WAYPOINTS) : [];
      setWaypoints(pontos);
      setRoute(null);

      // pontos soltos do arquivo viram paradas do percurso
      const base = buildTrack(temTracado ? dados.points : pontos);
      setPois(
        dados.waypoints.map((w) => {
          const near = nearestTOnTrack(base, { lat: w.lat, lng: w.lng });
          const colada = temTracado && near.offset <= 30;
          return makePoi(
            poiKindForSym(w.sym, w.name),
            temTracado ? near.t : 0.5,
            w.name,
            colada || !temTracado ? undefined : { lat: w.lat, lng: w.lng },
            nextPoiId(),
          );
        }),
      );
      setSelectedPoi(null);
      setSelectedWp(null);
      setPlaying(false);
      setProgress(0);
      progressRef.current = 0;
      progressUiRef.current = 0;
      setRawTrack(temTracado ? dados.points : null);
      setFitRequest((n) => n + 1);

      // aproveita o nome do arquivo, desde que o usuário não tenha escolhido um
      if (dados.name) {
        setSettings((prev) =>
          prev.title === DEFAULT_SETTINGS.title ? { ...prev, title: dados.name! } : prev,
        );
      }

      const partes: string[] = [];
      partes.push(
        temTracado
          ? `${dados.points.length.toLocaleString("pt-BR")} pontos de traçado`
          : "sem traçado",
      );
      if (dados.waypoints.length > 0) {
        partes.push(
          `${dados.waypoints.length} ${dados.waypoints.length === 1 ? "parada" : "paradas"}`,
        );
      }
      if (dados.segments > 1) partes.push(`${dados.segments} trechos`);
      if (dados.reduced) partes.push(`reduzido a ${pontos.length} pontos`);
      setGpxMsg({ tipo: "info", texto: `GPX importado: ${partes.join(" · ")}.` });
    } catch (err) {
      const texto =
        err instanceof GpxError
          ? err.message
          : "Não foi possível ler o arquivo. Verifique se é um GPX válido.";
      setGpxMsg({ tipo: "erro", texto });
    }
  }, []);

  /** Baixa a rota atual como GPX. */
  const exportarGpx = useCallback(() => {
    if (!hasRoute) return;
    // O traçado importado sai inteiro: o `track` que desenha na tela passa pelo
    // teto de pontos, então exportá-lo devolveria menos pontos do que entraram.
    const pontos = rawTrack ?? track.pts;
    const xml = toGpx({
      points: pontos,
      waypoints: sortPois(pois).map((p) => {
        const pos = poiLatLng(p, track);
        return { lat: pos.lat, lng: pos.lng, name: p.label, sym: p.emoji };
      }),
      name: settings.title.trim() || "Rota",
      desc: settings.subtitle.trim() || formatDistance(track.total),
    });
    downloadBlob(
      new Blob([xml], { type: "application/gpx+xml" }),
      gpxFileName(settings.title || "rota"),
    );
  }, [hasRoute, rawTrack, track, pois, settings.title, settings.subtitle]);

  /** Copia o permalink da rota atual. */
  const copiarLink = useCallback(async () => {
    const url = buildShareUrl({ waypoints, settings, pois, endpoints, city });
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopiado(true);
      window.setTimeout(() => setLinkCopiado(false), 2200);
    } catch {
      // área de transferência bloqueada (contexto inseguro ou permissão):
      // mostra o link para copiar à mão em vez de falhar em silêncio
      window.prompt("Copie o link da rota:", url);
    }
  }, [waypoints, settings, pois, endpoints, city]);

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
      showSummary: settings.endCard,
      showHud: settings.showHud,
      // a pé o HUD mostra ritmo (min/km) em vez de velocidade
      pace: usaRitmo(settings.activity),
      title: settings.title,
      subtitle: settings.subtitle,
    };
    const stops = sortPois(pois);
    const camera = cameraDoVideo(stops);

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
          passages: passagens,
          endpoints,
          elapsed,
          duration: settings.duration,
          timeline: linhaDoTempo,
          summary: cartela,
          times: horas,
          cardSeconds: tempoCartela,
          colored,
          marks: marcas,
          photos: fotos,
          cardPhoto: settings.cardPhoto,
        });

      // os servidores gratuitos pedem uso moderado
      const needed = tilesForAnimation(
        track,
        camera,
        aspect.w,
        aspect.h,
        settings.basemap,
        camera.cinematic,
        focoDoVideo,
      ).length;
      if (needed > TILE_BUDGET) {
        throw new Error(budgetAdvice(needed, sugestaoZoom, camera.mode));
      }

      /*
       * As fotos são decodificadas antes do primeiro quadro: o desenho é
       * síncrono, e uma foto que chegasse no meio da gravação apareceria de
       * repente. Com prazo — foto corrompida não pode travar a exportação.
       *
       * A lista sai de `photoSources` (cartela + paradas + partida/chegada):
       * montada à mão, ela já esqueceu as fotos de A e B uma vez.
       */
      await fotos.ready(
        photoSources(
          [settings.cardPhoto],
          stops.map((p) => p.photo),
          [endpoints.a?.photo, endpoints.b?.photo],
        ),
      );

      // mostra o mapa carregando no canvas (não fica uma tela preta)
      paint(0, 0);
      await renderer.warmup(
        track,
        camera,
        aspect.w,
        aspect.h,
        (p) => {
          setExportProgress(p);
          paint(Math.min(0.35, p * 0.35), p * 12);
        },
        // o mesmo foco do desenho: a parada pode ter lugar próprio, fora da
        // linha, e é o mapa **daquele lugar** que precisa estar baixado
        focoDoVideo,
      );
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

      /*
       * Qual motor vai gravar — e com que `fps`.
       *
       * WebCodecs renderiza mais rápido que o tempo real e escreve o tempo exato
       * de cada quadro. Se o navegador não souber codificar o formato escolhido,
       * quem grava é o `MediaRecorder`, em tempo real — e aí o `fps` precisa
       * **dividir** a taxa da tela, senão os quadros do arquivo saem com durações
       * alternadas (33 ms e 50 ms numa tela de 60 Hz com 24 pedidos) e o mapa
       * anda aos pulos.
       */
      const rapida =
        settings.fastExport &&
        (await isFastEncodeSupported(activeFormat, aspect.w, aspect.h, settings.fps));
      if (cancelRef.current) throw new CancelledError();
      const taxaDaTela = rapida ? 0 : await medirTaxaDaTela();
      const fpsFinal = rapida ? settings.fps : fpsQueCasa(taxaDaTela, settings.fps);

      const engine = {
        canvas: canvasForRecord ?? canvasRef.current ?? document.createElement("canvas"),
        width: aspect.w,
        height: aspect.h,
        fps: fpsFinal,
        durationSec: settings.duration,
        format: activeFormat,
        bitrate: Math.round(settings.bitrateMbps * 1_000_000),
        onProgress: (t: number) => {
          // atualiza a barra sem re-renderizar a app a cada quadro
          if (t - progressUiRef.current > 0.04 || t >= 1) {
            progressUiRef.current = t;
            setExportProgress(t);
          }
        },
        shouldCancel: () => cancelRef.current,
        draw: (c: CanvasRenderingContext2D, t: number, elapsed: number) => {
          void c;
          // o gravador fala em tempo de vídeo; o desenho, em progresso do percurso
          const seg = t * settings.duration;
          void elapsed;
          // o vídeo desenha a **posição** no percurso, não a fração do vídeo
          // (era aqui que a freada das paradas entrava)
          paint(routeProgress(linhaDoTempo, seg), seg);
        },
      };

      const blob = rapida ? await recordVideoFast(engine) : await recordVideo(engine);
      setVideo({
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
        ext: activeFormat.ext,
        engine: rapida ? "fast" : "realtime",
        fps: fpsFinal,
        fpsPedido: settings.fps,
        taxaDaTela,
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
  }, [
    hasRoute,
    settings,
    track,
    aspect,
    character,
    activeFormat,
    pois,
    endpoints,
    linhaDoTempo,
  ]);

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
          onClick={copiarLink}
          disabled={waypoints.length === 0}
          title={
            waypoints.length === 0
              ? "Trace uma rota para gerar o link"
              : "Copiar um link que abre esta rota, com a cena e as paradas"
          }
          aria-label="Copiar link da rota"
          className={
            "ml-auto shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-35 " +
            (linkCopiado
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
              : "border-white/10 bg-white/5 text-zinc-200 hover:text-white")
          }
        >
          {linkCopiado ? "✓ Link copiado" : "🔗 Compartilhar"}
        </button>

        <button
          type="button"
          onClick={() => setShowSidebar((v) => !v)}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 lg:hidden"
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
            note={
              rawTrack
                ? "Traçado importado do GPX — mantido exatamente como veio. Mover, adicionar ou remover um ponto volta a calcular pelo roteador."
                : route?.note
            }
            city={city}
            onCity={pickCity}
            pois={pois}
            passages={passagens}
            track={track}
            cobertura={cobertura}
            blocos={blocos}
            onUseZoom={(z) => update("followZoom", z)}
            progress={sidebarProgress}
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
            resumo={resumo}
            cartela={cartela}
            formats={formats}
            hasRoute={hasRoute}
            maxZoom={maxZoom}
            onUndo={undoPoint}
            onClear={clearPoints}
            onFit={fitRoute}
            onPreset={applyPreset}
            onExport={startExport}
            onReplay={replay}
            onImportGpx={importarGpx}
            onExportGpx={exportarGpx}
            gpxMsg={gpxMsg}
            avisoSalvar={avisoSalvar}
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
            progress={rotaDoVideo}
            playing={playing}
            preparando={preparando}
            onPreparo={aoPreparar}
            flyTo={flyTo}
            fitRequest={fitRequest}
            character={character}
            rotate={settings.rotate}
            accent={settings.accent}
            basemap={settings.basemap}
            follow={settings.cameraMode === "follow"}
            followZoom={settings.followZoom}
            thirdPerson={settings.thirdPerson}
            showRoute={settings.showRoute}
            onAddPoint={addPoint}
            onMovePoint={movePoint}
            onRemovePoint={removePoint}
            selectedWp={selectedWp}
            onSelectPoint={setSelectedWp}
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

          {waypoints.length > 0 && !playing && pinsAsDots(waypoints.length) && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-2xl border border-white/15 bg-zinc-950/85 px-4 py-2.5 text-center shadow-2xl backdrop-blur-md">
              <p className="text-[12.5px] font-semibold text-white">
                📍 {waypoints.length.toLocaleString("pt-BR")} pinos no mapa
              </p>
              <p className="text-[11px] text-zinc-400">
                Clique num pino para escolher · arraste para mover · clique de novo para remover
              </p>
            </div>
          )}

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
              Limite de {MAX_WAYPOINTS.toLocaleString("pt-BR")} paradas atingido
            </div>
          )}

          {(snapping || snapStreet) && waypoints.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/15 bg-zinc-950/88 px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 shadow-xl backdrop-blur-md"
            >
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
              aria-label="Enquadrar a rota inteira"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-zinc-950/85 text-sm text-zinc-200 shadow-xl backdrop-blur-md transition hover:text-white disabled:opacity-35"
            >
              ⤢
            </button>
            <button
              type="button"
              onClick={undoPoint}
              disabled={waypoints.length === 0}
              title="Desfazer último ponto"
              aria-label="Desfazer último ponto"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-zinc-950/85 text-sm text-zinc-200 shadow-xl backdrop-blur-md transition hover:text-white disabled:opacity-35"
            >
              ↩︎
            </button>
          </div>

          <Timeline
            progress={progress}
            rota={rotaDoVideo}
            playing={playing}
            preparo={preparo}
            duration={settings.duration}
            track={track}
            emoji={character.emoji}
            accent={settings.accent}
            disabled={!hasRoute}
            stops={pois}
            onToggle={() => {
              if (!hasRoute) return;
              if (playing) {
                setPlaying(false);
                return;
              }
              // um segundo clique durante o preparo toca já, sem esperar o mapa
              if (preparando) {
                setPreparo(null);
                setPreparando(false);
                setPlaying(true);
                return;
              }
              if (progressRef.current >= 1) {
                replay();
                return;
              }
              /*
               * A câmera "Rota toda" já tem a rota inteira na tela e não anda —
               * não há mapa para preparar. Só a "Seguir" espera.
               */
              if (settings.cameraMode !== "follow") {
                setPlaying(true);
                return;
              }
              setPreparo({ feito: 0, total: 0 });
              setPreparando(true);
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
          engine={video?.engine}
          fps={video?.fps}
          fpsPedido={video?.fpsPedido}
          taxaDaTela={video?.taxaDaTela}
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
