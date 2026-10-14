import { useState } from "react";
import {
  ENDPOINT_PRESETS,
  hasMark,
  patchMark,
  type EndpointMark,
  type Endpoints,
} from "../lib/endpoints";
import { cn } from "../utils/cn";
import PhotoField from "./PhotoField";

export default function EndpointEditor({
  endpoints,
  onChange,
}: {
  endpoints: Endpoints;
  onChange: (next: Endpoints) => void;
}) {
  const [open, setOpen] = useState<"a" | "b" | null>(null);

  const set = (which: "a" | "b", mark: EndpointMark | null) =>
    onChange({ ...endpoints, [which]: mark });

  /** mexe em um campo só, preservando os outros (a foto, principalmente) */
  const patch = (which: "a" | "b", mudanca: Partial<EndpointMark>) =>
    set(which, patchMark(endpoints[which], mudanca));

  const row = (which: "a" | "b") => {
    const mark = endpoints[which];
    const marked = hasMark(mark);
    const color = which === "a" ? "#22c55e" : "#f87171";
    const title = which === "a" ? "Partida (A)" : "Chegada (B)";
    const isOpen = open === which;

    return (
      <div
        className={cn(
          "rounded-xl border bg-black/25 transition-colors",
          isOpen ? "border-white/25" : "border-white/10",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(isOpen ? null : which)}
          className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        >
          <span
            className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-zinc-950 text-[12px] font-black"
            style={{ borderColor: color }}
          >
            {mark?.photo ? (
              <img src={mark.photo} alt="" className="h-full w-full object-cover" />
            ) : marked && mark!.emoji.trim() ? (
              <span className="text-[13px]">{mark!.emoji.trim()}</span>
            ) : (
              <span style={{ color }}>{which.toUpperCase()}</span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-white">{title}</span>
            <span className="block truncate text-[10.5px] text-zinc-500">
              {marked
                ? mark!.label.trim() || "local marcado (sem nome)"
                : "padrão — toque para marcar um local"}
            </span>
          </span>
          {marked && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                set(which, null);
              }}
              title="Voltar ao padrão A/B"
              className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 text-[10px] text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-300"
            >
              ✕
            </span>
          )}
          <span className={cn("text-[10px] text-zinc-600 transition-transform", isOpen && "rotate-180")}>
            ▼
          </span>
        </button>

        {isOpen && (
          <div className="space-y-2 border-t border-white/10 px-2.5 py-2.5">
            <div className="flex gap-2">
              <input
                value={mark?.emoji ?? ""}
                maxLength={4}
                placeholder={which === "a" ? "A" : "B"}
                onChange={(e) => patch(which, { emoji: e.target.value })}
                title="Emoji do local"
                className="w-11 shrink-0 rounded-lg border border-white/10 bg-black/40 py-1.5 text-center text-base leading-none focus:border-white/30 focus:outline-none"
              />
              <input
                value={mark?.label ?? ""}
                maxLength={24}
                placeholder={which === "a" ? "Nome da partida (ex: Casa)" : "Nome da chegada (ex: Cachoeira)"}
                onChange={(e) => patch(which, { label: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] font-semibold text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-2">
              <PhotoField
                compacto
                valor={mark?.photo ?? ""}
                onValor={(v) => patch(which, { photo: v || undefined })}
                ariaLabel={`Foto de ${which === "a" ? "partida" : "chegada"}`}
              />
              <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-zinc-500">
                {mark?.photo
                  ? "Na largada, o pino e o vídeo mostram esta foto."
                  : "Foto do local (opcional): aparece no vídeo e no pino."}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {ENDPOINT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => patch(which, { emoji: p.emoji, label: p.label })}
                  className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-[10.5px] font-medium text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
                >
                  {p.emoji} {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        Partida e chegada
      </p>
      <div className="space-y-1.5">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
