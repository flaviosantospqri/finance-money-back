import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  const requestLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(
      /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi,
      ':id',
    );
    const requestId = req.get('Rndr-Id') ?? req.get('cf-ray');
    const requestLabel = `${req.method} ${path}${requestId ? ` requestId=${requestId}` : ''}`;
    const startedAt = Date.now();

    requestLogger.log(`Incoming ${requestLabel}`);
    res.once('finish', () => {
      requestLogger.log(
        `Completed ${requestLabel} status=${res.statusCode} durationMs=${Date.now() - startedAt}`,
      );
    });
    next();
  });
  const allowedOrigins = [
    'http://localhost:5173',
    'https://finance-money-front.vercel.app',
    ...(process.env.FRONTEND_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];
  app.enableCors({ origin: [...new Set(allowedOrigins)] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
