import { memo } from "react";
import CitySearch from "./CitySearch";
import EndCardPanel from "./EndCardPanel";
import EndpointEditor from "./EndpointEditor";
import PhotoField from "./PhotoField";
import StopEditor from "./StopEditor";
import type { Endpoints } from "../lib/endpoints";
import { CharacterPicker, AccentPicker } from "./CharacterPicker";
import type { Place } from "../lib/geocode";
import type { Poi } from "../lib/pois";
import { Button, Label, Section, Segmented, Slider, TextInput, Toggle } from "./ui";
import {
  ACTIVITIES,
  ASPECTS,
  MAX_WAYPOINTS,
  type AspectId,
  type Settings,
} from "../lib/settings";
import type { EndCard, RideSummary } from "../lib/stats";
import { PROFILES, PRESETS, type Profile, type Preset } from "../lib/routing";
import { BASEMAPS, BASEMAP_ORDER } from "../lib/tiles";
import { TILE_BUDGET } from "../lib/map-budget";
import { cn } from "../utils/cn";
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
  /** quantas vezes a rota passa por cada parada (ida e volta conta duas) */
  passages?: Record<string, number[]> | null;
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
  /** quanto do traçado tem elevação e hora (0..1) — decide as dicas da cor */
  cobertura: { ele: number; time: number };
  /** blocos de mapa que a câmera vai precisar (o teto dos servidores gratuitos) */
  blocos: { needed: number; fits: boolean; sugestao: number | null };
  /** aplica o zoom sugerido quando a rota não cabe */
  onUseZoom: (z: number) => void;
  onUndo: () => void;
  onClear: () => void;
  /** reenquadra a rota (o mapa nunca se move sozinho ao marcar pontos) */
  onFit: () => void;
  onPreset: (p: Preset) => void;
  onExport: () => void;
  onReplay: () => void;
  /** importa uma trilha em GPX (o App faz a leitura e a validação) */
  onImportGpx: (file: File) => void;
  /** baixa a rota atual como GPX */
  onExportGpx: () => void;
  /** retorno da importação, para mostrar erro ou resumo */
  gpxMsg: { tipo: "erro" | "info"; texto: string } | null;
  /** aviso de gravação das preferências (foto grande, armazenamento cheio) */
  avisoSalvar?: string | null;
  /**
   * Por que o ⚡ não pode rodar neste navegador (null = pode).
   *
   * Antes o app só descobria na hora de gravar e caía para o tempo real em
   * silêncio — foi assim que o usuário gravou 60 quadros por segundo no motor
   * errado, com 63% de cadência no fim. O aviso tem de aparecer **antes**.
   */
  avisoRapido?: string | null;
  /** o que o arquivo mediu (sugestões e contagem) */
  resumo: RideSummary;
  /** a cartela montada com o que foi digitado — null quando não há nada */
  cartela: EndCard | null;
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
    passages,
    track,
    cobertura,
    blocos,
    onUseZoom,
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
    resumo,
    cartela,
    formats,
    hasRoute,
    maxZoom,
    onUndo,
    onClear,
    onFit,
    onPreset,
    onExport,
    onReplay,
    onImportGpx,
    onExportGpx,
    gpxMsg,
    avisoSalvar,
    avisoRapido,
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
          {s.profile === "straight" ? (
            <p className="text-[11px] leading-snug text-zinc-500">
              Reta entre os pontos — é o modo para travessias longas (entre cidades de
              continentes diferentes, por cima do mar). O vídeo mostra o percurso inteiro no
              mapa, e numa rota de milhares de km o app desce o zoom até caber nos mapas
              gratuitos.
            </p>
          ) : (
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
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-zinc-200">🛰️ GPX</span>
              <span className="text-[10.5px] text-zinc-500">Strava, Garmin, Komoot…</span>
            </div>
            <div className="flex gap-1.5">
              {/*
                O seletor de arquivo é aberto pelo **rótulo**, não por
                `input.click()`.

                O botão antigo chamava `.click()` num input com `className="hidden"`
                — e no Safari (iPhone/iPad) clicar programaticamente num input com
                `display: none` **não abre nada**. O usuário tocou em "Importar" e
                não aconteceu nada: nenhum arquivo escolhido, nenhuma mensagem.

                Com o rótulo envolvendo o input, quem abre o seletor é o próprio
                navegador — funciona em todos, sem JavaScript no meio. O input
                continua escondido, mas com `sr-only` (recortado, não
                `display: none`), que é o que os leitores de tela e o Safari
                esperam.
              */}
              <label
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-white/25 hover:text-white active:scale-[0.98]"
                title="Abrir uma trilha gravada (.gpx)"
              >
                <span aria-hidden="true">📂</span> Importar
                <input
                  type="file"
                  /*
                   * **Sem `accept`.**
                   *
                   * A lista de tipos era larga (`.gpx`, `.xml`, `.txt` e os MIME
                   * de sempre) justamente para o `.gpx` não aparecer apagado no
                   * Android — e continuou aparecendo em aparelhos que entregam o
                   * arquivo com um MIME fora da lista, ou com o nome sem
                   * extensão (`StravaGPX`), ou ainda com provedor de conteúdo da
                   * nuvem. Arquivo apagado no seletor é "escolhi e não abre".
                   *
                   * Sem filtro, todo arquivo pode ser escolhido — e quem valida o
                   * conteúdo é o `parseGpx`, que já recusa o que não é GPX com um
                   * recado claro.
                   */
                  className="sr-only"
                  aria-label="Escolher arquivo GPX"
                  onChange={(e) => {
                    const campo = e.target;
                    const arquivo = campo.files?.[0];
                    if (arquivo) onImportGpx(arquivo);
                    /*
                     * Limpar o campo **depois** do evento, não durante.
                     *
                     * É o que deixa escolher o mesmo arquivo duas vezes — mas no
                     * Safari do iPhone/iPad zerar o `value` no meio do `change`
                     * invalida o `File` recém-escolhido: a leitura falha com
                     * "o arquivo não devolveu conteúdo", sem o usuário ter feito
                     * nada de errado. No fim da fila, o `File` já foi lido.
                     */
                    window.setTimeout(() => {
                      campo.value = "";
                    }, 0);
                  }}
                />
              </label>
              <Button
                onClick={onExportGpx}
                disabled={!hasRoute}
                className="flex-1"
                title="Baixar a rota atual como GPX"
              >
                ⬇️ Exportar
              </Button>
            </div>
            {avisoSalvar && (
              <div className="mb-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100">
                {avisoSalvar}
              </div>
            )}
            {gpxMsg ? (
              <p
                role="status"
                aria-live="polite"
                className={
                  "mt-2 rounded-lg border p-2 text-[11px] leading-snug " +
                  (gpxMsg.tipo === "erro"
                    ? "border-red-400/30 bg-red-500/10 text-red-200"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200")
                }
              >
                {gpxMsg.texto}
              </p>
            ) : (
              <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">
                Importar usa o traçado exato do arquivo, sem recalcular pelas ruas. Mover um ponto
                volta a calcular pelo roteador.
              </p>
            )}
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
                {waypoints.length.toLocaleString("pt-BR")}
                <span className="font-normal text-zinc-500">
                  {" "}
                  / {MAX_WAYPOINTS.toLocaleString("pt-BR")}
                </span>
              </span>
            </div>
            {hasRoute && (
              <div
                className="mt-1 flex items-center justify-between text-[12px]"
                title="Pontos do traçado desenhado no mapa e no vídeo. As paradas acima são só os pontos de controle que dá para arrastar."
              >
                <span className="text-zinc-400">Pontos do traçado</span>
                <span className="font-semibold text-white">
                  {track.pts.length.toLocaleString("pt-BR")}
                </span>
              </div>
            )}
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
            passages={passages}
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
          {/*
            O avatar entra **no lugar do emoji** dentro do selo, na mesma
            moldura. É opcional de propósito: quem quer o carro ou a bike
            continua com eles, e quem quer a própria cara (ou o escudo do time)
            escolhe a foto aqui.
          */}
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <PhotoField
              valor={s.avatar}
              onValor={(v) => update("avatar", v)}
              rotulo="Avatar (no lugar do emoji)"
              ariaLabel="Avatar do personagem"
            />
            <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-500">
              {s.avatar
                ? "A foto aparece dentro do selo do personagem, no vídeo e na prévia. A seta continua mostrando o rumo."
                : "Opcional. Sem foto, vale o emoji do personagem escolhido acima."}
            </p>
          </div>
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
            <div className="mt-1.5 space-y-1">
              <Toggle
                icon="🧍"
                label="Terceira pessoa"
                checked={s.thirdPerson}
                onChange={(v) => update("thirdPerson", v)}
              />
              {s.thirdPerson &&
                (s.cameraMode === "follow" ? (
                  <>
                    <Toggle
                      icon="🧭"
                      label="Girar o mapa com o rumo"
                      checked={s.spinMap}
                      onChange={(v) => update("spinMap", v)}
                    />
                    <Toggle
                      icon="🏔️"
                      label="Inclinar o horizonte"
                      checked={s.tiltHorizonte}
                      onChange={(v) => update("tiltHorizonte", v)}
                    />
                    <p className="text-[10.5px] leading-snug text-zinc-500">
                      A câmera vem para trás do personagem: ele fica abaixo do centro, com o
                      caminho à frente ocupando a parte de cima do quadro. O mapa continua
                      com o norte para cima; ligando o giro, o caminho fica sempre “para
                      cima” e o mapa roda no rumo. A inclinação comprime a parte de cima do
                      quadro, como o chão visto de rasão: é o que dá a sensação de
                      horizonte (não vale na pré-visualização do mapa, só no vídeo).
                    </p>
                  </>
                ) : (
                  <p className="text-[10.5px] leading-snug text-amber-300/80">
                    Só vale na câmera “Seguir”: no “Rota toda” a rota já está inteira na
                    tela.
                  </p>
                ))}
            </div>
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
              {/*
                Contador de blocos: a rota longa não cabe no teto dos servidores
                gratuitos, e a exportação era recusada só no fim, sem dizer até
                onde diminuir o zoom. Aqui o número aparece antes, e o botão
                resolve com um clique.
              */}
              <p
                className={cn(
                  "mt-1 text-[10.5px]",
                  blocos.fits ? "text-zinc-500" : "font-semibold text-amber-300",
                )}
              >
                {blocos.fits
                  ? `≈ ${blocos.needed} blocos de mapa`
                  : `≈ ${blocos.needed} blocos — acima do limite dos mapas gratuitos (${TILE_BUDGET})`}
              </p>
              {!blocos.fits && (
                <div className="mt-1.5">
                  {blocos.sugestao !== null ? (
                    <Button
                      variant="soft"
                      className="w-full"
                      onClick={() => onUseZoom(blocos.sugestao as number)}
                    >
                      Usar zoom {blocos.sugestao}
                    </Button>
                  ) : (
                    <p className="text-[10.5px] leading-snug text-amber-300/90">
                      Nem no zoom mínimo cabe: use a câmera “Rota toda”.
                    </p>
                  )}
                  <p className="mt-1 text-[10.5px] leading-snug text-zinc-500">
                    Se você gravar assim mesmo, o app ajusta a câmera ao orçamento e avisa na
                    janela de gravação.
                  </p>
                </div>
              )}
            </div>
          )}
          <div>
            <Label>Cor da rota</Label>
            <Segmented
              options={[
                { id: "solid", label: "Sólida", title: "Uma cor só, como sempre" },
                { id: "speed", label: "Velocidade", title: "Precisa de hora no arquivo" },
                { id: "slope", label: "Inclinação", title: "Precisa de elevação no arquivo" },
              ]}
              value={s.colorBy}
              onChange={(v) => update("colorBy", v)}
              size="sm"
            />
            {(() => {
              const dica =
                s.colorBy === "slope"
                  ? cobertura.ele <= 0
                    ? "Este traçado não tem elevação — a linha sai cinza. Importe um GPX com altitudes."
                    : cobertura.ele < 0.5
                      ? `Só ${Math.round(cobertura.ele * 100)}% dos pontos têm elevação: o resto sai cinza.`
                      : null
                  : s.colorBy === "speed"
                    ? cobertura.time <= 0
                      ? "Este traçado não tem hora — a linha sai cinza. Importe um GPX gravado (com data em cada ponto)."
                      : cobertura.time < 0.5
                        ? `Só ${Math.round(cobertura.time * 100)}% dos pontos têm hora: o resto sai cinza.`
                        : null
                    : null;
              return dica ? (
                <p className="mt-1 text-[10.5px] leading-snug text-amber-300/80">{dica}</p>
              ) : null;
            })()}
          </div>

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
            <Toggle
              icon="🧭"
              label="HUD no vídeo"
              checked={s.showHud}
              onChange={(v) => update("showHud", v)}
            />
            {s.showHud && cobertura.time <= 0 && (
              <p className="px-1 text-[10.5px] leading-snug text-zinc-500">
                Sem hora no arquivo: o HUD vira <strong>prévia de percurso</strong> — mostra a
                inclinação do trecho (ou quanto falta), sem ritmo nem relógio. Tempo inventado não
                entra no vídeo.
              </p>
            )}
            <Toggle
              icon="🗺️"
              label="Mapa em miniatura"
              checked={s.minimap}
              onChange={(v) => update("minimap", v)}
            />
            {s.minimap && (
              <p className="text-[11px] leading-snug text-zinc-500">
                No canto, abaixo do título: só o contorno da rota, com o pedaço já
                percorrido em destaque e o personagem marcado. Sem mapa no fundo — ele se
                desenha sozinho conforme o percurso anda.
              </p>
            )}
            <Toggle
              icon="📈"
              label="Perfil de elevação"
              checked={s.elevationProfile}
              onChange={(v) => update("elevationProfile", v)}
            />
            {s.elevationProfile && (
              <p className="text-[11px] leading-snug text-zinc-500">
                No rodapé: a linha do relevo se enchendo junto com o personagem, com a
                altitude do momento, o D+ e a maior subida marcada. Só aparece quando o
                arquivo tem altitude.
              </p>
            )}
            <Toggle
              icon="🏅"
              label="Destaques do percurso"
              checked={s.highlights}
              onChange={(v) => update("highlights", v)}
            />
            {s.highlights && (
              <p className="text-[11px] leading-snug text-zinc-500">
                A <strong>melhor parcial</strong> e a <strong>maior subida</strong> aparecem uma vez
                cada, num aviso curto, quando o personagem chega nelas. Sem hora no arquivo não há
                parcial; sem altitude, não há subida.
              </p>
            )}
            <Toggle
              icon="🏁"
              label="Cartela final"
              checked={s.endCard}
              onChange={(v) => update("endCard", v)}
            />
            <Toggle
              icon="🪧"
              label="Marcas de km"
              checked={s.showKmMarks}
              onChange={(v) => update("showKmMarks", v)}
            />
            <Toggle
              icon="🎬"
              label="Câmera cinematográfica"
              checked={s.cinematic}
              onChange={(v) => update("cinematic", v)}
            />
          </div>
          <div>
            <Label>Atividade</Label>
            <Segmented
              options={ACTIVITIES.map((a) => ({
                id: a.id,
                label: a.label,
                icon: a.icon,
                title: a.hint,
              }))}
              value={s.activity}
              onChange={(v) => update("activity", v)}
            />
            {s.activity !== "pedal" && (
              <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                O HUD mostra o ritmo médio (<span className="font-semibold text-zinc-300">min/km</span>)
                em vez da velocidade. Sem hora no arquivo nem tempo na cartela, sai um traço.
              </p>
            )}
          </div>
          {s.cinematic &&
            (s.cameraMode === "follow" ? (
              <p className="text-[11px] leading-snug text-zinc-500">
                Abertura sobrevoando a região (~2 s) e, em cada parada, um zoom
                com a câmera indo até o ponto — sem freada: o caminho não para.
              </p>
            ) : (
              <p className="text-[11px] leading-snug text-amber-300/80">
                Só vale na câmera “Seguir”: no “Rota toda” a rota já está inteira na tela.
              </p>
            ))}
          <EndCardPanel resumo={resumo} cartela={cartela} settings={s} update={update} />
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
              {/*
                Na gravação em tempo real quem carimba o tempo é a tela, e o
                fps pedido é ajustado para a divisora mais próxima dela. Não é
                mais uma questão de velocidade (o conteúdo do quadro sai do
                relógio, então o mapa anda igual mesmo quando um quadro dura
                mais que o outro): é para os quadros do arquivo ficarem
                igualmente espaçados.
              */}
              {/*
                O número que decide a fluidez é este — medido nos vídeos do
                usuário: o que ele achou fluido tinha ~53 quadros por segundo,
                com 93% deles no mesmo intervalo; a 30, o mesmo mapa andava o
                mesmo tanto por quadro, mas 22% dos quadros vinham fora do
                tempo, e o olho lê isso como travada.
              */}
              <p className="mt-1 text-[10.5px] leading-snug text-zinc-500">
                60 é o que faz o mapa fluir — com o ⚡ ligado.{" "}
                {!s.fastExport
                  ? "Em tempo real o app usa no máximo 30 e ajusta para dividir a taxa da tela (num monitor de 60 Hz, 24 vira 20): a 60 o desenho não cabe em 16,7 ms e cada quadro atrasado é o que se vê como travada."
                  : "Sem o ⚡, o app cai para 30 no tempo real."}
              </p>
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
              gravar em tempo real. É o único caminho que segura 60 quadros por segundo com o tempo
              certo, sem depender da tela.
            </p>
            {s.fastExport && avisoRapido && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-200">
                ⚡ indisponível: {avisoRapido}. A gravação sairá em tempo real — e nesse modo o app
                usa no máximo 30 quadros por segundo, que é o que cabe no tempo de um quadro.
              </p>
            )}
            {/*
              O interruptor desligado **não** diz se o navegador daria conta. A
              pergunta ao WebCodecs é feita de qualquer jeito, e a resposta
              aparece aqui: "este navegador suporta, é só ligar" ou o motivo de
              ele não rodar. Antes, quem gravava em tempo real com 65% de
              cadência só lia "desligada no painel" e não sabia que a solução
              estava a um clique.
            */}
            {!s.fastExport && (
              <p className="rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] leading-snug text-zinc-400">
                {avisoRapido === undefined ? (
                  <>⚡ desligado. Verificando se este navegador consegue rodá-lo…</>
                ) : avisoRapido === null ? (
                  <>
                    ⚡ <strong className="font-semibold text-zinc-200">desligado</strong>, mas este
                    navegador suporta: é o único caminho para 60 quadros por segundo com o tempo
                    exato, sem depender da tela.{" "}
                    <button
                      type="button"
                      onClick={() => update("fastExport", true)}
                      className="font-semibold text-violet-300 underline decoration-violet-400/40 underline-offset-2 transition hover:text-violet-200"
                    >
                      Ligar o ⚡
                    </button>
                  </>
                ) : (
                  <>⚡ desligado — e neste navegador ele não rodaria: {avisoRapido}.</>
                )}
              </p>
            )}
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
            {/*
              O botão diz em que motor a gravação vai sair. Sem isso, quem
              escolhe 60 quadros com o ⚡ desligado aperta "gravar" acreditando
              que vai receber 60 — e recebe 30 em tempo real, com a cadência da
              tela. O rótulo é a última chance de o usuário perceber.
            */}
            {s.fastExport && avisoRapido === null
              ? "🎬 Gravar e baixar vídeo (⚡)"
              : "🎬 Gravar em tempo real"}
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
        {/*
          O app é gratuito e continua gratuito; o vídeo pronto é serviço à parte.
          O endereço é **relativo** de propósito: o mesmo link funciona na
          máquina local (`/comercial/precos.html`), na prévia e no Pages, que
          publica em `/Mapa/` — e a página mora em `public/comercial/`, que o
          Vite copia para o build.
        */}
        <p className="mt-2 border-t border-white/5 pt-2 text-[10.5px] leading-snug text-zinc-500">
          Grátis para usar. Se preferir o vídeo pronto,{" "}
          <a
            href="comercial/precos.html"
            target="_blank"
            rel="noopener"
            className="font-semibold text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 transition-colors hover:text-emerald-200"
          >
            veja a tabela de preços
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

export default memo(Sidebar);
