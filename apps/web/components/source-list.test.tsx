// @vitest-environment jsdom
import type { ChatSource } from "@kb/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SourceList } from "./source-list";

const source = (number: number, over: Partial<ChatSource> = {}): ChatSource => ({
  number,
  documentId: `doc-${number}`,
  chunkId: `chunk-${number}`,
  documentTitle: `Document ${number}`,
  chunkIndex: 0,
  similarity: 0.5123,
  snippet: `Passage ${number}.`,
  cited: true,
  ...over,
});

describe("SourceList", () => {
  it("renders nothing when there are no sources", () => {
    const { container } = render(<SourceList sources={[]} selected={null} onSelect={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every source with its number and title", () => {
    render(<SourceList sources={[source(1), source(2)]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByRole("button", { name: /1\s*Document 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\s*Document 2/ })).toBeInTheDocument();
  });

  it("selects a source on click and clears it on a second click", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<SourceList sources={[source(1)]} selected={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Document 1/ }));
    expect(onSelect).toHaveBeenLastCalledWith(1);
    rerender(<SourceList sources={[source(1)]} selected={1} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Document 1/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Document 1/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("shows the passage, the match and a link to the document for the selected source", () => {
    render(<SourceList sources={[source(2)]} selected={2} onSelect={() => undefined} />);
    expect(screen.getByText("Passage 2.")).toBeInTheDocument();
    expect(screen.getByText(/Match 51%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open document/ })).toHaveAttribute("href", "/documents/doc-2");
  });

  it("says when a source was read but not used", () => {
    render(<SourceList sources={[source(1, { cited: false })]} selected={1} onSelect={() => undefined} />);
    expect(screen.getByText(/not used in the answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Document 1/ })).toHaveAttribute("title", expect.stringMatching(/not used/));
  });

  it("marks a cut-off passage with an ellipsis only when it was cut", () => {
    const long = source(1, { snippet: "x".repeat(200) });
    const { rerender } = render(<SourceList sources={[long]} selected={1} onSelect={() => undefined} />);
    expect(screen.getByText(/x{200}…/)).toBeInTheDocument();
    rerender(<SourceList sources={[source(1, { snippet: "short" })]} selected={1} onSelect={() => undefined} />);
    expect(screen.queryByText(/short…/)).not.toBeInTheDocument();
  });

  it("shows passage text as text, not as markup", () => {
    const hostile = source(1, { snippet: '<img src=x onerror="alert(1)">', documentTitle: "<b>Bold</b>" });
    const { container } = render(<SourceList sources={[hostile]} selected={1} onSelect={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});
