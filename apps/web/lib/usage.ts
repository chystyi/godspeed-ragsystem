import type { UsageKind, UsageRow } from "@kb/shared";

export interface Totals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
}

export interface ModelTotals extends Totals {
  kind: UsageKind;
  model: string;
}

export const tokensOf = (row: Pick<UsageRow, "promptTokens" | "completionTokens">) => row.promptTokens + row.completionTokens;

const empty = (): Totals => ({ requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0 });

function add(into: Totals, row: UsageRow): void {
  into.requests += row.requests;
  into.promptTokens += row.promptTokens;
  into.completionTokens += row.completionTokens;
  into.tokens += tokensOf(row);
}

/** Totals for chat and for embeddings, and per model (the biggest user of tokens first). */
export function summarize(rows: UsageRow[]): { chat: Totals; embedding: Totals; models: ModelTotals[] } {
  const chat = empty();
  const embedding = empty();
  const byModel = new Map<string, ModelTotals>();
  for (const row of rows) {
    add(row.kind === "chat" ? chat : embedding, row);
    const key = `${row.kind}\u0000${row.model}`;
    const entry = byModel.get(key) ?? { kind: row.kind, model: row.model, ...empty() };
    add(entry, row);
    byModel.set(key, entry);
  }
  return { chat, embedding, models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens) };
}

const DAY_MS = 86_400_000;

/** Tokens per day for the `days` days ending at `today` (YYYY-MM-DD); days without usage are 0. */
export function dailyTotals(rows: UsageRow[], days: number, today: string): { day: string; tokens: number }[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  const result = Array.from({ length: days }, (_, i) => ({
    day: new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
    tokens: 0,
  }));
  const index = new Map(result.map((entry, i) => [entry.day, i]));
  for (const row of rows) {
    const i = index.get(row.day);
    if (i !== undefined) result[i].tokens += tokensOf(row);
  }
  return result;
}
