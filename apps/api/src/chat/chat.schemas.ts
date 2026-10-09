import { z } from 'zod';

export const createConversationSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional() })
  .strict();

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .refine((value) => value.trim() !== '', 'must not be blank')
      .max(4000),
  })
  .strict();

export type CreateConversationDto = z.output<typeof createConversationSchema>;
export type SendMessageDto = z.output<typeof sendMessageSchema>;
