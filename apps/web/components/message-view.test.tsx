// @vitest-environment jsdom
import type { ChatMessage, ChatSource } from "@kb/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { MessageView, PendingView } from "./message-view";

const source: ChatSource = {
  number: 1,
  documentId: "d1",
  chunkId: "c1",
  documentTitle: "Router guide",
  chunkIndex: 0,
  similarity: 0.7,
  snippet: "Disable WPS.",
  cited: true,
};

const assistant = (content: string, sources: ChatSource[] | null = [source]): ChatMessage => ({
  id: "m2",
  role: "assistant",
  content,
  sources,
  createdAt: "2026-10-09T12:00:00Z",
});

describe("MessageView", () => {
  it("shows a question as written", () => {
    render(<MessageView message={{ id: "m1", role: "user", content: "How?", sources: null, createdAt: "" }} />);
    expect(screen.getByText("How?")).toBeInTheDocument();
  });

  it("shows an answer with clickable citations and a source list", async () => {
    render(<MessageView message={assistant("Disable WPS [1].")} />);
    expect(screen.getByText("Sources")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Source 1: Router guide" }));
    expect(screen.getByText("Disable WPS.")).toBeInTheDocument(); // the passage opened
    await userEvent.click(screen.getByRole("button", { name: "Source 1: Router guide" }));
    expect(screen.queryByText("Disable WPS.")).not.toBeInTheDocument(); // and closed again
  });

  it("copes with an answer that has no sources", () => {
    render(<MessageView message={assistant("I couldn't find anything.", [])} />);
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("copes with an answer whose sources are missing", () => {
    render(<MessageView message={assistant("Plain answer.", null)} />);
    expect(screen.getByText("Plain answer.")).toBeInTheDocument();
  });
});

describe("PendingView", () => {
  it("shows the question and that the documents are being searched", () => {
    render(<PendingView pending={{ question: "How?", answer: "", sources: null, status: "waiting" }} />);
    expect(screen.getByText("How?")).toBeInTheDocument();
    expect(screen.getByText(/Looking through your documents/)).toBeInTheDocument();
  });

  it("shows the answer as it grows, without the source list until it is complete", () => {
    render(<PendingView pending={{ question: "How?", answer: "Disable WPS [1]", sources: [source], status: "streaming" }} />);
    expect(screen.getByText(/Disable WPS/)).toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it.each([
    ["interrupted", /interrupted\. Nothing was saved/],
    ["stopped", /Stopped\. Nothing was saved/],
  ] as const)("explains a %s answer", (status, note) => {
    render(<PendingView pending={{ question: "How?", answer: "Half an", sources: [source], status }} />);
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.getByText("Half an")).toBeInTheDocument();
  });
});
