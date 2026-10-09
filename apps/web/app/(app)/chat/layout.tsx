import { Suspense } from "react";
import { ConversationList } from "@/components/conversation-list";
import { Panes, PanesFallback } from "@/components/panes";

// The signed-in area loads its data in the browser, so there is no content to prerender for
// instant navigation; opting out stops the dev-mode validation from reporting this layout.
export const instant = false;

export default function ChatLayout({ children }: LayoutProps<"/chat">) {
  return (
    <Suspense fallback={<PanesFallback />}>
      <Panes root="/chat" list={<ConversationList />}>
        {children}
      </Panes>
    </Suspense>
  );
}
