// @vitest-environment jsdom
import type { KbDocument } from "@kb/shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  refresh: vi.fn(),
  doc: null as unknown,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mocks.refresh }) }));
vi.mock("@/lib/api", () => ({ api: { updateDocument: mocks.update } }));
vi.mock("@/lib/hooks", () => ({
  useDocument: () => ({ data: mocks.doc, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

import { ExistingDocumentEditor } from "./document-editor";

const doc = (patch: Partial<KbDocument> = {}): KbDocument => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Router",
  content: "Reset it with the pin.",
  tags: [],
  indexingStatus: "indexed",
  indexingError: null,
  indexedAt: "2026-10-10T10:00:00.000Z",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  mocks.update.mockReset();
  mocks.refresh.mockReset();
  mocks.doc = doc();
});

const text = () => screen.getByLabelText("Text") as HTMLTextAreaElement;

describe("document editor", () => {
  it("keeps what was typed while the save was in flight", async () => {
    let finish!: (d: KbDocument) => void;
    mocks.update.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ExistingDocumentEditor id="x" />);
    fireEvent.change(text(), { target: { value: "first edit" } });
    fireEvent.submit(text().closest("form")!);
    fireEvent.change(text(), { target: { value: "first edit, and more" } });
    await act(async () => finish(doc({ content: "first edit" })));
    expect(text().value).toBe("first edit, and more");
  });

  it("does not send a second save while one is running", async () => {
    mocks.update.mockReturnValue(new Promise(() => {}));
    render(<ExistingDocumentEditor id="x" />);
    fireEvent.change(text(), { target: { value: "edit" } });
    const form = text().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("still reports success when refreshing the list fails afterwards", async () => {
    mocks.update.mockResolvedValue(doc({ content: "edit" }));
    mocks.refresh.mockRejectedValue(new Error("offline"));
    render(<ExistingDocumentEditor id="x" />);
    fireEvent.change(text(), { target: { value: "edit" } });
    fireEvent.submit(text().closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the earlier version is still searchable when re-indexing failed", () => {
    mocks.doc = doc({ indexingStatus: "failed", indexingError: "The AI provider is unavailable." });
    render(<ExistingDocumentEditor id="x" />);
    expect(screen.getByRole("alert").textContent).toContain("earlier version can still be searched");
  });

  it("says the document cannot be searched when it was never indexed", () => {
    mocks.doc = doc({ indexingStatus: "failed", indexedAt: null, indexingError: "x" });
    render(<ExistingDocumentEditor id="x" />);
    expect(screen.getByRole("alert").textContent).toContain("cannot be searched yet");
  });
});
