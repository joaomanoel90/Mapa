import { Component, useState, type ErrorInfo, type ReactNode } from "react";

/**
 * O texto que o usuário pode copiar e mandar de volta.
 *
 * O "Algo travou no app" sem detalhe não diz nada: quando o usuário viu
 * *"Cannot read properties of undefined (reading 'lat')"* não deu para saber
 * **onde** — o rastro do erro e o caminho dos componentes é o que aponta a
 * linha. Puro (e testado) para o texto não depender do React.
 */
export function detalhesDoErro(error: Error | null, componente?: string): string {
  if (!error) return "";
  const partes = [
    `RotaCast — ${new Date().toISOString()}`,
    `Mensagem: ${error.message || "(sem mensagem)"}`,
    error.stack ? `Rastro:\n${error.stack}` : "",
    componente ? `Componentes:\n${componente}` : "",
    typeof navigator !== "undefined" ? `Navegador: ${navigator.userAgent}` : "",
  ];
  return partes.filter(Boolean).join("\n\n");
}

/** Copia para a área de transferência; devolve `false` quando não deu. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    /* nem toda origem tem clipboard (http sem TLS, iframe): plano B abaixo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export type AvisoProps = {
  /** o que quebrou, em duas ou três palavras ("Algo travou no app") */
  titulo: string;
  /** a mensagem crua do erro — é ela que diz o que o navegador reclamou */
  mensagem: string;
  /** o texto completo (rastro + componentes) que fica à mão para copiar */
  texto: string;
  /**
   * Caixa compacta, para um pedaço da tela (o mapa, o painel): o resto do app
   * continua de pé, e o aviso conta **o que** quebrou em vez de sumir com tudo.
   */
  compacto?: boolean;
  /** refaz só o pedaço que quebrou (o mapa), sem recarregar a página */
  onTentar?: () => void;
  /** recarrega a página inteira — some com tudo, inclusive o que não quebrou */
  onRecarregar?: () => void;
};

/**
 * O aviso de erro, sem saber de onde ele veio.
 *
 * Separado do `ErrorBoundary` porque agora são **dois** lugares que avisam: o
 * app inteiro (tela cheia) e o mapa (`CameraBoundary`, caixa compacta). O texto
 * é o mesmo — e é ele que o usuário copia.
 */
export function ErroAviso({
  titulo,
  mensagem,
  texto,
  compacto,
  onTentar,
  onRecarregar,
}: AvisoProps) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div
      className={
        compacto
          ? "absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-sm"
          : "flex h-dvh items-center justify-center bg-zinc-950 p-6 text-white"
      }
    >
      <div
        className={
          "max-h-full w-full overflow-auto rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-left " +
          (compacto ? "max-w-md" : "max-w-lg p-5 text-center")
        }
      >
        <div className={compacto ? "mb-1.5 text-xl" : "mb-2 text-3xl"}>🧭</div>
        <h1 className={"font-semibold text-white " + (compacto ? "text-sm" : "text-base")}>
          {titulo}
        </h1>
        <p className="mt-1.5 text-[12.5px] leading-snug text-red-100/80">
          {mensagem || "Erro inesperado."}
        </p>
        <p className="mt-2 text-[11px] leading-snug text-red-100/60">
          {compacto
            ? "O resto do app continua funcionando. Toque em copiar e mande o texto para o desenvolvedor."
            : "O texto abaixo diz exatamente onde quebrou. Copie e mande para o desenvolvedor."}
        </p>
        <textarea
          readOnly
          value={texto}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 h-28 w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-snug text-red-100/80"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void copiarTexto(texto).then((ok) => setCopiado(ok));
            }}
            className="rounded-xl bg-gradient-to-b from-violet-500 to-indigo-600 px-3.5 py-2 text-xs font-semibold text-white"
          >
            {copiado ? "Copiado ✓" : "Copiar detalhes"}
          </button>
          {onTentar && (
            <button
              type="button"
              onClick={onTentar}
              className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:text-white"
            >
              Tentar de novo
            </button>
          )}
          {!compacto && onRecarregar && (
            <button
              type="button"
              onClick={onRecarregar}
              className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:text-white"
            >
              Recarregar o mapa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type State = { error: Error | null; texto: string };

/**
 * Evita a "tela branca": se algo quebrar, o app continua utilizável e o erro
 * aparece como um aviso — com o rastro à mão para copiar.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, texto: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // o texto é fixado **na hora do erro**: o timestamp não pode mudar a cada
    // render (senão a caixa de copiar se reescreve sozinha a cada quadro)
    this.setState({ texto: detalhesDoErro(error, (info.componentStack ?? "").trim()) });
    console.error("RotaCast:", error, info.componentStack);
  }

  render() {
    const { error, texto } = this.state;
    if (!error) return this.props.children;
    return (
      <ErroAviso
        titulo="Algo travou no app"
        mensagem={error.message || "Erro inesperado."}
        texto={texto}
        onTentar={() => this.setState({ error: null, texto: "" })}
        onRecarregar={() => window.location.reload()}
      />
    );
  }
}
