import type { Metadata } from "next";
import { Suspense } from "react";
import { ExistingDocumentEditor } from "@/components/document-editor";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Edit document" };

/** The id is only known at request time, so reading it sits behind its own loading state. */
async function Editor({ params }: Pick<PageProps<"/documents/[id]">, "params">) {
  const { id } = await params;
  return <ExistingDocumentEditor id={id} />;
}

export default function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-64 max-w-3xl" />}>
      <Editor params={params} />
    </Suspense>
  );
}
