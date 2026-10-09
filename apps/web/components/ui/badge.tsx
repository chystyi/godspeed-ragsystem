import type { IndexingStatus } from "@kb/shared";

const STATUS: Record<IndexingStatus, { label: string; tone: string }> = {
  indexed: { label: "Searchable", tone: "bg-green-wash text-green-ink" },
  pending: { label: "Indexing", tone: "bg-yellow-wash text-yellow-ink" },
  failed: { label: "Not searchable", tone: "bg-red-wash text-red-ink" },
};

const PILL = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase leading-4 tracking-[0.05em]";

export function StatusBadge({ status }: { status: IndexingStatus }) {
  const { label, tone } = STATUS[status];
  return <span className={`${PILL} ${tone}`}>{label}</span>;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className={`${PILL} bg-subtle text-muted`}>{children}</span>;
}
