export const LIMITS = { title: 200, content: 200000, tags: 20, tag: 40 } as const;

/** "AI, rag ,, ai" -> ["ai", "rag"]: trimmed, lower case, no empties, no duplicates (as the API does). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export interface DocumentFormValues {
  title: string;
  tags: string;
  content: string;
}

export type FormErrors = Partial<Record<keyof DocumentFormValues, string>>;

export function validateDocumentForm(values: DocumentFormValues): FormErrors {
  const errors: FormErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = "Give the document a title.";
  else if (title.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;

  if (!values.content.trim()) errors.content = "Write something in the document.";
  else if (values.content.length > LIMITS.content) {
    errors.content = `This is ${values.content.length - LIMITS.content} characters over the limit of ${LIMITS.content}.`;
  }

  const tags = parseTags(values.tags);
  if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;
  else if (tags.some((tag) => tag.length > LIMITS.tag)) errors.tags = `Keep each tag under ${LIMITS.tag} characters.`;
  return errors;
}

/** True when the form differs from the saved document, ignoring harmless formatting of tags. */
export function isDirty(values: DocumentFormValues, saved: { title: string; tags: string[]; content: string }): boolean {
  return (
    values.title.trim() !== saved.title ||
    values.content !== saved.content ||
    parseTags(values.tags).join(",") !== saved.tags.join(",")
  );
}
