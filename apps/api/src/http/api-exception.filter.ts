import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiError } from '@kb/shared';
import type { Response } from 'express';
import { AiProviderError } from '../ai/errors.js';
import { ConversationNotFoundError } from '../chat/chat.repository.js';
import { DocumentNotFoundError } from '../documents/errors.js';
import { ValidationFailedError } from './validation.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  429: 'too_many_requests',
};

export interface Mapped {
  status: number;
  body: ApiError;
}

/** One error format for everything, including errors raised by the framework. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.map(exception);
    response.status(status).json(body);
  }

  /** What the client should see for any error (also used when a stream is already open). */
  map(exception: unknown): Mapped {
    if (exception instanceof ValidationFailedError) {
      return {
        status: 422,
        body: { code: 'validation_error', message: exception.message, details: exception.issues },
      };
    }
    if (exception instanceof DocumentNotFoundError) {
      return { status: 404, body: { code: 'document_not_found', message: 'document not found' } };
    }
    if (exception instanceof ConversationNotFoundError) {
      return { status: 404, body: { code: 'conversation_not_found', message: 'conversation not found' } };
    }
    if (exception instanceof AiProviderError) {
      return this.mapAiError(exception);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = this.messageOf(exception);
      return { status, body: { code: CODE_BY_STATUS[status] ?? 'http_error', message } };
    }
    // Errors from the body parser carry their own status (413 too large, 400 bad JSON).
    const status = (exception as { status?: unknown; statusCode?: unknown } | null)?.status ??
      (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = status === 413 ? 'request body too large' : 'malformed request';
      return { status, body: { code: CODE_BY_STATUS[status] ?? 'bad_request', message } };
    }
    this.logger.error('unhandled error', (exception as Error)?.stack ?? String(exception));
    return { status: 500, body: { code: 'internal_error', message: 'internal server error' } };
  }

  private messageOf(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : exception.message;
  }

  private mapAiError(error: AiProviderError): Mapped {
    this.logger.error(`AI provider error (${error.kind}): ${error.message}`);
    // Our own provider credentials or bugs are not the caller's business.
    if (error.kind === 'rate_limited') {
      return { status: 429, body: { code: 'ai_rate_limited', message: 'the AI provider is busy, try again shortly' } };
    }
    if (error.kind === 'unavailable') {
      return { status: 503, body: { code: 'ai_unavailable', message: 'the AI provider is unavailable' } };
    }
    return { status: 502, body: { code: 'ai_error', message: 'the AI provider returned an error' } };
  }
}
