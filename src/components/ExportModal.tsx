import type { RefObject } from "react";
import { Button } from "./ui";
import { humanSize, type Cadencia, type VideoEngine } from "../lib/recorder";

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
  fps,
  fpsPedido,
  taxaDaTela,
  blocosDeReserva,
  blocosFaltando,
  cadencia,
  avisoMotor,
  rapidoDesligado,
  onLigarRapido,
  fpsLimitadoPeloTeto,
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
  /** fps que o arquivo recebeu */
  fps?: number;
  /** fps que estava escolhido no painel (na gravação em tempo real pode mudar) */
  fpsPedido?: number;
  /** taxa da tela medida, em Hz (0 = não deu para medir) */
  taxaDaTela?: number;
  /**
   * Quantos blocos do mapa não estavam prontos quando o quadro precisou deles.
   * Eles saíram do nível anterior, esticados — e **ficaram** nele até o fim do
   * vídeo (trocar de imagem no meio de um quadro por outro é o "pulo").
   */
  blocosDeReserva?: number;
  /**
   * Quão regular foi a cadência da gravação em tempo real.
   *
   * O número que separa o vídeo que flui do que trava: nos mp4 do usuário, o
   * que ele achou fluido tinha **93%** dos quadros no mesmo intervalo; o que
   * travava, 78% (e o mais antigo, 46%). O passo do mapa por quadro era o mesmo
   * nos três — o que muda é a **regularidade**, não o tamanho do passo.
   */
  cadencia?: Cadencia | null;
  /**
   * Quantos blocos **já faltavam antes de gravar**, mesmo depois das tentativas.
   *
   * É o número que o app não mostrava: os blocos que não chegaram saem do nível
   * anterior (esticados) no vídeo inteiro, e antes isso só aparecia no fim, com
   * o arquivo pronto. Vindo daqui, o aviso já diz o tamanho do estrago enquanto
   * o vídeo está sendo gravado.
   */
  blocosFaltando?: number;
  /**
   * Por que o ⚡ não vai rodar nesta gravação (null/ausente = vai).
   *
   * Sem isto, quem ligou o ⚡ e recebeu um arquivo de tempo real não tinha como
   * saber que o navegador tinha recusado o codificador.
   */
  avisoMotor?: string | null;
  /**
   * O ⚡ não rodou porque o **interruptor** do painel estava desligado (e não
   * porque o navegador recusou). Muda a conclusão: existe solução a um clique.
   */
  rapidoDesligado?: boolean;
  /** liga o ⚡ e começa outra gravação — o botão do painel do fim */
  onLigarRapido?: () => void;
  /**
   * O fps final menor que o pedido foi por causa do **teto do tempo real**, e
   * não do divisor da tela.
   *
   * A mensagem antiga dizia "a tela entrega 60 e não fecha com 60", que é falso:
   * 30 divide 60. Confundir os dois motivos fazia o usuário duvidar do número.
   */
  fpsLimitadoPeloTeto?: boolean;
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
  /** o fps como se fala: 19,98 é 20; 22,5 continua 22,5 */
  const numero = (v: number) => {
    const redondo = Math.round(v * 10) / 10;
    return (Number.isInteger(redondo) ? String(redondo) : redondo.toFixed(1).replace(".", ",")) as string;
  };

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
                  : "Gravação em tempo real: quem carimba o tempo é a tela."}
                {engine === "realtime" && fps != null && fpsPedido != null && (
                  <>
                    {fps !== fpsPedido && fpsLimitadoPeloTeto && (
                      <>
                        {" "}
                        Pedido {numero(fpsPedido)}, gravado em {numero(fps)}: em tempo real o
                        desenho tem de caber no intervalo de um quadro, e a {numero(fpsPedido)} são
                        só {numero(Math.round((1000 / fpsPedido) * 10) / 10)} ms por quadro. O app
                        escolheu {numero(fps)} porque coube — e medir o desenho desta máquina é o
                        que decidiu. Para {numero(fpsPedido)}, use a exportação rápida (⚡): ela não
                        espera o relógio.
                      </>
                    )}
                    {fps !== fpsPedido && !fpsLimitadoPeloTeto && (
                      <>
                        {" "}
                        A tela
                        {taxaDaTela ? ` entrega ${Math.round(taxaDaTela)} quadros por segundo e` : ""}{" "}
                        não divide {numero(fpsPedido)}: gravado em {numero(fps)} quadros por
                        segundo, que sai com o tempo regular (o pedido de {numero(fpsPedido)}{" "}
                        sairia com durações alternadas — é isso que faz o mapa parecer pular).
                      </>
                    )}
                    {fps === fpsPedido && (
                      <>
                        {" "}
                        Gravado em {numero(fps)} quadros por segundo, que fecha com a tela
                        {taxaDaTela ? ` (${Math.round(taxaDaTela)} Hz)` : ""} — o tempo sai
                        regular.
                      </>
                    )}
                  </>
                )}
                {engine === "realtime" && (
                  <>
                    {" "}
                    A exportação rápida (⚡) escreve cada quadro no tempo exato, sem depender
                    da tela.
                  </>
                )}
              </p>
            )}
            {phase === "done" && cadencia && cadencia.intervalos.length > 0 && (
              <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">
                Cadência: {Math.round(cadencia.regular * 100)}% dos quadros no mesmo intervalo
                ({numero(cadencia.tipico)} ms)
                {cadencia.atraso > 0.5 && (
                  <> — quando um quadro sai do tempo, sai {numero(cadencia.atraso)} ms</>
                )}
                .
              </p>
            )}
            {phase === "done" &&
              engine === "realtime" &&
              cadencia &&
              cadencia.intervalos.length > 0 &&
              cadencia.regular < 0.9 && (
                <p className="mt-1 text-[11.5px] leading-snug text-amber-300/80">
                  A tela não sustentou o ritmo: {Math.round((1 - cadencia.regular) * 100)}% dos
                  quadros vieram fora do tempo, e é isso que o olho lê como travada — mesmo com a
                  velocidade média certa. Use a <strong className="font-semibold">exportação
                  rápida (⚡)</strong>: ela desenha e escreve cada quadro no tempo exato, sem
                  depender da tela.
                </p>
              )}
            {(avisoMotor || rapidoDesligado) && phase !== "error" && (
              <p className="mt-1 text-[11.5px] leading-snug text-amber-300/80">
                {rapidoDesligado ? (
                  <>
                    ⚡ <strong className="font-semibold">desligado no painel.</strong>{" "}
                    {avisoMotor
                      ? `Neste navegador ele também não rodaria: ${avisoMotor}.`
                      : "Este navegador suporta a exportação rápida."}{" "}
                    {phase === "done" && !avisoMotor && (
                      <>
                        Este arquivo saiu em tempo real só por causa do interruptor: ligado, cada
                        quadro sai no tempo exato
                        {fpsPedido ? `, a ${numero(fpsPedido)} quadros por segundo` : ""}, sem
                        depender da tela.
                      </>
                    )}
                    {phase !== "done" && !avisoMotor && (
                      <>Ligue-o para gravar com o tempo exato — o tempo real fica preso à tela.</>
                    )}
                  </>
                ) : (
                  <>
                    ⚡ indisponível: {avisoMotor}.{" "}
                    {phase === "done"
                      ? "Por isso este arquivo saiu da gravação em tempo real."
                      : "Esta gravação sai em tempo real, no máximo a 30 quadros por segundo."}
                  </>
                )}
              </p>
            )}
            {(blocosFaltando ?? 0) > 0 && phase !== "error" && (
              <p className="mt-1 text-[11.5px] leading-snug text-amber-300/80">
                {blocosFaltando} {blocosFaltando === 1 ? "bloco" : "blocos"} do mapa não
                {blocosFaltando === 1 ? "chegou" : "chegaram"} nem depois das novas tentativas:
                esse pedaço sai do nível anterior
                (esticado) no vídeo. Costuma ser limite dos servidores gratuitos — tente de novo em
                alguns minutos.
              </p>
            )}
            {phase === "done" && (blocosDeReserva ?? 0) > 0 && (
              <p className="mt-1 text-[11.5px] leading-snug text-amber-300/80">
                {blocosDeReserva} {blocosDeReserva === 1 ? "bloco" : "blocos"} do mapa não
                {blocosDeReserva === 1 ? " estava" : " estavam"} pronto
                {blocosDeReserva === 1 ? "" : "s"} na hora: o pedaço saiu do nível anterior,
                esticado, e ficou assim até o fim do vídeo — trocar de imagem no meio faria o
                mapa pular. Num próximo vídeo, deixe a prévia rodar uma vez antes de gravar:
                ele baixa esses blocos.
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
            {phase === "done" && rapidoDesligado && !avisoMotor && onLigarRapido && (
              <Button variant="primary" onClick={onLigarRapido} className="px-4 py-2.5">
                ⚡ Ligar e gravar de novo
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
