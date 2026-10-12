import type { Metadata } from "next";
import { NewDocumentEditor } from "@/components/document-editor";

export const metadata: Metadata = { title: "New document" };

// Shown after sign-in and filled in by the browser; opting out keeps the dev-mode check for
// instant navigation from reporting this page (see the layout of this section).
export const instant = false;

export default function NewDocumentPage() {
  return <NewDocumentEditor />;
}
