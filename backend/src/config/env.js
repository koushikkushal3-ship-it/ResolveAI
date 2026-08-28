import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment contract.
 *
 * Parsed once at boot. If a required secret is missing the process refuses to
 * start — a server that runs with a half-configured auth or database layer is
 * worse than one that does not run at all.
 *
 * GEMINI_API_KEY is deliberately optional: the agent has a deterministic
 * fallback, so the product must remain demonstrable without AI credentials.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  SUPABASE_URL: z.string().min(1, 'SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters — generate one with crypto.randomBytes(48)'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // GEMINI_API_KEY plus any number of GEMINI_API_KEY_<n>. Discovered
  // dynamically below rather than declared one per key.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),

  FRONTEND_URL: z.string().min(1).default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Print which variables are wrong, never their values.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error('Copy backend/.env.example to backend/.env and fill it in.\n');
  process.exit(1);
}

export const env = parsed.data;

/**
 * Configured Gemini keys, in rotation order: GEMINI_API_KEY first, then
 * GEMINI_API_KEY_2, _3, ... in numeric order.
 *
 * Discovered by scanning the environment rather than declared one variable per
 * key, so adding an eleventh key needs no code change. Blanks and duplicates
 * are dropped — a duplicate key would waste a rotation step retrying quota
 * that is already exhausted.
 */
export const geminiKeys = (() => {
  const numbered = Object.keys(process.env)
    .map((name) => /^GEMINI_API_KEY_(\d+)$/.exec(name))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => process.env[m[0]]);

  return [...new Set([env.GEMINI_API_KEY, ...numbered].map((k) => k?.trim()).filter(Boolean))];
})();

/** True when at least one key is configured. False routes the agent to its fallback. */
export const isGeminiConfigured = geminiKeys.length > 0;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
