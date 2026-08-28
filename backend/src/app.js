import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env, isGeminiConfigured, isProduction, providerSummary } from './config/env.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { agentRouter } from './routes/agent.js';
import { actionsRouter } from './routes/actions.js';
import {
  customersRouter,
  ordersRouter,
  incidentsRouter,
  knowledgeRouter,
  analyticsRouter,
  simulatorRouter,
} from './routes/resources.js';

export function createApp() {
  const app = express();

  // Render and Vercel both sit behind a proxy. Without this, every client
  // shares one IP as far as the rate limiter is concerned.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  /**
   * CORS — an allow-list, not a reflection.
   *
   * FRONTEND_URL accepts a comma-separated list so one deployment can serve
   * both the hosted frontend and a developer running against it locally:
   *
   *   FRONTEND_URL=https://resolveai.vercel.app,http://localhost:5173
   *
   * Outside production, localhost is always permitted regardless of the
   * variable, so a fresh clone works before anything is configured.
   *
   * Every origin is matched exactly and echoed back only if it is on the list.
   * Reflecting an arbitrary Origin header would defeat the point of CORS.
   * credentials:false because the JWT travels in the Authorization header, not
   * a cookie.
   */
  const allowedOrigins = new Set(
    env.FRONTEND_URL.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean)
  );
  if (!isProduction) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: same-origin, curl, or a health check. Not a browser
        // cross-origin request, so there is nothing to authorise.
        if (!origin) return callback(null, true);
        const normalised = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalised)) return callback(null, true);
        // Reject by refusing the header rather than throwing, so the browser
        // reports a clean CORS failure instead of the API returning a 500.
        return callback(null, false);
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
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
        aiProviders: providerSummary,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/actions', actionsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/knowledge', knowledgeRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/simulator', simulatorRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
