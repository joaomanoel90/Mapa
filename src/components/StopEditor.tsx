import { useEffect, useMemo, useRef, useState } from "react";
import {
  POI_GROUPS,
  POI_KINDS,
  isOffRoute,
  poiLatLng,
  poiOffset,
  sortPois,
  type Poi,
} from "../lib/pois";
import { formatCoords, formatDistance, type Track } from "../lib/geo";
import { cn } from "../utils/cn";
import PhotoField from "./PhotoField";

const SWATCHES = [
  "#fde047",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#60a5fa",
  "#22d3ee",
  "#4ade80",
  "#f87171",
];

const STEPS = [1, 5, 25];

const normalizeSearch = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Props = {
  pois: Poi[];
  track: Track;
  progress: number;
  accent: string;
  selectedId: string | null;
  poiMode: boolean;
  onTogglePoiMode: () => void;
  onSelect: (id: string | null) => void;
  onAdd: (kindId: string) => void;
  onUpdate: (id: string, patch: Partial<Poi>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** desloca a parada em metros (ajuste fino) */
  onNudge: (id: string, east: number, north: number) => void;
  /** cola a parada de volta sobre a rota */
  onSnapToRoute: (id: string) => void;
  /** aproxima o mapa da parada */
  onZoomTo: (id: string) => void;
};

export default function StopEditor({
  pois,
  track,
  progress,
  accent,
  selectedId,
  poiMode,
  onTogglePoiMode,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
  onNudge,
  onSnapToRoute,
  onZoomTo,
}: Props) {
  const sorted = useMemo(() => sortPois(pois), [pois]);
  const [group, setGroup] = useState<(typeof POI_GROUPS)[number] | "Todos">("Natureza");
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(5);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const kinds = useMemo(() => {
    const q = normalizeSearch(query.trim());
    if (q) return POI_KINDS.filter((kind) =>
      normalizeSearch(`${kind.name} ${kind.group} ${kind.emoji}`).includes(q),
    );
    if (group === "Todos") return POI_KINDS;
    return POI_KINDS.filter((k) => k.group === group);
  }, [group, query]);

  const tFromClientX = (clientX: number) => {
    const el = ribbonRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const inner = r.width - 34;
    return Math.max(0.01, Math.min(0.99, (clientX - r.left - 17) / Math.max(1, inner)));
  };

  /* arrastar o selo na fita muda o momento em que a parada aparece */
  useEffect(() => {
    if (!dragId) return;
    const move = (e: PointerEvent) => onUpdate(dragId, { t: tFromClientX(e.clientX) });
    const up = () => setDragId(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragId, onUpdate]);

  const offCount = sorted.filter((p) => isOffRoute(p, track)).length;

  return (
    <div className="space-y-3">
      {/* ---------- modo de posicionamento ---------- */}
      <button
        type="button"
        onClick={onTogglePoiMode}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
          poiMode
            ? "border-amber-400/50 bg-amber-500/15 shadow-[0_0_24px_-8px_rgba(251,191,36,0.7)]"
            : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/5",
        )}
      >
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base transition-transform",
            poiMode ? "bg-amber-400 text-zinc-950 scale-105" : "bg-white/10",
          )}
        >
          🎯
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold text-white">
            {poiMode ? "Modo parada ativado" : "Marcar parada no mapa"}
          </span>
          <span className="block truncate text-[10.5px] leading-snug text-zinc-400">
            {poiMode
              ? "Clique em qualquer lugar — inclusive fora da rota"
              : "Clique livre: cachoeira no mato, mirante no morro…"}
          </span>
        </span>
        <span
          className={cn(
            "relative h-4 w-7 shrink-0 rounded-full transition-colors",
            poiMode ? "bg-amber-400" : "bg-zinc-700",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
              poiMode ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
      </button>

      {/* ---------- fita da rota ---------- */}
      <div>
        <div
          ref={ribbonRef}
          className="relative h-12 select-none rounded-xl border border-white/10 bg-gradient-to-b from-black/50 to-black/20"
          onPointerDown={() => onSelect(null)}
        >
          <div className="absolute left-[17px] right-[17px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.28)_0_5px,transparent_5px_11px)]" />
          <div
            className="absolute left-[17px] top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-100"
            style={{
              width: `calc((100% - 34px) * ${Math.max(0, Math.min(1, progress))})`,
              background: accent,
              boxShadow: `0 0 10px ${accent}`,
            }}
          />
          <span className="absolute left-[7px] top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border-2 border-emerald-400 bg-zinc-950 text-[9px] font-black text-emerald-300">
            A
          </span>
          <span className="absolute right-[7px] top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border-2 border-red-400 bg-zinc-950 text-[9px] font-black text-red-300">
            B
          </span>
          {sorted.map((p) => {
            const off = isOffRoute(p, track);
            return (
              <button
                key={p.id}
                type="button"
                title={`${p.label} — arraste para mudar quando aparece`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragId(p.id);
                  onSelect(p.id);
                }}
                className={cn(
                  "absolute top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full bg-zinc-950 text-[13px] shadow-lg transition-transform active:cursor-grabbing",
                  off ? "border-2 border-dashed" : "border-2",
                  selectedId === p.id ? "scale-125 z-10" : "hover:scale-110",
                )}
                style={{
                  left: `calc(17px + (100% - 34px) * ${p.t})`,
                  borderColor: p.color,
                  boxShadow:
                    selectedId === p.id
                      ? `0 0 0 3px ${p.color}33, 0 6px 16px rgba(0,0,0,.6)`
                      : `0 4px 12px rgba(0,0,0,.5)`,
                  opacity: p.t <= progress ? 1 : 0.62,
                }}
              >
                {p.emoji}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-500">
          Fita = <span className="text-zinc-300">quando</span> a parada aparece. Arraste os selos
          para mudar o momento
          {offCount > 0 && (
            <span className="text-amber-300/90">
              {" "}
              · {offCount} fora da rota (anel tracejado)
            </span>
          )}
        </p>
      </div>

      {/* ---------- catálogo ---------- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Ícones de pontos
          </span>
          <button
            type="button"
            onClick={() => {
              setGroup("Todos");
              setQuery("");
            }}
            className="rounded-lg px-2 py-1 text-[10.5px] font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
          >
            Ver todos os ícones ({POI_KINDS.length})
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar ícones de pontos por nome, categoria ou emoji"
          placeholder="Buscar ícones por nome, categoria ou emoji…"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-[12px] text-white placeholder:text-zinc-500 focus:border-violet-400/60 focus:outline-none"
        />
        {!query.trim() && (
          <div className="flex flex-wrap gap-1">
            {(["Todos", ...POI_GROUPS] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={group === g}
                className={cn(
                  "rounded-lg px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider transition-colors",
                  group === g
                    ? "bg-white/15 text-white"
                    : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        <p role="status" className="text-[10.5px] text-zinc-500">
          {kinds.length} ícone{kinds.length === 1 ? "" : "s"} disponível{kinds.length === 1 ? "" : "is"}
        </p>
        <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              draggable
              title={`${k.name} — arraste para o mapa para posicionar, ou clique para adicionar`}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-poi-kind", k.id);
                e.dataTransfer.setData("text/plain", k.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(k.id)}
              className="group flex cursor-grab items-center gap-1 rounded-xl border border-white/10 bg-black/25 px-1.5 py-1.5 text-left transition-all hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/5 active:scale-95 active:cursor-grabbing"
            >
              <span className="text-base leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,.6)]">
                {k.emoji}
              </span>
              <span className="truncate text-[10.5px] font-semibold text-zinc-300 group-hover:text-white">
                {k.name}
              </span>
            </button>
          ))}
          {kinds.length === 0 && (
            <p className="col-span-4 py-2 text-center text-[11px] text-zinc-500">
              Nenhum ícone encontrado. Tente outro nome ou categoria.
            </p>
          )}
        </div>
        <p className="text-[10.5px] leading-snug text-zinc-500">
          ✋ <span className="text-zinc-300">Arraste</span> um item para o lugar exato no mapa —
          ou clique para adicionar e ajustar depois.
        </p>
      </div>

      {/* ---------- cartões ---------- */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
              {sorted.length} parada{sorted.length > 1 ? "s" : ""} no percurso
            </p>
            <button
              type="button"
              onClick={onClear}
              className="text-[10.5px] font-semibold text-zinc-500 transition-colors hover:text-red-300"
            >
              remover todas
            </button>
          </div>

          {sorted.map((p, i) => {
            const km = (p.t * track.total) / 1000;
            const off = poiOffset(p, track);
            const latlng = poiLatLng(p, track);
            const isSel = selectedId === p.id;
            return (
              <div
                key={p.id}
                onPointerDown={() => onSelect(p.id)}
                className={cn(
                  "relative overflow-hidden rounded-xl border bg-black/25 p-2.5 pl-4 transition-all",
                  isSel
                    ? "border-white/25 bg-white/[0.06] shadow-lg"
                    : "border-white/10 hover:border-white/20",
                )}
              >
                <span
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: p.color, boxShadow: `0 0 12px ${p.color}` }}
                />

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-zinc-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={p.emoji}
                    maxLength={4}
                    onChange={(e) => onUpdate(p.id, { emoji: e.target.value })}
                    title="Emoji da parada"
                    className="w-9 shrink-0 rounded-lg border border-white/10 bg-black/40 py-1 text-center text-base leading-none focus:border-white/30 focus:outline-none"
                  />
                  <input
                    value={p.label}
                    maxLength={26}
                    onChange={(e) => onUpdate(p.id, { label: e.target.value })}
                    placeholder="Nome da parada"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] font-semibold text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onZoomTo(p.id)}
                    title="Aproximar o mapa desta parada"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-[11px] text-zinc-400 transition-colors hover:border-sky-400/40 hover:bg-sky-500/15 hover:text-sky-200"
                  >
                    🔍
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(p.id)}
                    title="Remover parada"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-xs text-zinc-500 transition-colors hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={99}
                    step={1}
                    value={Math.round(p.t * 100)}
                    onChange={(e) => onUpdate(p.id, { t: Number(e.target.value) / 100 })}
                    className="range-input flex-1"
                    style={{ ["--accent" as string]: p.color }}
                  />
                  <span className="w-[74px] shrink-0 text-right text-[10.5px] font-semibold tabular-nums text-zinc-400">
                    {track.total > 0 ? `${km.toFixed(km < 10 ? 2 : 1)} km` : `${Math.round(p.t * 100)}%`}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <PhotoField
                    compacto
                    valor={p.photo ?? ""}
                    onValor={(v) => onUpdate(p.id, { photo: v || undefined })}
                    ariaLabel={`Foto de ${p.label || "parada"}`}
                  />
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title="Cor da parada"
                      onClick={() => onUpdate(p.id, { color: c })}
                      className={cn(
                        "h-4 w-4 rounded-full border transition-transform hover:scale-125",
                        p.color === c ? "border-white" : "border-white/20",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                  <span
                    className={cn(
                      "ml-auto rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider",
                      off > 12
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                        : "border-white/10 bg-white/5 text-zinc-500",
                    )}
                  >
                    {off > 12 ? `${formatDistance(off)} da rota` : "na rota"}
                  </span>
                </div>

                {/* ---------- ajuste fino ---------- */}
                {isSel && (
                  <div className="mt-2.5 space-y-2 border-t border-white/10 pt-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="truncate font-mono text-[10px] text-zinc-500">
                        {formatCoords(latlng)}
                      </code>
                      <div className="flex shrink-0 gap-1">
                        {STEPS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStep(s)}
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors",
                              step === s
                                ? "bg-white/15 text-white"
                                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
                            )}
                          >
                            {s} m
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="grid grid-cols-3 gap-1">
                        <span />
                        <NudgeBtn label="▲" title={`Mover ${step} m para o norte`} onClick={() => onNudge(p.id, 0, step)} />
                        <span />
                        <NudgeBtn label="◀" title={`Mover ${step} m para o oeste`} onClick={() => onNudge(p.id, -step, 0)} />
                        <NudgeBtn
                          label="⊙"
                          title="Colar de volta na rota"
                          accent
                          onClick={() => onSnapToRoute(p.id)}
                        />
                        <NudgeBtn label="▶" title={`Mover ${step} m para o leste`} onClick={() => onNudge(p.id, step, 0)} />
                        <span />
                        <NudgeBtn label="▼" title={`Mover ${step} m para o sul`} onClick={() => onNudge(p.id, 0, -step)} />
                        <span />
                      </div>
                      <p className="flex-1 text-[10.5px] leading-snug text-zinc-500">
                        Ajuste fino de{" "}
                        <span className="font-bold text-zinc-300">{step} m</span> por toque — ou
                        use as <span className="font-bold text-zinc-300">setas do teclado</span>{" "}
                        (5 m · shift 25 m · alt 1 m). Arrastar o pino no mapa também vale: ele pode
                        ficar longe da rota, que uma linha de chamada liga os dois.
                      </p>
                    </div>

                    <p className="text-[10px] leading-snug text-zinc-600">
                      {p.t <= progress ? "✓ personagem já passou por aqui" : "aguardando o personagem passar"}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sorted.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-4 text-center">
          <p className="text-[12px] font-semibold text-zinc-300">Nenhuma parada ainda</p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            Ative o <span className="font-semibold text-amber-300">modo parada</span> acima e clique
            onde quiser no mapa, ou toque em 🌉 Ponte, 💦 Cachoeira, ⛪ Igreja.
          </p>
        </div>
      )}
    </div>
  );
}

function NudgeBtn({
  label,
  title,
  onClick,
  accent,
}: {
  label: string;
  title: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-lg border text-[11px] transition-all active:scale-90",
        accent
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border-white/12 bg-white/5 text-zinc-300 hover:border-white/30 hover:bg-white/10 hover:text-white",
      )}
    >
      {label}
    </button>
  );
}
