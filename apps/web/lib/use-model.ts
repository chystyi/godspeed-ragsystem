"use client";

import type { ChatModelChoices } from "@kb/shared";
import { useCallback, useSyncExternalStore } from "react";

const KEY = "kb-chat-model";

// Kept in memory as well, so the choice works for this visit even when storage is blocked.
let thisVisit: string | null = null;

const remembered = (): string | null => {
  if (thisVisit) return thisVisit;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // blocked storage: the default model is used
  }
};

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

/**
 * The chat model the person picked, remembered in this browser. Only a model the server
 * offers counts; anything else (an old choice, a tampered value) falls back to the default.
 */
export function useChosenModel(choices: ChatModelChoices | undefined): [string | undefined, (model: string) => void] {
  // Read from storage on the client only (the server render has no choice yet).
  const stored = useSyncExternalStore(subscribe, remembered, () => null);

  const model = choices ? (choices.models.includes(stored ?? "") ? (stored as string) : choices.default) : undefined;

  const choose = useCallback(
    (next: string) => {
      if (!choices?.models.includes(next)) return;
      thisVisit = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // not remembered for the next visit
      }
      for (const listener of listeners) listener();
    },
    [choices],
  );
  return [model, choose];
}

/** Test helper: forgets the in-memory choice. */
export const resetUseModelForTests = () => {
  thisVisit = null;
};
