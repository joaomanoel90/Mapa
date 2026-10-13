import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Evita a "tela branca": se algo quebrar, o mapa e os controles continuam
 * utilizáveis e o erro aparece como um aviso.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RotaCast:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-dvh items-center justify-center bg-zinc-950 p-6 text-white">
        <div className="max-w-md rounded-2xl border border-red-400/25 bg-red-500/10 p-5 text-center">
          <div className="mb-2 text-3xl">🧭</div>
          <h1 className="text-base font-semibold">Algo travou no app</h1>
          <p className="mt-1.5 text-[12.5px] leading-snug text-red-100/80">
            {this.state.error.message || "Erro inesperado."}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="mt-4 rounded-xl bg-gradient-to-b from-violet-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Recarregar o mapa
          </button>
        </div>
      </div>
    );
  }
}
