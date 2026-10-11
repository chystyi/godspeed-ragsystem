import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { ChatService } from './chat.service.js';

/** The chat models a user may pick from (set by AI_CHAT_MODEL and AI_CHAT_MODELS). */
@Controller('api/models')
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(): { default: string; models: string[] } {
    return this.chat.availableModels();
  }
}
