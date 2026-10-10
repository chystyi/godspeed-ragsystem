"use client";

import { ArrowLeft, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Composer } from "@/components/composer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MessageView, PendingView } from "@/components/message-view";
import { Alert } from "@/components/ui/alert";
import { IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { ApiRequestError, describeError } from "@/lib/errors";
import { useConversation, useDocuments } from "@/lib/hooks";
import { useChat } from "@/lib/use-chat";

interface ChatViewProps {
  conversationId: string | null;
  /** Called once the first answer of a conversation that this view created has been saved. */
  onConversationCreated?: (id: string) => void;
}

/** A conversation, or (without an id) the empty page where a new one begins. */
export function ChatView({ conversationId, onConversationCreated }: ChatViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const chat = useChat({
    initialConversationId: conversationId,
    onExchangeSaved: async (id) => {
      await Promise.all([mutate(["conversation", id]), mutate("conversations")]);
      if (conversationId === null) onConversationCreated?.(id);
    },
  });

  // Next.js keeps pages you left alive, so leaving does not unmount this view. An answer still being
  // written is of no use to someone who has gone elsewhere, and it still costs money: stop it.
  const leftChat = !(pathname === "/chat" || pathname.startsWith("/chat/"));
  useEffect(() => {
    if (leftChat) chat.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the moment of leaving matters
  }, [leftChat]);
  const { data: conversation, error: loadError, isLoading } = useConversation(chat.conversationId);
  const { data: documents } = useDocuments();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Keep the newest text in view, unless the reader scrolled up to look at something.
  const thread = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  const stored = conversation?.messages.length ?? 0;
  useEffect(() => {
    const element = thread.current;
    if (element && followEnd.current) element.scrollTop = element.scrollHeight;
  }, [stored, chat.pending?.answer, chat.pending?.status]);

  const empty = stored === 0 && !chat.pending && !isLoading;
  const noDocuments = documents?.length === 0;
  const gone = loadError instanceof ApiRequestError && loadError.status === 404;

  async function remove() {
    if (!chat.conversationId) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.deleteConversation(chat.conversationId);
      await mutate("conversations");
      router.replace("/chat");
    } catch (failure) {
      setDeleteError(describeError(failure));
      setConfirming(false);
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-14 items-center gap-2 border-b border-line px-4 sm:px-6">
        <Link href="/chat" aria-label="All conversations" className="-ml-2 inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink md:hidden">
          <ArrowLeft size={18} weight="bold" aria-hidden />
        </Link>
        <h2 className="min-w-0 flex-1 truncate font-serif text-xl tracking-[-0.01em] text-ink">
          {conversation?.title ?? "New chat"}
        </h2>
        {conversation && (
          <IconButton
            label="Delete conversation"
            onClick={() => {
              setDeleteError(null); // a new attempt starts without the previous failure on screen
              setConfirming(true);
            }}
            disabled={chat.busy}
          >
            <Trash size={18} weight="bold" aria-hidden />
          </IconButton>
        )}
      </div>

      <div
        ref={thread}
        onScroll={(event) => {
          const element = event.currentTarget;
          followEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {isLoading && (
            <div aria-busy="true" aria-label="Loading conversation" className="flex flex-col gap-4">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {gone && <Alert>{describeError(new ApiRequestError(404, "conversation_not_found", ""))}</Alert>}
          {loadError && !gone && <Alert>{describeError(loadError)}</Alert>}

          {empty && !gone && (
            <div className="rise py-16 text-center">
              <p className="font-serif text-4xl leading-[1.1] tracking-[-0.03em] text-ink">Ask your documents</p>
              <p className="mx-auto mt-3 max-w-md text-muted">
                {noDocuments
                  ? "You have no documents yet. Add one first, then come back and ask about it."
                  : "Answers come only from what you have written, with the passages they are based on."}
              </p>
              {noDocuments && (
                <Link href="/documents/new" className="mt-5 inline-block text-sm font-medium text-ink underline underline-offset-4">
                  Write a document
                </Link>
              )}
            </div>
          )}

          {conversation?.messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}
          {chat.pending && <PendingView pending={chat.pending} />}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {chat.busy ? "Writing the answer" : ""}
      </p>

      <div>
        {(chat.error || deleteError) && (
          <div className="mx-auto max-w-3xl px-4 pb-3 sm:px-6">
            <Alert>{chat.error ?? deleteError}</Alert>
          </div>
        )}
        <Composer busy={chat.busy} onSend={chat.send} onStop={chat.stop} disabled={gone} />
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete this conversation?"
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        All its questions and answers will be removed. Your documents stay as they are.
      </ConfirmDialog>
    </div>
  );
}
