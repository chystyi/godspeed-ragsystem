import type {
  ChatStreamEvent,
  Conversation,
  ConversationWithMessages,
  SendMessageResult,
} from '@kb/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExceptionFilter } from '../http/api-exception.filter.js';
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
  private readonly errors = new ApiExceptionFilter();

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

  /**
   * The same answer as a stream of server-sent events. Problems found before the first
   * event (token, ownership, validation, rate limit, a provider that rejects the request)
   * are ordinary JSON errors; a failure after that arrives as an `error` event.
   */
  @Post(':id/messages/stream')
  @UseGuards(RateLimitGuard)
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('id', conversationId) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const cancelled = new AbortController();
    // If the connection ends before we finished, stop work (and spending) on this answer.
    response.on('close', () => {
      if (!response.writableFinished) cancelled.abort();
    });

    const events = this.chat.askStream(user, id, body.content, cancelled.signal);
    const first = await events.next(); // throws: handled like any other request

    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // keep reverse proxies from holding the stream back
    });
    response.flushHeaders();

    const write = (event: ChatStreamEvent) => {
      if (!response.writableEnded) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    try {
      if (!first.done) write(first.value);
      for (let next = await events.next(); !next.done; next = await events.next()) write(next.value);
    } catch (error) {
      if (!cancelled.signal.aborted) {
        const { body: failure } = this.errors.map(error);
        write({ type: 'error', code: failure.code, message: failure.message });
      }
    } finally {
      response.end();
    }
  }
}
