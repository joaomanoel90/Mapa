import { TextInput } from "./ui";
import PhotoField from "./PhotoField";
import {
  cardSuggestions,
  type CardFields,
  type EndCard,
  type RideSummary,
} from "../lib/stats";
import type { Settings } from "../lib/settings";

type Update = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

/**
 * Uma linha da cartela: rótulo, campo e a dica do que o arquivo mediu.
 *
 * **Este componente fica no nível do módulo de propósito.** Quando ele era
 * declarado dentro do componente do painel, cada render criava uma função
 * nova — e, para o React, um componente de tipo diferente —, então a caixa de
 * texto era desmontada e montada de novo a cada tecla: o texto entrava e o
 * foco ia embora. Componente definido dentro de outro componente nunca deve
 * ser usado como elemento.
 */
function Campo({
  ariaLabel,
  rotulo,
  valor,
  onValor,
  dica,
  placeholder,
}: {
  ariaLabel: string;
  rotulo: string;
  valor: string;
  onValor: (v: string) => void;
  dica: string | null;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[74px] shrink-0 text-[11px] text-zinc-400">{rotulo}</span>
      <TextInput
        ariaLabel={ariaLabel}
        value={valor}
        onChange={onValor}
        placeholder={placeholder}
        maxLength={40}
      />
      {dica && (
        <span className="w-[68px] shrink-0 text-right text-[10.5px] text-zinc-500">{dica}</span>
      )}
    </div>
  );
}

/**
 * Cartela final: campos digitáveis + prévia do que o vídeo vai mostrar.
 *
 * Com o interruptor ligado, a cartela **entra com o que o arquivo mediu** e o
 * campo em branco é o que manda o número do arquivo. Digitar por cima troca
 * aquele número (é o que serve para a rota desenhada à mão, que não tem
 * arquivo para medir). Antes, só existia cartela se alguém digitasse alguma
 * coisa — e quem ligava o interruptor e não mexia nos campos recebia o vídeo
 * sem cartela nenhuma.
 */
export default function EndCardPanel({
  resumo,
  cartela,
  settings: s,
  update,
}: {
  resumo: RideSummary;
  cartela: EndCard | null;
  settings: Settings;
  update: Update;
}) {
  const sugestao = cardSuggestions(resumo);
  const preenchidos =
    s.cardDistance.trim() || s.cardElevation.trim() || s.cardTime.trim() || s.cardNote.trim();

  const campo = (chave: keyof CardFields, rotulo: string, dica: string | null, placeholder: string) => (
    <Campo
      ariaLabel={rotulo}
      rotulo={rotulo}
      valor={s[chave]}
      onValor={(v) => update(chave, v)}
      dica={dica}
      placeholder={placeholder}
    />
  );

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-zinc-400">🏁 Cartela final</span>
        <span className="text-[11px] text-zinc-500">
          {!s.endCard
            ? "desligada"
            : preenchidos
              ? "aparece no fim do vídeo"
              : "usa os números do arquivo"}
        </span>
      </div>

      <div className="mt-2.5">
        <PhotoField
          valor={s.cardPhoto}
          onValor={(v) => update("cardPhoto", v)}
          rotulo="Foto do projeto"
          ariaLabel="Foto do projeto"
        />
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {campo("cardDistance", "Distância", sugestao.distance, "ex.: 49 km")}
        {campo("cardElevation", "Elevação", sugestao.elevation, "ex.: +1.676 m")}
        {campo("cardTime", "Tempo", sugestao.time, "ex.: 3 h 19 min")}
        {campo(
          "cardNote",
          "Embaixo",
          null,
          sugestao.date ? `vazio = ${sugestao.date}` : "ex.: com os amigos do pedal",
        )}
      </div>

      <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-500">
        Em branco, entra o número do arquivo. A cartela aparece depois que o
        percurso termina, com o mapa parado.
      </p>

      {(sugestao.distance || sugestao.elevation || sugestao.time || sugestao.date) && (
        <button
          type="button"
          onClick={() => {
            if (sugestao.distance) update("cardDistance", sugestao.distance);
            if (sugestao.elevation) update("cardElevation", sugestao.elevation);
            if (sugestao.time) update("cardTime", sugestao.time);
            if (sugestao.date) update("cardNote", sugestao.date);
          }}
          className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/10"
        >
          ↓ usar os números do arquivo
        </button>
      )}

      {cartela && cartela.tiles.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1">
            {cartela.tiles.map((t) => (
              <div key={t.label} className="text-center">
                <div className="text-[15px] font-extrabold leading-tight text-white">
                  {t.value}
                </div>
                <div className="text-[9.5px] font-semibold uppercase tracking-wide text-zinc-500">
                  {t.label}
                </div>
              </div>
            ))}
          </div>
          {cartela.note && (
            <p className="mt-1 text-center text-[10.5px] text-zinc-400">{cartela.note}</p>
          )}
        </div>
      )}

      {s.cardPhoto && cartela && (
        <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">
          A foto do projeto vai no alto da cartela — a prévia acima não a mostra.
        </p>
      )}

      {!resumo.elevation && !resumo.time && (
        <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">
          Sem arquivo de GPS, os campos ficam por sua conta. Importe um GPX (📂) e as dicas
          ao lado aparecem com distância, elevação e tempo para copiar.
        </p>
      )}
    </div>
  );
}
