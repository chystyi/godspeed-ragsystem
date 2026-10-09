"use client";

import { usePathname } from "next/navigation";

/**
 * List on the left, detail on the right. On a phone only one is shown: the list at the
 * section's root, the detail below it.
 */
export function Panes({ root, list, children }: { root: string; list: React.ReactNode; children: React.ReactNode }) {
  const atRoot = usePathname() === root;
  return (
    <>
      <aside
        aria-label="List"
        className={`${atRoot ? "flex" : "hidden"} w-full shrink-0 flex-col overflow-hidden border-r border-line bg-surface md:flex md:w-80 lg:w-[22rem]`}
      >
        {list}
      </aside>
      <main className={`${atRoot ? "hidden" : "block"} min-w-0 flex-1 overflow-y-auto md:block`}>{children}</main>
    </>
  );
}

/** Shown while the address is not yet known: the list column is reserved, so nothing jumps. */
export function PanesFallback() {
  return (
    <>
      <aside aria-hidden className="hidden w-80 shrink-0 border-r border-line bg-surface md:block lg:w-[22rem]" />
      <main aria-busy="true" className="min-w-0 flex-1" />
    </>
  );
}
