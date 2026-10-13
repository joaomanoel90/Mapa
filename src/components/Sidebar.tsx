import { memo } from "react";
import CitySearch from "./CitySearch";
import EndpointEditor from "./EndpointEditor";
import StopEditor from "./StopEditor";
import type { Endpoints } from "../lib/endpoints";
import { CharacterPicker, AccentPicker } from "./CharacterPicker";
import type { Place } from "../lib/geocode";
import type { Poi } from "../lib/pois";
import { Button, Label, Section, Segmented, Slider, TextInput, Toggle } from "./ui";
import { ASPECTS, MAX_WAYPOINTS, type AspectId, type Settings } from "../lib/settings";
import { PROFILES, PRESETS, type Profile, type Preset } from "../lib/routing";
import { BASEMAPS, BASEMAP_ORDER } from "../lib/tiles";
import { findCharacter } from "../lib/characters";
import { formatDistance, formatSpeed, type LatLng, type Track } from "../lib/geo";
import type { VideoFormat } from "../lib/recorder";

type Props = {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  waypoints: LatLng[];
  distance: number;
  routeSource: "osrm" | "direct" | "mixed";
  note?: string;
  city: Place | null;
  onCity: (p: Place) => void;
  /* paradas do percurso */
  pois: Poi[];
  track: Track;
  progress: number;
  selectedPoi: string | null;
  poiMode: boolean;
  onTogglePoiMode: () => void;
  onSelectPoi: (id: string | null) => void;
  onAddPoi: (kindId: string, t?: number) => void;
  onUpdatePoi: (id: string, patch: Partial<Poi>) => void;
  onRemovePoi: (id: string) => void;
  onClearPois: () => void;
  onNudgePoi: (id: string, east: number, north: number) => void;
  onSnapPoi: (id: string) => void;
  onZoomPoi: (id: string) => void;
  /* partida/chegada como locais marcados */
  endpoints: Endpoints;
  onEndpoints: (next: Endpoints) => void;
  loading: boolean;
  formats: VideoFormat[];
  hasRoute: boolean;
  /** zoom máximo servido pelo estilo de mapa escolhido */
  maxZoom: number;
  onUndo: () => void;
  onClear: () => void;
  /** reenquadra a rota (o mapa nunca se move sozinho ao marcar pontos) */
  onFit: () => void;
  onPreset: (p: Preset) => void;
  onExport: () => void;
  onReplay: () => void;
};

function Sidebar(props: Props) {
  const {
    settings: s,
    update,
    waypoints,
    distance,
    routeSource,
    note,
    city,
    onCity,
    pois,
    track,
    progress,
    selectedPoi,
    poiMode,
    onTogglePoiMode,
    onSelectPoi,
    onAddPoi,
    onUpdatePoi,
    onRemovePoi,
    onClearPois,
    onNudgePoi,
    onSnapPoi,
    onZoomPoi,
    endpoints,
    onEndpoints,
    loading,
    formats,
    hasRoute,
    maxZoom,
    onUndo,
    onClear,
    onFit,
    onPreset,
    onExport,
    onReplay,
  } = props;

  const avgKmh = hasRoute && s.duration > 0 ? (distance / 1000 / s.duration) * 3600 : 0;
  const character = findCharacter(s.characterId);
  const aspect = ASPECTS.find((a) => a.id === s.aspect) ?? ASPECTS[0];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 pb-8 nice-scroll">
      <Section
        step={1}
        title="Escolher a cidade"
        hint="Busque qualquer cidade do mundo ou use um atalho para posicionar o mapa."
      >
        <CitySearch current={city} onPick={onCity} />
      </Section>

      <Section
        step={2}
        title="Traçar a rota"
        hint="Clique no mapa para adicionar paradas. Arraste os pinos para ajustar e clique neles para remover."
      >
        <div className="space-y-3">
          <div>
            <Label>Tipo de deslocamento</Label>
            <Segmented<Profile>
              options={PROFILES.map((p) => ({ id: p.id, label: p.name, icon: p.emoji, title: p.label }))}
              value={s.profile}
              onChange={(v) => update("profile", v)}
            />
          </div>
          {s.profile !== "straight" && (
            <div className="space-y-1.5">
              <Toggle
                icon="🛣️"
                label="Encaixar na rua mais próxima"
                checked={s.snapToRoad}
                onChange={(v) => update("snapToRoad", v)}
              />
              <Toggle
                icon="↔️"
                label="Ignorar mão única (contramão)"
                checked={s.ignoreOneway}
                onChange={(v) => update("ignoreOneway", v)}
              />
              <p className="text-[10.5px] leading-snug text-zinc-500">
                {s.snapToRoad
                  ? "Cada clique é movido para cima do eixo da via mais próxima — a linha nunca começa no meio de um quarteirão."
                  : "Os pontos ficam exatamente onde você clicou."}
                <br />
                {s.ignoreOneway
                  ? "O traçado segue o caminho mais direto, sem voltas no quarteirão por causa do sentido das vias."
                  : "O traçado respeita o sentido obrigatório das vias — pode fazer desvios para entrar na mão correta."}
              </p>
            </div>
          )}
          <div>
            <Label>Rotas de exemplo</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPreset(p)}
                  className="rounded-xl border border-white/10 bg-black/25 px-1 py-2 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-white"
                >
                  <span className="mr-0.5">{p.emoji}</span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button onClick={onUndo} disabled={waypoints.length === 0} className="flex-1">
              ↩︎ Desfazer
            </Button>
            <Button
              onClick={onFit}
              disabled={waypoints.length < 2}
              title="Ajusta o zoom para mostrar a rota inteira"
            >
              ⤢ Enquadrar
            </Button>
            <Button variant="danger" onClick={onClear} disabled={waypoints.length === 0}>
              Limpar
            </Button>
          </div>
          <EndpointEditor endpoints={endpoints} onChange={onEndpoints} />
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">Paradas</span>
              <span className="font-semibold text-white">
                {waypoints.length}
                <span className="font-normal text-zinc-500"> / {MAX_WAYPOINTS}</span>
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">Distância</span>
              <span className="font-semibold text-white">{formatDistance(distance)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">Traçado</span>
              <span
                className={
                  routeSource === "osrm"
                    ? "font-semibold text-emerald-300"
                    : "font-semibold text-amber-300"
                }
              >
                {loading
                  ? "calculando…"
                  : routeSource === "osrm"
                    ? s.ignoreOneway
                      ? "ruas · direto"
                      : "ruas · mão única"
                    : routeSource === "mixed"
                      ? "parcial"
                      : "linha direta"}
              </span>
            </div>
            <p className="mt-2 border-t border-white/5 pt-2 text-[10.5px] leading-snug text-zinc-500">
              🔒 Trechos já traçados ficam fixos: adicionar ou mover um ponto só
              recalcula os trechos vizinhos.
              <br />
              🔍 O zoom é seu: o mapa não se reposiciona ao marcar pontos — use
              “Enquadrar” quando quiser ver a rota inteira.
            </p>
            {note && <p className="mt-2 text-[11px] leading-snug text-amber-300/80">⚠️ {note}</p>}
          </div>
        </div>
      </Section>

      <Section
        step={3}
        title="Paradas do percurso"
        hint="Pontos que surgem no vídeo quando o personagem passa — ponte, cachoeira, igreja. Podem ficar fora da rota, com ajuste em metros."
        right={
          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
            {pois.length}
          </span>
        }
      >
        <div className="space-y-3">
          <StopEditor
            pois={pois}
            track={track}
            progress={progress}
            accent={s.accent}
            selectedId={selectedPoi}
            poiMode={poiMode}
            onTogglePoiMode={onTogglePoiMode}
            onSelect={onSelectPoi}
            onAdd={(kindId) => onAddPoi(kindId)}
            onUpdate={onUpdatePoi}
            onRemove={onRemovePoi}
            onClear={onClearPois}
            onNudge={onNudgePoi}
            onSnapToRoute={onSnapPoi}
            onZoomTo={onZoomPoi}
          />
          <div className="grid grid-cols-1 gap-1.5">
            <Toggle
              icon="📍"
              label="Mostrar paradas no vídeo"
              checked={s.showStops}
              onChange={(v) => update("showStops", v)}
            />
            <Toggle
              icon="🏷️"
              label="Mostrar nome de cada parada"
              checked={s.showStopLabels}
              onChange={(v) => update("showStopLabels", v)}
            />
            <Toggle
              icon="🔢"
              label="Mostrar contador (ex: 2/5 paradas)"
              checked={s.showStopCounter}
              onChange={(v) => update("showStopCounter", v)}
            />
          </div>
        </div>
      </Section>

      <Section step={4} title="Personagem" hint="Quem (ou o quê) vai percorrer a rota.">
        <div className="space-y-3">
          <CharacterPicker
            value={s.characterId}
            onChange={(c) => update("characterId", c.id)}
          />
          <div>
            <Label>Cor do rastro</Label>
            <AccentPicker value={s.accent} onChange={(v) => update("accent", v)} />
          </div>
          <Toggle
            icon="🧭"
            label="Girar na direção da rota"
            checked={s.rotate}
            onChange={(v) => update("rotate", v)}
          />
          <div>
            <Label value="grátis, sem chave">Estilo do mapa</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {BASEMAP_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  title={`${BASEMAPS[id].hint} — ${BASEMAPS[id].license}`}
                  onClick={() => update("basemap", id)}
                  className={
                    "rounded-xl border px-1 py-2 text-[11px] font-semibold transition-colors " +
                    (s.basemap === id
                      ? "border-violet-400/60 bg-violet-500/20 text-white"
                      : "border-white/10 bg-black/25 text-zinc-400 hover:text-white")
                  }
                >
                  <span
                    className="mx-auto mb-1 block h-4 w-full rounded-md border border-white/10"
                    style={{ background: BASEMAPS[id].bg }}
                  />
                  {BASEMAPS[id].name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-500">
              🆓 {BASEMAPS[s.basemap].license}. {BASEMAPS[s.basemap].attribution}.
            </p>
          </div>
          <p className="rounded-xl border border-white/10 bg-black/20 p-2.5 text-[11px] leading-snug text-zinc-400">
            Personagem atual: <span className="font-semibold text-white">{character.name}</span>{" "}
            {character.emoji} · {character.group}
          </p>
        </div>
      </Section>

      <Section step={5} title="Animação" hint="Como o personagem se move e como a câmera acompanha.">
        <div className="space-y-3">
          <div>
            <Label value={`${s.duration.toFixed(0)} s`}>Duração do vídeo</Label>
            <Slider
              min={3}
              max={60}
              step={1}
              value={s.duration}
              onChange={(v) => update("duration", v)}
            />
            {hasRoute && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Velocidade média simulada:{" "}
                <span className="font-semibold text-zinc-300">{formatSpeed(avgKmh)}</span>
              </p>
            )}
          </div>
          <div>
            <Label>Câmera</Label>
            <Segmented
              options={[
                { id: "follow", label: "Seguir", icon: "🎥" },
                { id: "fit", label: "Rota toda", icon: "🗺️" },
              ]}
              value={s.cameraMode}
              onChange={(v) => update("cameraMode", v)}
            />
          </div>
          {s.cameraMode === "follow" && (
            <div>
              <Label value={`zoom ${s.followZoom}`}>Aproximação da câmera</Label>
              <Slider
                min={11}
                max={maxZoom}
                step={0.5}
                value={Math.min(s.followZoom, maxZoom)}
                onChange={(v) => update("followZoom", v)}
              />
              {maxZoom < 18 && (
                <p className="mt-1 text-[10.5px] text-zinc-500">
                  O mapa “{BASEMAPS[s.basemap].name}” é gratuito até o zoom {maxZoom}.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-1.5">
            <Toggle
              icon="📍"
              label="Mostrar pontos A e B"
              checked={s.showEndpoints}
              onChange={(v) => update("showEndpoints", v)}
            />
            <Toggle
              icon="⌇"
              label="Mostrar rota planejada"
              checked={s.showRoute}
              onChange={(v) => update("showRoute", v)}
            />
            <Toggle
              icon="✨"
              label="Mostrar rastro percorrido"
              checked={s.showTraveled}
              onChange={(v) => update("showTraveled", v)}
            />
          </div>
          <Button variant="soft" onClick={onReplay} disabled={!hasRoute} className="w-full">
            ▶︎ Pré-visualizar animação
          </Button>
        </div>
      </Section>

      <Section step={6} title="Exportar vídeo" hint="A gravação acontece no seu navegador — nada é enviado para servidor.">
        <div className="space-y-3">
          <div>
            <Label value={`${aspect.w}×${aspect.h} px`}>Formato da tela</Label>
            <Segmented<AspectId>
              options={ASPECTS.map((a) => ({ id: a.id, label: a.label, title: a.hint }))}
              value={s.aspect}
              onChange={(v) => update("aspect", v)}
              size="sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Quadros por segundo</Label>
              <Segmented
                options={[
                  { id: "24", label: "24" },
                  { id: "30", label: "30" },
                  { id: "60", label: "60" },
                ]}
                value={String(s.fps)}
                onChange={(v) => update("fps", Number(v))}
                size="sm"
              />
            </div>
            <div>
              <Label>Qualidade</Label>
              <Segmented
                options={[
                  { id: "6", label: "Média" },
                  { id: "10", label: "Alta" },
                  { id: "16", label: "Máx" },
                ]}
                value={String(s.bitrateMbps)}
                onChange={(v) => update("bitrateMbps", Number(v))}
                size="sm"
              />
            </div>
          </div>
          <div>
            <Label>Arquivo</Label>
            <select
              value={s.formatId}
              onChange={(e) => update("formatId", e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12.5px] text-white focus:border-violet-400/60 focus:outline-none"
            >
              {formats.length === 0 && <option value="">Gravação não suportada</option>}
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Toggle
              icon="⚡"
              label="Exportação rápida (WebCodecs)"
              checked={s.fastExport}
              onChange={(v) => update("fastExport", v)}
            />
            <p className="text-[11px] leading-snug text-zinc-500">
              Renderiza o vídeo o mais rápido que o aparelho conseguir, com fps exato, em vez de
              gravar em tempo real. Se o navegador não souber codificar o formato escolhido, a
              gravação em tempo real entra no lugar automaticamente.
            </p>
          </div>
          <div className="space-y-2">
            <Toggle
              icon="🏷️"
              label="Mostrar título no vídeo"
              checked={s.showTitle}
              onChange={(v) => update("showTitle", v)}
            />
            {s.showTitle && (
              <div className="space-y-2">
                <TextInput
                  value={s.title}
                  onChange={(v) => update("title", v)}
                  placeholder="Título (ex: Volta no parque)"
                  maxLength={38}
                />
                <TextInput
                  value={s.subtitle}
                  onChange={(v) => update("subtitle", v)}
                  placeholder="Subtítulo (ex: 5,2 km de bicicleta)"
                  maxLength={48}
                />
              </div>
            )}
            <Toggle
              icon="📊"
              label="Mostrar barra de progresso"
              checked={s.showProgress}
              onChange={(v) => update("showProgress", v)}
            />
          </div>
          <Button
            variant="primary"
            onClick={onExport}
            disabled={!hasRoute || formats.length === 0}
            className="w-full py-3 text-sm"
          >
            🎬 Gravar e baixar vídeo
          </Button>
          {formats.length === 0 ? (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-2.5 text-[11px] leading-snug text-red-200">
              Este navegador não suporta gravação de vídeo (MediaRecorder). Tente Chrome, Edge ou
              Safari atualizados.
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-zinc-500">
              {s.fastExport
                ? `A exportação rápida não precisa da aba visível. Se ela não estiver disponível, a gravação em tempo real levará ${s.duration}s — mantenha a aba visível nesse caso.`
                : `Dica: mantenha esta aba visível durante a gravação (${s.duration}s) para não perder quadros.`}
            </p>
          )}
        </div>
      </Section>

      <footer className="rounded-2xl border border-white/10 bg-black/20 p-3.5">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-400">
          🆓 Tudo gratuito, sem chave de API
        </p>
        <ul className="space-y-1 text-[11px] leading-snug text-zinc-400">
          <li>
            <span className="text-zinc-200">Mapas:</span> OpenStreetMap, CyclOSM, OpenTopoMap e
            Esri World Imagery
          </li>
          <li>
            <span className="text-zinc-200">Rotas:</span> OSRM (projeto aberto)
          </li>
          <li>
            <span className="text-zinc-200">Vídeo:</span> gravado no seu navegador, nada sobe
            para servidores
          </li>
        </ul>
        <p className="mt-2 text-[10px] leading-snug text-zinc-600">
          Dados © colaboradores do OpenStreetMap (ODbL). O crédito do mapa é incluído
          automaticamente no vídeo exportado, como exigem as licenças.
        </p>
      </footer>
    </div>
  );
}

export default memo(Sidebar);
