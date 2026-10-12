import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodPipe } from '../http/validation.js';
import { UsageService } from './usage.service.js';
import type { UsageRow } from './usage.types.js';

const querySchema = z.object({
  days: z
    .string()
    .regex(/^\d{1,2}$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1).max(90))
    .default(30),
});

@Controller('api/usage')
@UseGuards(AuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** The tokens the signed-in user has used over the last `days` days, by day, kind and model. */
  @Get()
  async summary(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(querySchema)) query: z.output<typeof querySchema>,
  ): Promise<{ days: number; rows: UsageRow[] }> {
    return { days: query.days, rows: await this.usage.summary(user, query.days) };
  }
}
