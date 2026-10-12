import type { UsageRow } from "@kb/shared";
import { describe, expect, it } from "vitest";
import { dailyTotals, summarize, tokensOf } from "./usage";

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-10-13",
  kind: "chat",
  model: "a/model",
  requests: 1,
  promptTokens: 100,
  completionTokens: 20,
  ...over,
});

describe("tokensOf", () => {
  it("adds what was sent and what came back", () => {
    expect(tokensOf(row())).toBe(120);
  });
});

describe("summarize", () => {
  const rows = [
    row({ requests: 2, promptTokens: 200, completionTokens: 40 }),
    row({ day: "2026-10-12", requests: 1, promptTokens: 50, completionTokens: 10 }),
    row({ model: "b/model", requests: 4, promptTokens: 400, completionTokens: 80 }),
    row({ kind: "embedding", model: "e/model", requests: 3, promptTokens: 900, completionTokens: 0 }),
  ];

  it("totals chat and embedding separately", () => {
    const { chat, embedding } = summarize(rows);
    expect(chat).toEqual({ requests: 7, promptTokens: 650, completionTokens: 130, tokens: 780 });
    expect(embedding).toEqual({ requests: 3, promptTokens: 900, completionTokens: 0, tokens: 900 });
  });

  it("groups by kind and model, the biggest user of tokens first", () => {
    expect(summarize(rows).models.map((m) => [m.kind, m.model, m.tokens])).toEqual([
      ["embedding", "e/model", 900],
      ["chat", "b/model", 480],
      ["chat", "a/model", 300],
    ]);
  });

  it("handles no usage at all", () => {
    const empty = summarize([]);
    expect(empty.chat.tokens).toBe(0);
    expect(empty.models).toEqual([]);
  });
});

describe("dailyTotals", () => {
  it("gives one entry per day of the period, empty days included, oldest first, ending today", () => {
    const rows = [row({ day: "2026-10-13" }), row({ day: "2026-10-11", promptTokens: 30, completionTokens: 0 }), row({ day: "2026-10-13", kind: "embedding", promptTokens: 80, completionTokens: 0 })];
    expect(dailyTotals(rows, 4, "2026-10-13")).toEqual([
      { day: "2026-10-10", tokens: 0 },
      { day: "2026-10-11", tokens: 30 },
      { day: "2026-10-12", tokens: 0 },
      { day: "2026-10-13", tokens: 200 },
    ]);
  });

  it("ignores rows outside the period", () => {
    expect(dailyTotals([row({ day: "2026-01-01" })], 2, "2026-10-13").every((d) => d.tokens === 0)).toBe(true);
  });
});
