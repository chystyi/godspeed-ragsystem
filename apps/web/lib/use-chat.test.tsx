// @vitest-environment jsdom
import type { ChatMessage, ChatSource, ChatStreamEvent } from "@kb/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ApiRequestError } from "./errors";

const mocks = vi.hoisted(() => ({
  streamAnswer: vi.fn(),
  createConversation: vi.fn(),
}));
vi.mock("./api", () => ({
  streamAnswer: mocks.streamAnswer,
  api: { createConversation: mocks.createConversation },
}));

import { useChat } from "./use-chat";

const source: ChatSource = {
  number: 1,
  documentId: "d1",
  chunkId: "c1",
  documentTitle: "Router guide",
  chunkIndex: 0,
  similarity: 0.7,
  snippet: "Disable WPS.",
  cited: false,
};
const message = (role: "user" | "assistant", content: string): ChatMessage => ({
  id: `${role}-1`,
  role,
  content,
  sources: role === "assistant" ? [{ ...source, cited: true }] : null,
  createdAt: "2026-10-09T12:00:00Z",
});

/** A stream the test controls event by event. */
function controlledStream() {
  const queue: (ChatStreamEvent | Error)[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  return {
    push(item: ChatStreamEvent | Error) {
      queue.push(item);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    async *iterate(signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      for (;;) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const next = queue.shift();
        if (next instanceof Error) throw next;
        if (next) {
          yield next;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    },
  };
}

let saved: Mock<(conversationId: string) => Promise<void>>;
beforeEach(() => {
  mocks.streamAnswer.mockReset();
  mocks.createConversation.mockReset();
  saved = vi.fn<(conversationId: string) => Promise<void>>(async () => undefined);
  vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const setup = (id: string | null = "conv-1") =>
  renderHook(() => useChat({ initialConversationId: id, onExchangeSaved: saved }));

describe("useChat", () => {
  it("shows the question at once, then the sources and the growing answer", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();

    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("How do I secure it?");
    });
    expect(result.current.pending).toEqual({ question: "How do I secure it?", answer: "", sources: null, status: "waiting" });
    expect(result.current.busy).toBe(true);

    await act(async () => stream.push({ type: "start", sources: [source] }));
    expect(result.current.pending).toMatchObject({ status: "streaming", sources: [source] });

    await act(async () => stream.push({ type: "delta", text: "Disable " }));
    await act(async () => stream.push({ type: "delta", text: "WPS [1]." }));
    expect(result.current.pending?.answer).toBe("Disable WPS [1].");

    await act(async () => {
      stream.push({ type: "done", userMessage: message("user", "q"), assistantMessage: message("assistant", "Disable WPS [1].") });
      stream.end();
      await sending;
    });
    expect(await sending).toBe(true);
    expect(saved).toHaveBeenCalledWith("conv-1");
    expect(result.current.pending).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("creates the conversation on the first question and moves the address when the answer is saved", async () => {
    mocks.createConversation.mockResolvedValue({ id: "new-1" });
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup(null);

    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("First question");
    });
    await waitFor(() => expect(mocks.streamAnswer).toHaveBeenCalledWith("new-1", "First question", expect.any(AbortSignal)));
    expect(result.current.conversationId).toBe("new-1");
    expect(window.history.replaceState).not.toHaveBeenCalled(); // not before the answer is saved

    await act(async () => {
      stream.push({ type: "start", sources: [] });
      stream.push({ type: "done", userMessage: message("user", "q"), assistantMessage: message("assistant", "a") });
      stream.end();
      await sending;
    });
    expect(saved).toHaveBeenCalledWith("new-1");
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/chat/new-1");
  });

  it("reports a problem found before the answer starts and hands the question back", async () => {
    mocks.streamAnswer.mockImplementation(async function* () {
      throw new ApiRequestError(429, "too_many_requests", "slow", 12);
    });
    const { result } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.send("Too fast?");
    });
    expect(ok).toBe(false);
    expect(result.current.error).toMatch(/12 seconds/);
    expect(result.current.pending).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it("keeps the partial text, marks it unsaved and shows the reason when the answer breaks off", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("q");
    });
    await act(async () => {
      stream.push({ type: "start", sources: [source] });
      stream.push({ type: "delta", text: "Half an " });
      stream.push({ type: "error", code: "ai_unavailable", message: "x" });
      stream.end();
      await sending;
    });
    expect(result.current.pending).toMatchObject({ status: "interrupted", answer: "Half an " });
    expect(result.current.error).toMatch(/not available/i);
    expect(saved).not.toHaveBeenCalled();
  });

  it("stops on request: partial text stays, marked as stopped, nothing is saved", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("q");
    });
    await act(async () => {
      stream.push({ type: "start", sources: [] });
      stream.push({ type: "delta", text: "Partial" });
    });
    await act(async () => {
      result.current.stop();
      await sending;
    });
    expect(result.current.pending).toMatchObject({ status: "stopped", answer: "Partial" });
    expect(result.current.error).toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("ignores a second question while one is being answered", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();
    act(() => {
      void result.current.send("first");
    });
    let second = true;
    await act(async () => {
      second = await result.current.send("second");
    });
    expect(second).toBe(false);
    expect(mocks.streamAnswer).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier failure when a new question starts", async () => {
    mocks.streamAnswer.mockImplementationOnce(async function* () {
      throw new ApiRequestError(503, "ai_unavailable", "down");
    });
    const { result } = setup();
    await act(async () => void (await result.current.send("one")));
    expect(result.current.error).not.toBeNull();

    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    act(() => {
      void result.current.send("two");
    });
    expect(result.current.error).toBeNull();
  });

  it("cancels the running answer when the page is left", async () => {
    const stream = controlledStream();
    let seen: AbortSignal | undefined;
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => {
      seen = signal;
      return stream.iterate(signal);
    });
    const { result, unmount } = setup();
    act(() => {
      void result.current.send("q");
    });
    await waitFor(() => expect(seen).toBeDefined());
    unmount();
    expect(seen?.aborted).toBe(true);
  });
});
