import { z } from 'zod';

export const uuidParam = (key = 'id') =>
  z.object({ [key]: z.string().uuid('Invalid identifier') });

/** Query strings arrive as text, so everything here coerces. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Sort is an allow-list, never free text.
 * A raw sort column reaches the query builder, so anything not enumerated here
 * is rejected rather than passed through.
 *
 * @param {string[]} columns
 * @param {string} [fallback]
 */
export const sortSchema = (columns, fallback = columns[0]) =>
  z.object({
    sort: z.enum(columns).default(fallback),
    order: z.enum(['asc', 'desc']).default('desc'),
  });

/** Free-text search, length-capped and trimmed. */
export const searchSchema = z.object({
  search: z.string().trim().max(120).optional(),
});

/** Booleans arrive as "true"/"false" strings in a query. */
export const boolish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');
