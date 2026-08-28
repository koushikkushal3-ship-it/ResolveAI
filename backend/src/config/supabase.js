import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Supabase client, service-role.
 *
 * This key bypasses Row Level Security. It exists only in this process and must
 * never be sent to a browser. All access control for the API is enforced in
 * middleware and the service layer — see docs/SECURITY.md.
 *
 * No session persistence: this is a stateless server, not a logged-in user.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Unwrap a supabase-js result, converting its error shape into a thrown Error.
 *
 * supabase-js returns `{ data, error }` rather than rejecting, which makes it
 * very easy to use a null `data` as if the query had succeeded. Routing every
 * query through here removes that whole class of bug.
 *
 * @template T
 * @param {{ data: T, error: { message: string, code?: string } | null }} result
 * @param {string} context Human-readable description used in the server-side log.
 * @returns {T}
 */
export function unwrap(result, context) {
  if (result.error) {
    const err = new Error(`${context}: ${result.error.message}`);
    err.cause = result.error;
    err.isDatabaseError = true;
    throw err;
  }
  return result.data;
}
