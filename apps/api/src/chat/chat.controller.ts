import type {
  Conversation,
  ConversationWithMessages,
  SendMessageResult,
} from '@kb/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UuidPipe, ZodPipe } from '../http/validation.js';
import {
  type CreateConversationDto,
  createConversationSchema,
  type SendMessageDto,
  sendMessageSchema,
} from './chat.schemas.js';
import { ConversationNotFoundError } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { RateLimitGuard } from './rate-limiter.js';

const conversationId = new UuidPipe((id) => new ConversationNotFoundError(id));

@Controller('api/conversations')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createConversationSchema)) body: CreateConversationDto,
  ): Promise<Conversation> {
    return this.chat.createConversation(user, body.title);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Conversation[]> {
    return this.chat.listConversations(user);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', conversationId) id: string,
  ): Promise<ConversationWithMessages> {
    return this.chat.getConversation(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', conversationId) id: string): Promise<void> {
    return this.chat.deleteConversation(user, id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @UseGuards(RateLimitGuard)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', conversationId) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: SendMessageDto,
  ): Promise<SendMessageResult> {
    return this.chat.ask(user, id, body.content);
  }
}
