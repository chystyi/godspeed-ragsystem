import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <h1 className="font-serif text-4xl leading-[1.1] tracking-[-0.03em] text-ink">Page not found</h1>
      <p className="mt-4 text-muted">There is nothing at this address.</p>
      <Link href="/" className="mt-6 inline-block text-sm font-medium text-ink underline underline-offset-4">
        Go to the start page
      </Link>
    </div>
  );
}
