import type { Metadata } from "next";
import { NewChat } from "@/components/new-chat";

export const metadata: Metadata = { title: "New chat" };

export default function NewChatPage() {
  return <NewChat />;
}
