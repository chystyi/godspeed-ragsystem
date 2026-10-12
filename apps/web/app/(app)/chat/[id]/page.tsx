import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Chat" };

async function Conversation({ params }: Pick<PageProps<"/chat/[id]">, "params">) {
  const { id } = await params;
  // Keyed by id so moving between conversations starts a fresh view.
  return <ChatView key={id} conversationId={id} />;
}

// Shown after sign-in and filled in by the browser; opting out keeps the dev-mode check for
// instant navigation from reporting this page (see the layout of this section).
export const instant = false;

export default function ConversationPage({ params }: PageProps<"/chat/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-64 max-w-3xl" />}>
      <Conversation params={params} />
    </Suspense>
  );
}
