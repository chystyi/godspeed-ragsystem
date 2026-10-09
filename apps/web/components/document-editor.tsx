"use client";

import type { KbDocument } from "@kb/shared";
import { ArrowClockwise, ArrowLeft, Check, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextArea, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type DocumentFormValues, type FormErrors, isDirty, LIMITS, parseTags, validateDocumentForm } from "@/lib/document-form";
import { ApiRequestError, describeError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";
import { useDocument } from "@/lib/hooks";

const EMPTY: DocumentFormValues = { title: "", tags: "", content: "" };

const toValues = (doc: KbDocument): DocumentFormValues => ({
  title: doc.title,
  tags: doc.tags.join(", "),
  content: doc.content,
});

export function NewDocumentEditor() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  // Next.js keeps a page you navigated away from (hidden), so this form would come back
  // filled with the last document. A new key after saving gives the next visit a blank form.
  const [formKey, setFormKey] = useState(0);
  return (
    <DocumentForm
      key={formKey}
      saved={null}
      initial={EMPTY}
      onSave={async (values) => {
        const created = await api.createDocument({
          title: values.title.trim(),
          content: values.content,
          tags: parseTags(values.tags),
        });
        await mutate("documents");
        setFormKey((key) => key + 1);
        router.replace(`/documents/${created.id}`);
        return created;
      }}
    />
  );
}

export function ExistingDocumentEditor({ id }: { id: string }) {
  const router = useRouter();
  const { mutate: refreshAll } = useSWRConfig();
  const { data: doc, error, isLoading, mutate } = useDocument(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10" aria-busy="true" aria-label="Loading document">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 h-10 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (error || !doc) {
    const gone = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Alert>{gone ? describeError(new ApiRequestError(404, "document_not_found", "")) : describeError(error)}</Alert>
        <Link href="/documents" className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4">
          Back to documents
        </Link>
      </div>
    );
  }

  const store = async (updated: KbDocument) => {
    await mutate(updated, { revalidate: false });
    await refreshAll("documents");
    return updated;
  };

  return (
    <DocumentForm
      key={doc.id}
      saved={doc}
      initial={toValues(doc)}
      onSave={async (values) =>
        store(
          await api.updateDocument(doc.id, {
            title: values.title.trim(),
            content: values.content,
            tags: parseTags(values.tags),
          }),
        )
      }
      onReindex={async () => store(await api.reindexDocument(doc.id))}
      onDelete={async () => {
        await api.deleteDocument(doc.id);
        await refreshAll("documents");
        router.replace("/documents");
      }}
    />
  );
}

interface DocumentFormProps {
  saved: KbDocument | null;
  initial: DocumentFormValues;
  onSave: (values: DocumentFormValues) => Promise<KbDocument>;
  onReindex?: () => Promise<KbDocument>;
  onDelete?: () => Promise<void>;
}

function DocumentForm({ saved: initialSaved, initial, onSave, onReindex, onDelete }: DocumentFormProps) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initialSaved);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = saved ? isDirty(values, saved) : values.title !== "" || values.content !== "" || values.tags !== "";

  // Warn before the tab is closed with unsaved text.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const change = (field: keyof DocumentFormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save() {
    const found = validateDocumentForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await onSave(values);
      setSaved(result);
      setValues(toValues(result));
      setJustSaved(true);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  async function reindex() {
    if (!onReindex) return;
    setReindexing(true);
    setFailure(null);
    try {
      setSaved(await onReindex());
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setReindexing(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      setConfirming(false);
      setFailure(describeError(error));
      setDeleting(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="rise mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <Link href="/documents" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink md:hidden">
        <ArrowLeft size={16} weight="bold" aria-hidden />
        All documents
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-[-0.03em] text-ink">
          {saved ? "Edit document" : "New document"}
        </h1>
        {saved && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <StatusBadge status={saved.indexingStatus} />
            <span>
              Updated <time dateTime={saved.updatedAt}>{formatWhen(saved.updatedAt)}</time>
            </span>
          </div>
        )}
      </div>

      {saved?.indexingStatus === "failed" && (
        <Alert
          action={
            <Button variant="secondary" className="h-8 shrink-0" busy={reindexing} onClick={reindex} disabled={dirty}>
              <ArrowClockwise size={16} weight="bold" aria-hidden />
              Try again
            </Button>
          }
        >
          Saved, but the document cannot be searched yet. {saved.indexingError ?? ""}
          {dirty && " Save your changes first, then try again."}
        </Alert>
      )}
      {failure && <Alert>{failure}</Alert>}

      <TextField
        label="Title"
        value={values.title}
        onChange={change("title")}
        error={errors.title}
        maxLength={LIMITS.title + 50}
        autoFocus={!saved}
        autoComplete="off"
      />
      <TextField
        label="Tags"
        value={values.tags}
        onChange={change("tags")}
        error={errors.tags}
        hint="Separate with commas, for example: router, home network."
        autoComplete="off"
      />
      <TextArea
        label="Text"
        value={values.content}
        onChange={change("content")}
        error={errors.content}
        className="min-h-[22rem] resize-y leading-7"
        hint={`${values.content.length.toLocaleString("en-US")} of ${LIMITS.content.toLocaleString("en-US")} characters`}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
          {saved ? "Save changes" : "Save document"}
        </Button>
        <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>S</Kbd>
        </span>
        <span role="status" aria-live="polite" className="flex items-center gap-1 text-sm text-green-ink">
          {justSaved && (
            <>
              <Check size={16} weight="bold" aria-hidden /> Saved
            </>
          )}
        </span>
        {onDelete && (
          <Button variant="danger" className="ml-auto" onClick={() => setConfirming(true)}>
            <Trash size={16} weight="bold" aria-hidden />
            Delete
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete this document?"
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        “{saved?.title}” and its search index will be removed. This cannot be undone.
      </ConfirmDialog>
    </form>
  );
}
