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

  // Up to three Gemini keys. Extras are rotated to on a quota error, which is
  // the practical answer to a free-tier limit landing mid-demo. Every key is
  // still Google Gemini, so this stays inside the assignment stack.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_API_KEY_3: z.string().optional(),
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
 * Configured Gemini keys, in rotation order. Blank entries are dropped, so a
 * half-filled .env degrades to however many keys are actually present rather
 * than failing on an empty string.
 */
export const geminiKeys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3]
  .map((k) => k?.trim())
  .filter(Boolean);

/** True when at least one key is configured. False routes the agent to its fallback. */
export const isGeminiConfigured = geminiKeys.length > 0;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
