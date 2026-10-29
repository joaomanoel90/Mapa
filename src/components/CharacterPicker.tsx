import { useMemo, useState } from "react";
import { ACCENTS, CHARACTERS, iconeDe, type Character } from "../lib/characters";
import { svgDoIcone } from "../lib/icones";
import { cn } from "../utils/cn";

export function CharacterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: Character) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARACTERS.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.emoji.includes(q) ||
        // colar o emoji do acessório (🎒, ✝️) também acha o personagem
        (c.acessorio ?? "").includes(q),
    ).reduce<Record<string, Character[]>>((acc, c) => {
      (acc[c.group] ??= []).push(c);
      return acc;
    }, {});
  }, [query]);

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar personagem…"
        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-zinc-500 focus:border-violet-400/60 focus:outline-none"
      />
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1 nice-scroll">
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
              {group}
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.name}
                  onClick={() => onChange(c)}
                  className={cn(
                    "group relative grid aspect-square place-items-center rounded-xl border text-xl transition-all",
                    value === c.id
                      ? "border-violet-400/70 bg-violet-500/20 shadow-[0_0_0_1px_rgba(167,139,250,0.4),0_6px_18px_-6px_rgba(124,58,237,0.8)]"
                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/5",
                  )}
                >
                  {/*
                    Personagem **animado**: a miniatura é o próprio SVG, mexendo —
                    é a diferença que ele veio oferecer, e uma bolinha parada não a
                    mostraria. Só os nove desenhados animam aqui; o resto é emoji.
                  */}
                  {iconeDe(c) ? (
                    <span
                      className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                      // o SVG vem do próprio código (nomes fixos), nunca do usuário
                      dangerouslySetInnerHTML={{
                        __html: svgDoIcone(iconeDe(c)!, {
                          accent: ACCENTS[0].value,
                          lado: 34,
                          hz: iconeDe(c)!.gaitHz,
                        }),
                      }}
                    />
                  ) : (
                    <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{c.emoji}</span>
                  )}
                  {/*
                    O acessório dos compostos (a mochila do peregrino, a cruz do
                    padre) aparece aqui como aparece no vídeo: pequeno, no canto,
                    com um disco escuro atrás. Sem isso os dois "🤵" da lista
                    ficariam idênticos no painel.
                  */}
                  {c.acessorio && (
                    <span
                      className="absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-950/95 text-[8px] ring-1 ring-white/30"
                      aria-hidden
                    >
                      {c.acessorio}
                    </span>
                  )}
                  {value === c.id && (
                    <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-violet-500 text-[9px] font-black text-white">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(groups).length === 0 && (
          <p className="py-4 text-center text-xs text-zinc-500">Nenhum personagem encontrado.</p>
        )}
      </div>
    </div>
  );
}

export function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          title={a.name}
          onClick={() => onChange(a.value)}
          className={cn(
            "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
            value === a.value ? "border-white" : "border-white/20",
          )}
          style={{ background: a.value, boxShadow: `0 4px 14px -4px ${a.value}` }}
        />
      ))}
    </div>
  );
}
