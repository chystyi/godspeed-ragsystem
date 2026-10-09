import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

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

/**
 * A malformed id is "not found", exactly like an unknown or foreign one: no information
 * leaks, and the database never sees a value it would reject with an error.
 */
export class UuidPipe implements PipeTransform<string, string> {
  constructor(private readonly notFound: (id: string) => Error) {}

  transform(value: string): string {
    if (!UUID.test(value)) throw this.notFound(value);
    return value.toLowerCase();
  }
}
