import type { Metadata } from "next";
import { NewChat } from "@/components/new-chat";

export const metadata: Metadata = { title: "Chat" };

// Filled in by the browser after sign-in; opting out keeps the dev-mode check for instant
// navigation from reporting this page (see the layout of this section).
export const instant = false;

export default function NewChatPage() {
  return <NewChat />;
}
