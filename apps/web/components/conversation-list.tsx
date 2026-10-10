"use client";

import { Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";
import { useConversations } from "@/lib/hooks";

export function ConversationList() {
  const { data, error, isLoading, mutate } = useConversations();
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-5">
        <h1 className="font-serif text-3xl tracking-[-0.02em] text-ink">Chat</h1>
        {/* Its own address: "/chat" is the list on a phone, so linking there would change nothing. */}
        <Link
          href="/chat/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-white transition duration-150 hover:bg-[#333333] active:scale-[0.98]"
        >
          <Plus size={16} weight="bold" aria-hidden />
          New
        </Link>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
        {error && (
          <div className="px-4">
            <Alert action={<Button variant="ghost" className="h-7 px-2 text-red-ink" onClick={() => mutate()}>Retry</Button>}>
              {describeError(error)}
            </Alert>
          </div>
        )}
        {isLoading && (
          <ul className="flex flex-col gap-1 px-2" aria-busy="true" aria-label="Loading conversations">
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-2 py-3">
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))}
          </ul>
        )}
        {data && data.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted">Your conversations will appear here.</p>
        )}
        <ul className="flex flex-col px-2">
          {data?.map((conversation, index) => {
            const active = pathname === `/chat/${conversation.id}`;
            return (
              <li key={conversation.id} className="rise" style={{ "--index": Math.min(index, 8) } as React.CSSProperties}>
                <Link
                  href={`/chat/${conversation.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-baseline justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-subtle ${active ? "bg-subtle" : ""}`}
                >
                  <span className="truncate text-ink">{conversation.title}</span>
                  <time dateTime={conversation.updatedAt} className="shrink-0 font-mono text-[11px] text-muted">
                    {formatWhen(conversation.updatedAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
