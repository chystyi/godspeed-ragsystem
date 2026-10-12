// @vitest-environment jsdom
import type { UsageRow } from "@kb/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  days: 0,
  state: { data: undefined as unknown, error: undefined as unknown, isLoading: false },
}));
vi.mock("@/lib/hooks", () => ({
  useUsage: (days: number) => {
    mocks.days = days;
    return mocks.state;
  },
}));

import { UsageView } from "./usage-view";

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-10-13",
  kind: "chat",
  model: "openai/gpt-4o-mini",
  requests: 3,
  promptTokens: 1500,
  completionTokens: 300,
  ...over,
});

const todayUtc = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  mocks.state = { data: undefined, error: undefined, isLoading: false };
  mocks.days = 0;
});

describe("UsageView", () => {
  it("shows a loading state", () => {
    mocks.state = { data: undefined, error: undefined, isLoading: true };
    render(<UsageView />);
    expect(screen.getByLabelText("Loading usage")).toBeTruthy();
  });

  it("explains a failure in plain words", () => {
    mocks.state = { data: undefined, error: new ApiRequestError(0, "network", "x"), isLoading: false };
    render(<UsageView />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot reach the server/i);
  });

  it("invites the first use when nothing was used yet", () => {
    mocks.state = { data: { days: 30, rows: [] }, error: undefined, isLoading: false };
    render(<UsageView />);
    expect(screen.getByText(/No usage yet/)).toBeTruthy();
  });

  it("shows tokens and requests for chat and embeddings, and a line per model", () => {
    mocks.state = {
      data: {
        days: 30,
        rows: [row(), row({ kind: "embedding", model: "openai/text-embedding-3-small", requests: 2, promptTokens: 4200, completionTokens: 0 })],
      },
      error: undefined,
      isLoading: false,
    };
    render(<UsageView />);
    const chat = screen.getByRole("group", { name: "Chat answers" });
    expect(within(chat).getByText("1,800")).toBeTruthy(); // 1500 + 300 tokens
    expect(within(chat).getByText(/3 requests/)).toBeTruthy();
    const embeddings = screen.getByRole("group", { name: "Document and search embeddings" });
    expect(within(embeddings).getByText("4,200")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("openai/gpt-4o-mini")).toBeTruthy();
    expect(within(table).getByText("openai/text-embedding-3-small")).toBeTruthy();
  });

  it("draws one bar per day of the period with the day's tokens as its label", async () => {
    mocks.state = { data: { days: 7, rows: [row({ day: todayUtc() })] }, error: undefined, isLoading: false };
    render(<UsageView />);
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    const bars = screen.getAllByRole("listitem");
    expect(bars).toHaveLength(7);
    expect(bars.at(-1)?.getAttribute("aria-label")).toMatch(/1,800 tokens/);
  });

  it("asks for the period that was chosen", async () => {
    mocks.state = { data: { days: 30, rows: [] }, error: undefined, isLoading: false };
    render(<UsageView />);
    expect(mocks.days).toBe(30);
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(mocks.days).toBe(7);
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
  });
});
