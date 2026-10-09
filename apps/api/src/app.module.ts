import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [AiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
