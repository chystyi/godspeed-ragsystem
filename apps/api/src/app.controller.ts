import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class AppController {
  /** Liveness probe: answers without touching the database or the AI provider. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
