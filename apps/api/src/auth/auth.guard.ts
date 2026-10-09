import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type AuthenticatedRequest, TOKEN_VERIFIER, type TokenVerifier } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
    if (!token) throw new UnauthorizedException('missing bearer token');
    const user = await this.verifier.verify(token);
    if (!user) throw new UnauthorizedException('invalid or expired token');
    request.user = user;
    return true;
  }
}
