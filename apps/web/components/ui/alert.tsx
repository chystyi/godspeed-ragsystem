import { WarningCircle } from "@phosphor-icons/react";

/** Inline problem message. `role="alert"` makes screen readers announce it right away. */
export function Alert({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-line bg-red-wash px-3.5 py-2.5 text-sm text-red-ink"
    >
      <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}
