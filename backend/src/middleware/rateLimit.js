import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isTest } from '../config/env.js';

const json = (code, message) => ({ error: { code, message } });

/**
 * Rate limiters.
 *
 * Disabled under NODE_ENV=test so the API suite can exercise failure paths
 * repeatedly without tripping a limiter — except the auth limiter, which has
 * its own test that must see a real 429.
 */
const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
};

/** Global ceiling. Generous: this protects the process, not a specific route. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: json('RATE_LIMITED', 'Too many requests. Please slow down.'),
});

/**
 * Login and registration. Tight, per IP, and NOT skipped in test — credential
 * stuffing is the attack this exists to stop, so it gets a real test.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: json('RATE_LIMITED', 'Too many authentication attempts. Try again in 15 minutes.'),
});

/**
 * Agent routes, keyed per user rather than per IP.
 *
 * This is a cost control as much as a security one: every call here can reach
 * Gemini, and the free tier is finite. An IP key would let one user behind a
 * shared NAT exhaust it for everyone.
 *
 * The anonymous fallback goes through ipKeyGenerator rather than raw req.ip:
 * an IPv6 client is typically handed a whole /64, so keying on the full address
 * would let it rotate through addresses and bypass the limit entirely.
 */
export const agentLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  message: json('RATE_LIMITED', 'Too many AI requests. Please wait before analyzing again.'),
});
