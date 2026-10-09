import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadRootEnv } from './config/load-env.js';
import { configureApp } from './http/configure-app.js';

async function bootstrap() {
  loadRootEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();
