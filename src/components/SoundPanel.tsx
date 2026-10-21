import { useRef, useState } from "react";
import { Slider, Toggle } from "./ui";
import type { Settings } from "../lib/settings";

/**
 * Som do vídeo: os pops e a música de fundo.
 *
 * As duas camadas têm origens diferentes, e a tela diz isso:
 *
 * - os **pops** são sintetizados no app (nenhum sample, nenhuma licença) e
 *   marcam a largada, cada parada passada e a chegada — os mesmos momentos que
 *   o vídeo destaca na imagem;
 * - a **música** é o arquivo do usuário. O app não distribui faixa nenhuma, e
 *   avisa que a escolha vale só para esta sessão: o arquivo tem megabytes e o
 *   `localStorage` não guarda isso.
 */
export default function SoundPanel({
  settings: s,
  update,
  musica,
  onMusica,
  aviso,
  carregando,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  musica: { nome: string; duracao: number } | null;
  onMusica: (file: File | null) => void;
  aviso: string | null;
  carregando: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const escolher = (file: File | undefined) => {
    if (!file) return;
    setErro(null);
    onMusica(file);
    // permite escolher o mesmo arquivo de novo depois de remover
    if (input.current) input.current.value = "";
  };

  const relogio = (segundos: number) => {
    const total = Math.max(0, Math.round(segundos));
    const m = Math.floor(total / 60);
    const seg = String(total % 60).padStart(2, "0");
    return `${m}:${seg}`;
  };

  const resumo = musica ? "música + pops" : s.som ? "pops" : "mudo";

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-2.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-zinc-400">🔊 Som no vídeo</span>
        <span className="text-[11px] text-zinc-500">{resumo}</span>
      </div>

      <div className="mt-2 space-y-2">
        <Toggle
          icon="🥁"
          label="Pops na largada, nas paradas e na chegada"
          checked={s.som}
          onChange={(v) => update("som", v)}
        />

        <input
          ref={input}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-label="Música de fundo: escolher arquivo"
          onChange={(e) => escolher(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={carregando}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/20 px-2.5 py-2 text-left text-[12px] text-zinc-400 transition-colors hover:border-white/35 hover:text-zinc-100 disabled:opacity-50"
        >
          <span className="text-sm leading-none">🎵</span>
          <span className="flex-1">
            {carregando
              ? "Abrindo a música…"
              : musica
                ? "Trocar a música"
                : "Escolher música de fundo"}
          </span>
        </button>

        {musica && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{musica.nome}</p>
              <button
                type="button"
                onClick={() => onMusica(null)}
                title="Remover a música"
                className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200"
              >
                ✕
              </button>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              {relogio(musica.duracao)} — {musica.duracao < s.duration ? "repete até o fim" : "corta no fim"}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-[54px] shrink-0 text-[10px] text-zinc-500">Volume</span>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={s.musicaVolume}
                onChange={(v) => update("musicaVolume", v)}
              />
              <span className="w-[34px] shrink-0 text-right text-[10px] text-zinc-500">
                {Math.round(s.musicaVolume * 100)}%
              </span>
            </div>
          </div>
        )}

        {(aviso || erro) && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-[10.5px] leading-snug text-amber-200">
            {aviso ?? erro}
          </p>
        )}

        <p className="text-[10px] leading-snug text-zinc-600">
          Os pops são gerados pelo app, sem sample nenhum. A música é o seu arquivo — use uma
          faixa que você tenha direito de publicar. Ela não fica salva: ao recarregar a página,
          escolha de novo.
        </p>
      </div>
    </div>
  );
}
