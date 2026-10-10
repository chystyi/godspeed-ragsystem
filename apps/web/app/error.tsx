"use client";

import { Button } from "@/components/ui/button";

/** Shown when a page fails while rendering; the message is fixed so no internals reach the screen. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <h1 className="font-serif text-4xl leading-[1.1] tracking-[-0.03em] text-ink">Something went wrong</h1>
      <p className="mt-4 text-muted">This page could not be shown. Your documents and chats are not affected.</p>
      <Button className="mt-6" variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
