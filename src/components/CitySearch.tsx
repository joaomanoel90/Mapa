import { useEffect, useRef, useState } from "react";
import { QUICK_CITIES, searchPlaces, type Place } from "../lib/geocode";
import { cn } from "../utils/cn";

export default function CitySearch({
  current,
  onPick,
}: {
  current: Place | null;
  onPick: (p: Place) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /* busca com debounce (política do Nominatim: ~1 req/s) */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q, ctrl.signal);
        setResults(found);
        setError(found.length === 0 ? "Nenhuma cidade encontrada." : null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Busca indisponível agora. Tente de novo.");
        }
      } finally {
        setLoading(false);
      }
    }, 650);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
      setLoading(false);
    };
  }, [query]);

  /* fecha ao clicar fora */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = (p: Place) => {
    onPick(p);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="space-y-2.5">
      <div ref={boxRef} className="relative">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
            🔍
          </span>
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            placeholder="Buscar cidade (ex: Fortaleza, Porto, Madrid…)"
            className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-9 text-[12.5px] text-white placeholder:text-zinc-500 focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
          {loading && (
            <span className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
          )}
          {!loading && query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {open && (results.length > 0 || error) && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-white/15 bg-zinc-900/98 shadow-2xl backdrop-blur-xl">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p)}
                className="flex w-full items-start gap-2 border-b border-white/5 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-violet-500/15"
              >
                <span className="mt-0.5 text-sm">📍</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-white">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-400">{p.label}</span>
                </span>
              </button>
            ))}
            {error && results.length === 0 && (
              <p className="px-3 py-2.5 text-[11.5px] text-zinc-400">{error}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
          Atalhos
        </p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CITIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c)}
              className={cn(
                "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                current?.id === c.id
                  ? "border-violet-400/60 bg-violet-500/20 text-white"
                  : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/25 hover:text-white",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {current && (
        <p className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">
          Mapa em <span className="font-semibold text-white">{current.label}</span>
        </p>
      )}
    </div>
  );
}
