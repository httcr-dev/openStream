import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3001',
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`OpenStream API em http://localhost:${port}/api/v1`);
}

void bootstrap();
