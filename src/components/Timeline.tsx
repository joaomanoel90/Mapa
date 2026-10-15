import { formatDistance, formatTime, type Track } from "../lib/geo";
import { isOffRoute, poiOffset, sortPois, type Poi } from "../lib/pois";
import { cn } from "../utils/cn";

export default function Timeline({
  progress,
  rota,
  playing,
  duration,
  track,
  emoji,
  accent,
  disabled,
  stops,
  onToggle,
  onSeek,
  onRestart,
}: {
  /** fração do **vídeo** (é a posição do cursor na barra) */
  progress: number;
  /**
   * Onde a personagem está **na rota** (0..1).
   *
   * Era diferente de `progress` enquanto havia a **freada** nos pontos (o
   * cursor andava no relógio do vídeo e a personagem, mais devagar, perto das
   * paradas). Sem a freada as duas são a mesma posição — a prop continua aqui
   * porque é a rota que a barra mostra: a distância percorrida, quais paradas já
   * ficaram para trás e a próxima parada.
   */
  rota?: number;
  playing: boolean;
  duration: number;
  track: Track;
  emoji: string;
  accent: string;
  disabled: boolean;
  stops: Poi[];
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRestart: () => void;
}) {
  // a rota e o vídeo são a mesma posição (a barra é o relógio do vídeo)
  const naRota = rota ?? progress;
  const traveled = track.total * naRota;
  const ordered = sortPois(stops);
  const next = ordered.find((p) => p.t > naRota);
  const passed = ordered.filter((p) => p.t <= naRota).length;
  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl transition-opacity",
        disabled && "opacity-40",
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-violet-500 to-indigo-600 text-lg text-white shadow-lg shadow-indigo-950/50 transition hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRestart}
          title="Reiniciar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-300 transition hover:text-white disabled:opacity-40"
        >
          ↺
        </button>
        <div className="min-w-0 flex-1">
          {/* paradas marcadas sobre a própria barra — clique pula direto para lá */}
          <div className="relative">
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(progress * 1000)}
              disabled={disabled}
              onChange={(e) => onSeek(Number(e.target.value) / 1000)}
              className="range-input w-full"
              style={{ ["--accent" as string]: accent }}
            />
            {ordered.map((p) => {
              const done = p.t <= naRota;
              const onde = p.t;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  title={`${p.label} · ${formatDistance(p.t * track.total)} — clique para ir até aqui`}
                  onClick={() => onSeek(onde)}
                  className={cn(
                    "absolute top-1/2 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-zinc-950 text-[10px] leading-none transition-all hover:scale-125",
                    done ? "scale-105" : "opacity-55 grayscale",
                  )}
                  style={{
                    left: `calc(8px + (100% - 16px) * ${onde})`,
                    borderColor: done ? p.color : "rgba(255,255,255,0.3)",
                    boxShadow: done ? `0 0 10px -2px ${p.color}` : "none",
                  }}
                >
                  {p.emoji}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium text-zinc-400">
            <span className="flex items-center gap-1.5 truncate">
              <span className="text-sm leading-none">{emoji}</span>
              {formatDistance(traveled)}
              <span className="text-zinc-600">/ {formatDistance(track.total)}</span>
            </span>
            <span className="tabular-nums">
              {formatTime(progress * duration)} / {formatTime(duration)}
            </span>
          </div>

          {ordered.length > 0 && (
            <div className="mt-1.5 flex items-center gap-2 border-t border-white/5 pt-1.5">
              <div className="flex shrink-0 items-center gap-1">
                {ordered.map((p) => {
                  const done = p.t <= naRota;
                  return (
                    <span
                      key={p.id}
                      title={`${p.label} · ${formatDistance(p.t * track.total)}`}
                      className={cn(
                        "grid h-5 w-5 place-items-center rounded-md border text-[11px] leading-none transition-all duration-300",
                        done ? "scale-100" : "scale-90 opacity-45 grayscale",
                        isOffRoute(p, track) && "border-dashed",
                      )}
                      style={{
                        borderColor: done ? p.color : "rgba(255,255,255,0.18)",
                        background: done ? `${p.color}22` : "transparent",
                        boxShadow: done ? `0 0 10px -2px ${p.color}` : "none",
                      }}
                    >
                      {p.emoji}
                    </span>
                  );
                })}
              </div>
              <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-400">
                {next ? (
                  <>
                    Próxima parada:{" "}
                    <span className="font-semibold text-white">{next.label}</span>
                    <span className="text-zinc-500">
                      {" "}
                      · a {formatDistance((next.t - naRota) * track.total)}
                      {isOffRoute(next, track) && (
                        <span className="text-amber-300/80">
                          {" "}
                          · ⤷ {formatDistance(poiOffset(next, track))} da rota
                        </span>
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-emerald-300">
                      {passed}/{ordered.length} paradas
                    </span>{" "}
                    visitadas
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
