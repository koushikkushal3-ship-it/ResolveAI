import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env, isGeminiConfigured } from './config/env.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';

export function createApp() {
  const app = express();

  // Render and Vercel both sit behind a proxy. Without this, every client
  // shares one IP as far as the rate limiter is concerned.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  // Exact origin only. A reflected origin would defeat the point of CORS.
  // credentials:false because the JWT travels in the Authorization header.
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Bounded body: nothing this API accepts is large, and an unbounded parser
  // is a free denial-of-service.
  app.use(express.json({ limit: '100kb' }));

  app.use(globalLimiter);

  // Liveness probe. Public, cheap, and the target for the uptime pinger that
  // keeps the Render free tier from cold-starting in front of a judge.
  app.get('/api/health', (req, res) => {
    res.json({
      data: {
        status: 'ok',
        service: 'resolveai-api',
        env: env.NODE_ENV,
        aiConfigured: isGeminiConfigured,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api/auth', authRouter);
  // Further routers mount here as each phase lands.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
