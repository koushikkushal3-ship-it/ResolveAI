/**
 * An error carrying an HTTP status and a client-safe message.
 *
 * Anything thrown that is NOT an HttpError is treated by the error middleware
 * as unexpected: it is logged in full server-side and replaced with a generic
 * 500 for the client. That default is what keeps stack traces, Postgres
 * messages and connection strings out of API responses.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code   Stable machine-readable code, e.g. 'INVALID_CREDENTIALS'.
   * @param {string} message Safe to show a user.
   * @param {unknown} [details] Optional structured detail (validation issues).
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

export const badRequest = (message, details) =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, 'FORBIDDEN', message);

export const notFound = (resource = 'Resource') =>
  new HttpError(404, 'NOT_FOUND', `${resource} not found`);

export const conflict = (message, details) => new HttpError(409, 'CONFLICT', message, details);

export const unprocessable = (message, details) =>
  new HttpError(422, 'UNPROCESSABLE', message, details);

export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  new HttpError(503, 'SERVICE_UNAVAILABLE', message);
