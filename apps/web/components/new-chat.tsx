"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatView } from "@/components/chat-view";

const inChat = (pathname: string) => pathname === "/chat" || pathname.startsWith("/chat/");

/**
 * The empty conversation where a new chat begins. When its first answer is saved, the
 * conversation opens at its own address (so a reload, the back button and the list all agree).
 */
export function NewChat() {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState(0);
  const created = useRef(false);
  const hidden = useRef(false);
  const current = useRef(pathname);
  useEffect(() => {
    current.current = pathname; // the callback below runs long after the render that made it
  });

  // Next.js keeps a page you navigated away from (hidden) and shows it again later. Once this view
  // holds a finished conversation, showing it again must start a blank one instead of the old one.
  // A draft that was never sent is kept: nothing was created.
  useEffect(() => {
    if (hidden.current && created.current) {
      created.current = false;
      setView((current) => current + 1);
    }
    hidden.current = false;
    return () => {
      hidden.current = true;
    };
  }, []);

  return (
    <ChatView
      key={view}
      conversationId={null}
      onConversationCreated={(id) => {
        created.current = true;
        // Someone who moved on while the answer was being written is not pulled back into the chat.
        if (inChat(current.current)) router.replace(`/chat/${id}`);
      }}
    />
  );
}
