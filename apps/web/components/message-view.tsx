"use client";

import type { ChatMessage, ChatSource } from "@kb/shared";
import { useState } from "react";
import { AnswerText } from "@/components/answer-text";
import { SourceList } from "@/components/source-list";
import type { PendingExchange } from "@/lib/use-chat";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-subtle px-4 py-2.5 text-[15px] leading-7 text-ink">
        {text}
      </p>
    </div>
  );
}

function Answer({
  text,
  sources,
  streaming,
  note,
}: {
  text: string;
  sources: ChatSource[];
  streaming?: boolean;
  note?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="max-w-[44rem]">
      <div className={streaming ? "caret" : undefined}>
        <AnswerText text={text} sources={sources} onCite={(number) => setSelected((current) => (current === number ? null : number))} />
      </div>
      {note && <p className="mt-2 text-[13px] text-muted">{note}</p>}
      {!streaming && <SourceList sources={sources} selected={selected} onSelect={setSelected} />}
    </div>
  );
}

export function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") return <UserBubble text={message.content} />;
  return <Answer text={message.content} sources={message.sources ?? []} />;
}

const NOTES: Partial<Record<PendingExchange["status"], string>> = {
  interrupted: "The answer was interrupted. Nothing was saved.",
  stopped: "Stopped. Nothing was saved.",
};

/** The exchange in progress: the question, and the answer as it is written. */
export function PendingView({ pending }: { pending: PendingExchange }) {
  const live = pending.status === "waiting" || pending.status === "streaming";
  return (
    <>
      <UserBubble text={pending.question} />
      {pending.status === "waiting" ? (
        <p className="caret text-[15px] leading-7 text-muted">Looking through your documents</p>
      ) : (
        <Answer
          text={pending.answer}
          sources={pending.sources ?? []}
          streaming={live}
          note={NOTES[pending.status]}
        />
      )}
    </>
  );
}
