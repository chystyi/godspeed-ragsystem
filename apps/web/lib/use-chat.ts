"use client";

import type { ChatSource } from "@kb/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamAnswer } from "./api";
import { ApiRequestError, describeError } from "./errors";

/** The question being answered right now; it exists only until the answer is saved. */
export interface PendingExchange {
  question: string;
  answer: string;
  sources: ChatSource[] | null;
  /** waiting: nothing yet. streaming: text arriving. interrupted: broke off. stopped: user ended it. */
  status: "waiting" | "streaming" | "interrupted" | "stopped";
}

interface UseChatOptions {
  initialConversationId: string | null;
  /** Called once the question and answer are stored, so lists and messages can be reloaded. */
  onExchangeSaved: (conversationId: string) => Promise<void> | void;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function useChat({ initialConversationId, onExchangeSaved }: UseChatOptions) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Always call the newest callback, without making `send` change on every render.
  const saved = useRef(onExchangeSaved);
  useEffect(() => {
    saved.current = onExchangeSaved;
  });

  // Leaving the page ends the answer (the server stops paying for it as well).
  useEffect(() => () => controller.current?.abort(), []);

  const busy = pending !== null && (pending.status === "waiting" || pending.status === "streaming");

  /** Returns false when the question could not be sent, so the caller can keep the text. */
  const send = useCallback(
    async (question: string, model?: string): Promise<boolean> => {
      if (controller.current) return false;
      const abort = new AbortController();
      controller.current = abort;
      setError(null);
      setPending({ question, answer: "", sources: null, status: "waiting" });

      const update = (change: Partial<PendingExchange>) =>
        setPending((current) => (current ? { ...current, ...change } : current));

      let createdHere: string | null = null;
      let begun = false; // some of the answer reached the screen
      // A conversation made for this question has nothing in it if no answer was saved: remove it
      // (it would count against the person's limit and show up empty), so the next question starts afresh.
      const discardEmptyConversation = () => {
        if (!createdHere) return;
        const empty = createdHere;
        createdHere = null;
        setConversationId(null);
        void api.deleteConversation(empty).catch(() => undefined);
      };

      try {
        let id = conversationId;
        if (!id) {
          id = (await api.createConversation(undefined, abort.signal)).id;
          createdHere = id;
          setConversationId(id);
        }
        for await (const event of streamAnswer(id, question, abort.signal, model)) {
          if (event.type === "start") {
            begun = true;
            update({ sources: event.sources, status: "streaming" });
          } else if (event.type === "delta") {
            begun = true;
            setPending((current) => (current ? { ...current, answer: current.answer + event.text, status: "streaming" } : current));
          } else if (event.type === "done") {
            try {
              await saved.current(id);
            } catch {
              // The answer is stored; only refreshing the lists failed. They catch up on their
              // next refresh, and the person must not be made to ask the same question again.
            }
            setPending(null);
            return true;
          } else {
            setError(describeError(new ApiRequestError(0, event.code, event.message)));
            update({ status: "interrupted" });
            discardEmptyConversation();
            return false;
          }
        }
        // The stream ended without a final event: treat it as an interruption.
        setError(describeError(new ApiRequestError(0, "network", "stream ended early")));
        update({ status: "interrupted" });
        discardEmptyConversation();
        return false;
      } catch (failure) {
        discardEmptyConversation();
        if (isAbort(failure)) {
          update({ status: "stopped" });
          return false;
        }
        setError(describeError(failure));
        // Text that already arrived stays visible, marked as unsaved; only a failure before any
        // text hands the question back.
        if (begun) update({ status: "interrupted" });
        else setPending(null);
        return false;
      } finally {
        controller.current = null;
      }
    },
    [conversationId],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  return { conversationId, pending, error, busy, send, stop };
}
