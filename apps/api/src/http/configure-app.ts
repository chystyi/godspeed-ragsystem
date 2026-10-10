import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from './api-exception.filter.js';

/** Largest JSON body: documents can be 200 000 characters (up to 4 bytes each in UTF-8). */
export const MAX_BODY = '2mb';

/**
 * Settings shared by the real server and the tests, so tests exercise the real behaviour.
 * The application must be created with `{ bodyParser: false }`.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by'); // no need to announce the framework
  express.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Responses hold one user's private data; an answer stream sets its own cache header.
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  express.useBodyParser('json', { limit: MAX_BODY });
  app.useGlobalFilters(new ApiExceptionFilter());
}
