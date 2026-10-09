// @vitest-environment jsdom
import type { ChatSource } from "@kb/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnswerText } from "./answer-text";

const source = (number: number, title: string): ChatSource => ({
  number,
  documentId: `d${number}`,
  chunkId: `c${number}`,
  documentTitle: title,
  chunkIndex: 0,
  similarity: 0.6,
  snippet: "…",
  cited: true,
});

const sources = [source(1, "Router guide"), source(2, "Carbonara recipe")];

describe("AnswerText", () => {
  it("turns [1] and [2] into buttons named after their documents", () => {
    render(<AnswerText text="Use WPA3 [1] and whisk eggs [2]." sources={sources} onCite={() => undefined} />);
    expect(screen.getByRole("button", { name: "Source 1: Router guide" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Source 2: Carbonara recipe" })).toHaveTextContent("2");
  });

  it("keeps the surrounding sentence intact", () => {
    const { container } = render(<AnswerText text="Use WPA3 [1] always." sources={sources} onCite={() => undefined} />);
    expect(container.textContent).toBe("Use WPA3 1 always.");
  });

  it("reports which source was pressed", async () => {
    const onCite = vi.fn();
    render(<AnswerText text="See [2]." sources={sources} onCite={onCite} />);
    await userEvent.click(screen.getByRole("button", { name: /Source 2/ }));
    expect(onCite).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("splits a group [1, 2] into one button per source", () => {
    render(<AnswerText text="Both apply [1, 2]." sources={sources} onCite={() => undefined} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("leaves a number without a source as plain text", () => {
    render(<AnswerText text="Unknown [7] reference." sources={sources} onCite={() => undefined} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/\[7\]/)).toBeInTheDocument();
  });

  it("shows markup in an answer as text, not as HTML", () => {
    const { container } = render(<AnswerText text={'<img src=x onerror="alert(1)"> [1]'} sources={sources} onCite={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });
});
