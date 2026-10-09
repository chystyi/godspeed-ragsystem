import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DocumentNotFoundError } from '../documents/errors.js';

export interface FieldIssue {
  path: string;
  message: string;
}

export class ValidationFailedError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super('request validation failed');
    this.name = 'ValidationFailedError';
  }
}

/** Validates a request part with a zod schema. Error details never repeat the submitted values. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new ValidationFailedError(
        result.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(body)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is "not found", same as an unknown or foreign one: no information leaks. */
@Injectable()
export class DocumentIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new DocumentNotFoundError(value);
    return value.toLowerCase();
  }
}
