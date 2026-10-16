import type { RefObject } from "react";
import { Button } from "./ui";
import { humanSize, type VideoEngine } from "../lib/recorder";

export type ExportPhase = "warmup" | "recording" | "done" | "error";

export default function ExportModal({
  phase,
  progress,
  message,
  canvasRef,
  videoUrl,
  blobSize,
  ext,
  engine,
  width,
  height,
  duration,
  onCancel,
  onClose,
  onDownload,
  onRetry,
}: {
  phase: ExportPhase;
  progress: number;
  message?: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoUrl?: string;
  blobSize?: number;
  ext: string;
  /** como o arquivo foi gravado — a diferença aparece no texto do fim */
  engine?: VideoEngine;
  width: number;
  height: number;
  duration: number;
  onCancel: () => void;
  onClose: () => void;
  onDownload: () => void;
  onRetry: () => void;
}) {
  const pct = Math.round(progress * 100);
  const isWorking = phase === "warmup" || phase === "recording";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/95 shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {phase === "warmup" && "Carregando mapas…"}
              {phase === "recording" && "Gravando animação…"}
              {phase === "done" && "Vídeo pronto! 🎉"}
              {phase === "error" && "Não foi possível gravar"}
            </h2>
            <p className="mt-0.5 text-[12px] text-zinc-400">
              {phase === "warmup" && "Buscando os tiles do mapa para o vídeo."}
              {phase === "recording" &&
                `${duration}s · ${width}×${height} · mantenha esta aba visível`}
              {phase === "done" &&
                blobSize != null &&
                `${width}×${height} · ${duration}s · ${humanSize(blobSize)} · .${ext}`}
              {phase === "error" && (message ?? "Tente novamente ou troque o formato do arquivo.")}
            </p>
            {/*
              Como o arquivo foi gravado. A diferença importa: a exportação
              rápida escreve o tempo exato de cada quadro; a gravação em tempo
              real fica presa ao ritmo da tela — e num monitor de 60 Hz o vídeo
              de 24 quadros por segundo sai com o tempo irregular (33 ms e 50 ms
              alternados). É esta linha que diz qual dos dois rodou.
            */}
            {phase === "done" && engine && (
              <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">
                {engine === "fast"
                  ? "Exportação rápida (WebCodecs): cada quadro no tempo exato."
                  : "Gravação em tempo real: a tela entrega os quadros no ritmo dela. Num monitor de 60 Hz, 30 ou 60 quadros por segundo saem com o tempo regular — com 24 pode ficar um leve engasgo. A exportação rápida, quando o navegador tem WebCodecs para o formato, sai perfeita."}
              </p>
            )}
          </div>
          {!isWorking && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-zinc-400 transition hover:text-white"
            >
              ✕
            </button>
          )}
        </header>

        <div className="bg-black">
          {phase === "done" && videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="mx-auto max-h-[54vh] w-full object-contain"
            />
          ) : (
            <div className="relative mx-auto flex max-h-[54vh] items-center justify-center">
              <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="max-h-[54vh] w-full object-contain"
              />
              {phase === "warmup" && (
                <div className="absolute inset-0 grid place-items-center bg-black/40 text-center">
                  <div>
                    <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
                    <p className="text-xs font-semibold text-white">{pct}%</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isWorking && (
          <div className="h-1.5 w-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-[11.5px] text-zinc-500">
            {phase === "recording"
              ? "A gravação acontece em tempo real — não troque de aba."
              : phase === "warmup"
                ? "Pré-carregando o mapa para evitar quadros em branco."
                : "O arquivo é gerado localmente, nada é enviado para servidores."}
          </p>
          <div className="flex gap-2">
            {isWorking && (
              <Button variant="danger" onClick={onCancel}>
                Cancelar
              </Button>
            )}
            {phase === "done" && (
              <>
                <Button variant="ghost" onClick={onRetry}>
                  ↺ Gravar de novo
                </Button>
                <Button variant="primary" onClick={onDownload} className="px-5 py-2.5">
                  ⬇︎ Baixar .{ext}
                </Button>
              </>
            )}
            {phase === "error" && (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Fechar
                </Button>
                <Button variant="primary" onClick={onRetry}>
                  Tentar de novo
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
