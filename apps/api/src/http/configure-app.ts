import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './api-exception.filter.js';

/** Largest JSON body: documents can be 200 000 characters (up to 4 bytes each in UTF-8). */
export const MAX_BODY = '2mb';

/**
 * Settings shared by the real server and the tests, so tests exercise the real behaviour.
 * The application must be created with `{ bodyParser: false }`.
 */
export function configureApp(app: INestApplication): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: MAX_BODY });
  app.useGlobalFilters(new ApiExceptionFilter());
}
