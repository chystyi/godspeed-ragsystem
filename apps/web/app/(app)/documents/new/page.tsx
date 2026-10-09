import type { Metadata } from "next";
import { NewDocumentEditor } from "@/components/document-editor";

export const metadata: Metadata = { title: "New document" };

export default function NewDocumentPage() {
  return <NewDocumentEditor />;
}
