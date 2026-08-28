import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { asyncHandler } from './error.js';

/** Role hierarchy. A higher rank satisfies every requirement at or below it. */
const RANK = { AGENT: 1, SUPERVISOR: 2, ADMIN: 3 };

/**
 * Sign a session token.
 * The payload carries identity and role only — never a password hash, never
 * anything the client should not be able to read, since a JWT is signed but
 * not encrypted.
 *
 * @param {{ id: string, email: string, role: string }} user
 */
export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * Verify the bearer token and attach the CURRENT user row to the request.
 *
 * The database read on every request is deliberate. A token is valid for hours;
 * without re-reading, a deactivated account or a demoted role would keep its
 * old privileges until the token expired. Correctness beats one indexed
 * primary-key lookup.
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    // Distinguish expiry (the client should re-login) from tampering.
    // Never log the token itself.
    throw unauthorized(
      err.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid token'
    );
  }

  const { data: user, error } = await supabase
    .from('app_users')
    .select('id, email, full_name, role, is_active')
    .eq('id', payload.sub)
    .maybeSingle();

  if (error) {
    const e = new Error(`auth lookup: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }
  if (!user) throw unauthorized('Account no longer exists');
  if (!user.is_active) throw forbidden('This account has been deactivated');

  req.user = user;
  next();
});

/**
 * Require a minimum role.
 *
 * Registered AFTER authenticate. Approve/reject and knowledge writes sit behind
 * SUPERVISOR; the frontend hides those controls for an AGENT, but that is a UX
 * affordance, not a control — this is where the decision is actually made.
 *
 * @param {'AGENT'|'SUPERVISOR'|'ADMIN'} minimum
 */
export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if ((RANK[req.user.role] ?? 0) < RANK[minimum]) {
      return next(forbidden(`This action requires the ${minimum} role or higher`));
    }
    next();
  };
}
