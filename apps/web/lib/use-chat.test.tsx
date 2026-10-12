// @vitest-environment jsdom
import type { ChatMessage, ChatSource, ChatStreamEvent } from "@kb/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ApiRequestError } from "./errors";

const mocks = vi.hoisted(() => ({
  streamAnswer: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
vi.mock("./api", () => ({
  streamAnswer: mocks.streamAnswer,
  api: { createConversation: mocks.createConversation, deleteConversation: mocks.deleteConversation },
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
  mocks.deleteConversation.mockReset().mockResolvedValue(undefined);
  saved = vi.fn<(conversationId: string) => Promise<void>>(async () => undefined);
  vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const setup = (id: string | null = "conv-1") =>
  renderHook(() => useChat({ initialConversationId: id, onExchangeSaved: saved }));

describe("useChat", () => {
  it("asks with the chosen model", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();
    act(() => {
      void result.current.send("Hi", "b/model");
    });
    await waitFor(() => expect(mocks.streamAnswer).toHaveBeenCalledWith("conv-1", "Hi", expect.any(AbortSignal), "b/model"));
    stream.end();
  });

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

  it("creates the conversation on the first question and reports it saved, without touching the address", async () => {
    mocks.createConversation.mockResolvedValue({ id: "new-1" });
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup(null);

    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("First question");
    });
    await waitFor(() => expect(mocks.streamAnswer).toHaveBeenCalledWith("new-1", "First question", expect.any(AbortSignal), undefined));
    expect(result.current.conversationId).toBe("new-1");

    await act(async () => {
      stream.push({ type: "start", sources: [] });
      stream.push({ type: "done", userMessage: message("user", "q"), assistantMessage: message("assistant", "a") });
      stream.end();
      await sending;
    });
    expect(saved).toHaveBeenCalledWith("new-1");
    expect(window.history.replaceState).not.toHaveBeenCalled(); // navigation is the page's decision
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

  it("keeps the text already received when the connection breaks in the middle of the answer", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup();
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("Q");
    });
    await act(async () => stream.push({ type: "start", sources: [source] }));
    await act(async () => stream.push({ type: "delta", text: "Disable " }));
    await act(async () => {
      stream.push(new TypeError("network error"));
      await sending;
    });
    expect(await sending).toBe(false);
    expect(result.current.pending).toMatchObject({ status: "interrupted", answer: "Disable " });
    expect(result.current.error).not.toBeNull();
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

  it("still counts the answer as saved when refreshing the lists afterwards fails", async () => {
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    saved.mockRejectedValue(new Error("network down while refreshing"));
    const { result } = setup();
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("q");
    });
    await act(async () => {
      stream.push({ type: "start", sources: [] });
      stream.push({ type: "done", userMessage: message("user", "q"), assistantMessage: message("assistant", "a") });
      stream.end();
      await sending;
    });
    expect(await sending).toBe(true); // the server stored it: do not make the person ask again
    expect(result.current.pending).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("stops while the conversation is still being created, and nothing is streamed", async () => {
    let seenSignal: AbortSignal | undefined;
    mocks.createConversation.mockImplementation(
      (_title: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { result } = setup(null);
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("first question");
    });
    await waitFor(() => expect(seenSignal).toBeDefined());
    await act(async () => {
      result.current.stop();
      await sending;
    });
    expect(result.current.pending).toMatchObject({ status: "stopped" });
    expect(mocks.streamAnswer).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
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

describe("useChat: a conversation created for a question that got no answer", () => {
  it("is removed again when the answer fails to start, and the next question starts a fresh one", async () => {
    mocks.createConversation.mockResolvedValueOnce({ id: "new-1" }).mockResolvedValueOnce({ id: "new-2" });
    mocks.streamAnswer.mockImplementationOnce(async function* () {
      throw new ApiRequestError(503, "ai_unavailable", "down");
    });
    const { result } = setup(null);
    await act(async () => {
      await result.current.send("First question");
    });
    expect(mocks.deleteConversation).toHaveBeenCalledExactlyOnceWith("new-1");
    expect(result.current.conversationId).toBeNull();

    const stream = controlledStream();
    mocks.streamAnswer.mockImplementationOnce((_id, _q, signal) => stream.iterate(signal));
    act(() => {
      void result.current.send("Second question");
    });
    await waitFor(() => expect(mocks.streamAnswer).toHaveBeenLastCalledWith("new-2", "Second question", expect.any(AbortSignal), undefined));
    stream.end();
  });

  it("is removed when the answer breaks off or the person stops it, since nothing was saved", async () => {
    mocks.createConversation.mockResolvedValue({ id: "new-1" });
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const { result } = setup(null);
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("Q");
    });
    await act(async () => stream.push({ type: "delta", text: "Hi" }));
    await act(async () => {
      result.current.stop();
      await sending;
    });
    expect(mocks.deleteConversation).toHaveBeenCalledExactlyOnceWith("new-1");
    expect(result.current.pending).toMatchObject({ status: "stopped", answer: "Hi" });
  });

  it("is kept once the answer is saved, and an existing conversation is never removed", async () => {
    mocks.createConversation.mockResolvedValue({ id: "new-1" });
    const stream = controlledStream();
    mocks.streamAnswer.mockImplementation((_id, _q, signal) => stream.iterate(signal));
    const created = setup(null);
    await act(async () => {
      stream.push({ type: "done", userMessage: message("user", "q"), assistantMessage: message("assistant", "a") });
      stream.end();
      await created.result.current.send("Q");
    });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();

    mocks.streamAnswer.mockImplementation(async function* () {
      throw new ApiRequestError(503, "ai_unavailable", "down");
    });
    const existing = setup("conv-1");
    await act(async () => {
      await existing.result.current.send("Q");
    });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
  });
});
