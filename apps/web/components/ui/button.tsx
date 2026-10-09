import { CircleNotch } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#333333] disabled:hover:bg-ink",
  secondary: "border border-line bg-surface text-ink hover:bg-subtle disabled:hover:bg-surface",
  ghost: "text-muted hover:bg-subtle hover:text-ink disabled:hover:bg-transparent",
  danger: "border border-line bg-surface text-red-ink hover:bg-red-wash disabled:hover:bg-surface",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner and blocks clicks; the label stays so the button keeps its width. */
  busy?: boolean;
}

export function Button({ variant = "secondary", busy, disabled, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy && <CircleNotch size={16} weight="bold" className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Square button that only shows an icon; `label` is its accessible name. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-md text-muted transition duration-150 hover:bg-subtle hover:text-ink active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
