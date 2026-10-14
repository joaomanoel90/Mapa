import { useRef, useState } from "react";
import {
  checkImageFile,
  downscaleImage,
  estimateBytes,
  formatBytes,
} from "../lib/photos";
import { cn } from "../utils/cn";

/**
 * Escolher (ou tirar) uma foto.
 *
 * A redução acontece **aqui**, antes de a foto entrar no estado do app: uma
 * foto de celular tem 4.000 px e 4 MB, e guardar isso significaria um
 * `localStorage` estourado e uma imagem gigante redesenhada a cada quadro do
 * vídeo. O que circula pelo app é uma versão de 640 px (ver `photos.ts`).
 *
 * Avisa também que a foto **não** vai no link compartilhado — melhor dizer isso
 * onde a foto é escolhida do que o usuário descobrir depois que o amigo abriu o
 * link e não viu foto nenhuma.
 */
export default function PhotoField({
  valor,
  onValor,
  compacto = false,
  rotulo = "Foto",
  ariaLabel = "Foto",
}: {
  valor: string;
  onValor: (v: string) => void;
  /** na lista de paradas o espaço é curto: só o botão com a miniatura */
  compacto?: boolean;
  rotulo?: string;
  ariaLabel?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const escolher = async (file: File | undefined) => {
    if (!file) return;
    const problema = checkImageFile(file);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      onValor(await downscaleImage(file));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível usar esta foto.");
    } finally {
      setOcupado(false);
      // permite escolher o mesmo arquivo de novo depois de remover
      if (input.current) input.current.value = "";
    }
  };

  const tamanho = valor ? formatBytes(estimateBytes(valor)) : null;

  return (
    <div className={compacto ? "flex items-center gap-1" : "space-y-1.5"}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={`${ariaLabel}: escolher arquivo`}
        onChange={(e) => void escolher(e.target.files?.[0])}
      />
      {compacto ? (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={ocupado}
            title={
              valor ? `Trocar a foto (${tamanho})` : "Adicionar foto desta parada"
            }
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border text-[11px] transition-colors",
              valor
                ? "border-violet-400/50 bg-violet-500/10"
                : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100",
              ocupado && "opacity-50",
            )}
          >
            {valor ? (
              <img src={valor} alt="" className="h-full w-full object-cover" />
            ) : (
              "📷"
            )}
          </button>
          {valor && (
            <button
              type="button"
              onClick={() => onValor("")}
              title="Remover a foto desta parada"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-[10px] text-zinc-500 transition-colors hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200"
            >
              ✕
            </button>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={ocupado}
              className={cn(
                "grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border text-lg transition-colors",
                valor
                  ? "border-violet-400/50 bg-violet-500/10"
                  : "border-dashed border-white/20 text-zinc-500 hover:border-white/35 hover:text-zinc-200",
                ocupado && "opacity-50",
              )}
              title={valor ? "Trocar a foto" : "Adicionar a foto do projeto"}
            >
              {valor ? <img src={valor} alt="" className="h-full w-full object-cover" /> : "📷"}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-zinc-300">{rotulo}</p>
              <p className="text-[10.5px] leading-snug text-zinc-500">
                {ocupado
                  ? "Preparando a foto…"
                  : valor
                    ? `${tamanho} · aparece no alto da cartela final`
                    : "Aparece no alto da cartela final"}
              </p>
              {valor && (
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="rounded-lg border border-white/10 px-2 py-0.5 text-[10.5px] text-zinc-300 transition-colors hover:border-white/25"
                  >
                    Trocar
                  </button>
                  <button
                    type="button"
                    onClick={() => onValor("")}
                    className="rounded-lg border border-white/10 px-2 py-0.5 text-[10.5px] text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-200"
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="text-[10px] leading-snug text-zinc-600">
            A foto é reduzida para 640 px e fica só neste navegador — ela não vai
            no link compartilhado.
          </p>
        </>
      )}
      {erro && <p className="text-[10.5px] leading-snug text-amber-300/90">{erro}</p>}
    </div>
  );
}
