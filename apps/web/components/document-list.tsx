"use client";

import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { StatusBadge, Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";
import { useDocuments } from "@/lib/hooks";

export function DocumentList() {
  const { data, error, isLoading, mutate } = useDocuments();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!data || !needle) return data ?? [];
    return data.filter((doc) =>
      [doc.title, doc.preview, ...doc.tags].some((text) => text.toLowerCase().includes(needle)),
    );
  }, [data, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-5">
        <h1 className="font-serif text-3xl tracking-[-0.02em] text-ink">Documents</h1>
        <Link
          href="/documents/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-white transition duration-150 hover:bg-[#333333] active:scale-[0.98]"
        >
          <Plus size={16} weight="bold" aria-hidden />
          New
        </Link>
      </div>

      <div className="relative px-4 pt-4">
        <MagnifyingGlass size={16} weight="bold" aria-hidden className="pointer-events-none absolute left-7 top-[calc(1rem+0.65rem)] text-muted" />
        <input
          type="search"
          aria-label="Search documents"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted hover:border-[#d6d6d3] focus-visible:border-ink focus-visible:outline-none"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-4">
        {error && (
          <div className="px-4">
            <Alert action={<Button variant="ghost" className="h-7 px-2 text-red-ink" onClick={() => mutate()}>Retry</Button>}>
              {describeError(error)}
            </Alert>
          </div>
        )}

        {isLoading && (
          <ul className="flex flex-col gap-1 px-2" aria-busy="true" aria-label="Loading documents">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="px-2 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-full" />
              </li>
            ))}
          </ul>
        )}

        {data && data.length === 0 && (
          <div className="rise px-6 py-12 text-center">
            <p className="font-serif text-2xl tracking-[-0.02em] text-ink">Nothing here yet</p>
            <p className="mx-auto mt-2 max-w-[18rem] text-sm text-muted">
              Add your first document. Once it is saved you can ask questions about it in Chat.
            </p>
          </div>
        )}

        {data && data.length > 0 && shown.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-muted">No document matches “{query.trim()}”.</p>
        )}

        <ul className="flex flex-col px-2">
          {shown.map((doc, index) => {
            const active = pathname === `/documents/${doc.id}`;
            return (
              <li key={doc.id} className="rise" style={{ "--index": Math.min(index, 8) } as React.CSSProperties}>
                <Link
                  href={`/documents/${doc.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-2 py-3 transition-colors duration-150 hover:bg-subtle ${active ? "bg-subtle" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium text-ink">{doc.title}</span>
                    <time dateTime={doc.updatedAt} className="shrink-0 font-mono text-[11px] text-muted">
                      {formatWhen(doc.updatedAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted">{doc.preview}</p>
                  {(doc.tags.length > 0 || doc.indexingStatus !== "indexed") && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {doc.indexingStatus !== "indexed" && <StatusBadge status={doc.indexingStatus} />}
                      {doc.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
