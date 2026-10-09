import { Suspense } from "react";
import { DocumentList } from "@/components/document-list";
import { Panes, PanesFallback } from "@/components/panes";

// The signed-in area loads its data in the browser, so there is no content to prerender for
// instant navigation; opting out stops the dev-mode validation from reporting this layout.
export const instant = false;

export default function DocumentsLayout({ children }: LayoutProps<"/documents">) {
  return (
    <Suspense fallback={<PanesFallback />}>
      <Panes root="/documents" list={<DocumentList />}>
        {children}
      </Panes>
    </Suspense>
  );
}
