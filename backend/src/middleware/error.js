import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { isProduction } from '../config/env.js';

/** 404 handler for unmatched routes. Registered after every route. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

/**
 * Terminal error handler.
 *
 * Two paths, deliberately:
 *   - expected errors (HttpError, ZodError) return their own message
 *   - everything else returns a generic 500, with the real error logged
 *     server-side only
 *
 * The second path is the important one. A database error message can contain a
 * column list, a constraint name, or a connection string; a stack trace can
 * contain filesystem paths. None of that belongs in an HTTP response.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies the handler by arity.
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Body parser rejected malformed JSON or an oversized payload.
  if (err?.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res
      .status(400)
      .json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' } });
  }

  console.error('[unhandled]', {
    method: req.method,
    path: req.originalUrl,
    message: err?.message,
    stack: isProduction ? undefined : err?.stack,
  });

  const isDbError = err?.isDatabaseError === true;
  return res.status(isDbError ? 503 : 500).json({
    error: {
      code: isDbError ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
      message: isDbError
        ? 'The database is temporarily unreachable. Please retry.'
        : 'Something went wrong. Please try again.',
    },
  });
}

/**
 * Wrap an async route handler so a rejected promise reaches errorHandler.
 * Express 5 forwards rejections automatically, but this keeps the intent
 * explicit and makes the handlers safe to reuse if that ever changes.
 * @param {Function} fn
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
