import { z } from 'zod';
import { isStorableText } from '../text.js';

const STORABLE = 'contains characters that cannot be stored';

const title = z.string().trim().min(1).max(200).refine(isStorableText, STORABLE);
const content = z
  .string()
  .refine((value) => value.trim() !== '', 'must not be blank')
  .max(200000)
  .refine(isStorableText, STORABLE);
const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(40).refine(isStorableText, STORABLE))
  .max(20)
  .transform((list) => [...new Set(list)]);

export const createDocumentSchema = z
  .object({ title, content, tags: tags.default([]) })
  .strict();

export const updateDocumentSchema = z
  .object({ title: title.optional(), content: content.optional(), tags: tags.optional() })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'provide at least one field to change');

export type CreateDocumentDto = z.output<typeof createDocumentSchema>;
export type UpdateDocumentDto = z.output<typeof updateDocumentSchema>;
