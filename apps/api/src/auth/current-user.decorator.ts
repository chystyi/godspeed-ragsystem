import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from './auth.types.js';

/** The user the AuthGuard authenticated. Only valid on guarded routes. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without AuthGuard');
  return user;
});
