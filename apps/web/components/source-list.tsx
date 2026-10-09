import type { ChatSource } from "@kb/shared";
import { ArrowUpRight } from "@phosphor-icons/react";
import Link from "next/link";

interface SourceListProps {
  sources: ChatSource[];
  selected: number | null;
  onSelect: (number: number | null) => void;
}

/** Where an answer came from. Cited sources are solid; the rest were read but not used. */
export function SourceList({ sources, selected, onSelect }: SourceListProps) {
  if (sources.length === 0) return null;
  const open = sources.find((source) => source.number === selected);
  return (
    <div className="mt-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">Sources</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {sources.map((source) => {
          const active = source.number === selected;
          return (
            <li key={source.chunkId}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : source.number)}
                title={source.cited ? undefined : "Read, but not used in this answer"}
                className={`flex max-w-[16rem] items-center gap-2 rounded-md border px-2.5 py-1 text-left text-[13px] transition-colors duration-150 ${
                  active
                    ? "border-ink bg-subtle text-ink"
                    : source.cited
                      ? "border-line bg-surface text-ink hover:border-ink"
                      : "border-line bg-surface text-muted hover:border-[#d6d6d3]"
                }`}
              >
                <span className="font-mono text-[11px]">{source.number}</span>
                <span className="truncate">{source.documentTitle}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="rise mt-3 rounded-md border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-serif text-lg leading-snug tracking-[-0.01em] text-ink">{open.documentTitle}</p>
            <Link
              href={`/documents/${open.documentId}`}
              className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-ink underline underline-offset-4 hover:no-underline"
            >
              Open document
              <ArrowUpRight size={14} weight="bold" aria-hidden />
            </Link>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
            {open.snippet}
            {open.snippet.length >= 200 ? "…" : ""}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted">
            Match {Math.round(open.similarity * 100)}%{open.cited ? "" : " · not used in the answer"}
          </p>
        </div>
      )}
    </div>
  );
}
