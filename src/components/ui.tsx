import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Section({
  step,
  title,
  hint,
  children,
  right,
}: {
  step: number | string;
  title: string;
  hint?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <header className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 text-[11px] font-bold text-white shadow-lg shadow-indigo-900/40">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-400">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Label({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {children}
      </span>
      {value != null && <span className="text-[11.5px] font-semibold text-zinc-200">{value}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { id: T; label: string; icon?: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title ?? o.label}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex-1 rounded-lg font-semibold transition-all",
            size === "sm" ? "px-1.5 py-1.5 text-[11px]" : "px-2 py-2 text-xs",
            value === o.id
              ? "bg-gradient-to-b from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-950/50"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
          )}
        >
          {o.icon && <span className="mr-1">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="range-input w-full"
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  icon?: string;
}) {
  return (
    <button
      type="button"
      // o estado do interruptor precisa ser legível fora da tela também
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[12px] font-medium transition-colors",
        checked
          ? "border-violet-400/40 bg-violet-500/15 text-white"
          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
      )}
    >
      {icon && <span className="text-sm leading-none">{icon}</span>}
      <span className="flex-1">{label}</span>
      <span
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-violet-500" : "bg-zinc-700",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
            checked ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  className,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "soft";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "bg-gradient-to-b from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-950/50 hover:brightness-110 active:scale-[0.98]",
        variant === "soft" && "bg-white/10 text-white hover:bg-white/15 active:scale-[0.98]",
        variant === "ghost" &&
          "border border-white/10 bg-black/20 text-zinc-300 hover:border-white/25 hover:text-white",
        variant === "danger" &&
          "border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  /**
   * Nome acessível do campo.
   *
   * Os rótulos dos painéis são um `<span>` ao lado, não um `<label>` ligado ao
   * campo — então quem lê a tela não sabe o que é cada caixa. Daí o
   * `aria-label`, que também dá um jeito estável de achar o campo nos testes.
   */
  ariaLabel?: string;
}) {
  return (
    <input
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-zinc-500 focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
    />
  );
}
