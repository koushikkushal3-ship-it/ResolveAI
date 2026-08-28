import { createApp } from './app.js';
import { env, isGeminiConfigured, providerSummary } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`ResolveAI API listening on :${env.PORT} [${env.NODE_ENV}]`);
  console.log(`CORS origin: ${env.FRONTEND_URL}`);
  if (isGeminiConfigured) {
    const { gemini, groq, openrouter } = providerSummary;
    console.log(
      `LLM chain: ${gemini} Gemini -> ${groq} Groq -> ${openrouter} OpenRouter -> deterministic fallback`
    );
  } else {
    console.warn('No LLM provider key set - the agent will use its deterministic fallback.');
  }
});

// Render sends SIGTERM on redeploy. Draining in-flight requests avoids a
// visible 502 during the deploy window.
const shutdown = (signal) => () => {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
