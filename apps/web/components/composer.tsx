"use client";

import { PaperPlaneRight, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";

export const MAX_QUESTION = 4000;

interface ComposerProps {
  busy: boolean;
  /** Resolves false when the question could not be sent, so the text can be put back. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  disabled?: boolean;
}

export function Composer({ busy, onSend, onStop, disabled }: ComposerProps) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const tooLong = text.length > MAX_QUESTION;
  const empty = text.trim() === "";

  // Grow with the text, up to a limit.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [text]);

  async function submit() {
    const question = text.trim();
    if (!question || busy || tooLong || disabled) return;
    setText("");
    const sent = await onSend(question);
    if (!sent) setText((current) => current || question); // nothing was lost
    field.current?.focus();
  }

  return (
    <div className="border-t border-line bg-canvas px-4 pb-4 pt-3 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 transition-colors duration-150 focus-within:border-ink">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            id="question"
            ref={field}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Ask about your documents"
            aria-invalid={tooLong || undefined}
            className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-ink placeholder:text-muted focus-visible:outline-none disabled:cursor-not-allowed"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop answering"
              title="Stop answering"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition duration-150 hover:bg-subtle active:scale-[0.96]"
            >
              <Stop size={18} weight="fill" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={empty || tooLong || disabled}
              aria-label="Send question"
              title="Send question"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-ink text-white transition duration-150 hover:bg-[#333333] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink"
            >
              <PaperPlaneRight size={18} weight="bold" aria-hidden />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
          <span className="hidden items-center gap-1.5 sm:flex">
            <Kbd>Enter</Kbd> to send <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
          </span>
          {text.length > MAX_QUESTION - 500 && (
            <span role={tooLong ? "alert" : undefined} className={tooLong ? "text-red-ink" : undefined}>
              {text.length.toLocaleString("en-US")} / {MAX_QUESTION.toLocaleString("en-US")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
