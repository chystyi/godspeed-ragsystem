import { z } from 'zod';
import { isStorableText } from '../text.js';

const STORABLE = 'contains characters that cannot be stored';

export const createConversationSchema = z
  .object({ title: z.string().trim().min(1).max(200).refine(isStorableText, STORABLE).optional() })
  .strict();

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .refine((value) => value.trim() !== '', 'must not be blank')
      .max(4000)
      .refine(isStorableText, STORABLE),
  })
  .strict();

export type CreateConversationDto = z.output<typeof createConversationSchema>;
export type SendMessageDto = z.output<typeof sendMessageSchema>;
