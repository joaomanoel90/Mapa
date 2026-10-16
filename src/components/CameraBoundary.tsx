import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { ErroAviso, detalhesDoErro } from "./ErrorBoundary";

/**
 * Quantas vezes a fronteira do mapa tenta retomar sozinha antes de pedir a mão
 * do usuário.
 *
 * Existe porque o Leaflet e o React não são a mesma coisa: o mapa recebe um
 * `setView`/`setLatLng` por quadro e um quadro ruim (um ponto que chegou sem
 * coordenada no meio da animação) derruba o app **inteiro** — foi assim que o
 * usuário viu *"Algo travou no app — Cannot read properties of undefined
 * (reading 'lat')"* no meio da prévia e no fim da gravação. Um quadro ruim não
 * pode custar o app; um mapa quebrado de verdade (todo quadro falha) tem de
 * avisar em vez de ficar piscando entre o aviso e o mapa.
 */
export const RETOMADAS = 3;

type Props = {
  children: ReactNode;
  /**
   * O instante que está sendo desenhado (0..1). Quando ele **anda**, a
   * fronteira sabe que o mapa tentou de novo — é esse o sinal para retomar.
   * Parado (em pausa), ela não insiste: quem decide é o usuário.
   */
  agora?: number;
  /** chamado antes de remontar o mapa */
  onReiniciar?: () => void;
  /** aviso ao app (diagnóstico) — o aviso na tela já acontece sem isso */
  onFalha?: (erro: Error) => void;
};

type State = {
  erro: Error | null;
  /** rastro + componentes, fixado no instante do erro (para copiar) */
  texto: string;
  /** quantas retomadas automáticas já foram tentadas */
  retomadas: number;
  /** troca a chave do pedaço que quebrou: força um mapa novo, do zero */
  chave: number;
};

/**
 * Fronteira de erro **do mapa**.
 *
 * Só o mapa cai; a barra do tempo, o painel e o botão de gravar continuam de
 * pé, e o aviso diz em que ponto da animação o mapa travou — com o rastro à mão
 * para copiar. "Tentar de novo" remonta o mapa sem recarregar a página.
 */
export default class CameraBoundary extends Component<Props, State> {
  state: State = { erro: null, texto: "", retomadas: 0, chave: 0 };

  static getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    const agora = this.props.agora;
    const onde = (info.componentStack ?? "").trim();
    this.setState({
      texto: detalhesDoErro(
        erro,
        agora === undefined
          ? onde
          : `No ponto ${(agora * 100).toFixed(1)}% do percurso\n\n${onde}`,
      ),
    });
    this.props.onFalha?.(erro);
    console.error("RotaCast (mapa):", erro, info.componentStack);
  }

  /**
   * Retomada automática: o erro ficou **um** quadro na tela e o próximo quadro
   * andou — pode ter sido um quadro ruim só. Depois de `RETOMADAS` tentativas o
   * aviso fica de pé (falha persistente) até o usuário pedir de novo.
   */
  componentDidUpdate(prev: Props, antes: State) {
    if (!this.state.erro || !antes.erro) return;
    if (prev.agora === this.props.agora) return;
    if (this.state.retomadas >= RETOMADAS) return;
    this.setState((s) => ({
      erro: null,
      texto: "",
      retomadas: s.retomadas + 1,
      chave: s.chave + 1,
    }));
  }

  private tentarDeNovo = () => {
    this.props.onReiniciar?.();
    this.setState((s) => ({ erro: null, texto: "", retomadas: 0, chave: s.chave + 1 }));
  };

  render() {
    const { erro, texto, chave } = this.state;
    if (!erro) {
      return <Fragment key={chave}>{this.props.children}</Fragment>;
    }
    return (
      <ErroAviso
        compacto
        titulo="O mapa travou"
        mensagem={erro.message || "Erro inesperado."}
        texto={texto}
        onTentar={this.tentarDeNovo}
      />
    );
  }
}
