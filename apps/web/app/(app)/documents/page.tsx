import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents" };

// Filled in by the browser after sign-in; opting out keeps the dev-mode check for instant
// navigation from reporting this page (see the layout of this section).
export const instant = false;

export default function DocumentsHome() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-16 text-center">
      <div className="rise max-w-sm">
        <p className="font-serif text-3xl tracking-[-0.02em] text-ink">Pick a document</p>
        <p className="mt-2 text-muted">Or write a new one. Everything you save can be searched from Chat.</p>
      </div>
    </div>
  );
}
