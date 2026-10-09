import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadRootEnv } from './config/load-env.js';

async function bootstrap() {
  loadRootEnv();
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();
