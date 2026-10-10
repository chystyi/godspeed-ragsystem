"use client";

/** Last resort when even the root layout fails; it must bring its own html and body. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "6rem 1.5rem", maxWidth: "36rem", margin: "0 auto" }}>
        <h1>Something went wrong</h1>
        <p>The application could not be shown. Your data is not affected.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
