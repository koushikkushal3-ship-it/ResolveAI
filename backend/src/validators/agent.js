import { z } from 'zod';
import { TOOL_NAMES } from '../agent/tools.js';

export const analyzeBody = z.object({
  customerId: z.string().uuid(),
  incidentId: z.string().uuid(),
  force: z.boolean().default(false),
});

export const resolveBody = z.object({
  customerId: z.string().uuid(),
  incidentId: z.string().uuid(),
  /** Execute the cached recommendation without re-calling the model. */
  useCached: z.boolean().default(true),
});

export const chatBody = z.object({
  customerId: z.string().uuid(),
  incidentId: z.string().uuid().optional(),
  question: z.string().trim().min(3, 'Ask a question').max(500),
});

/**
 * Tool invocation. `tool` is an enum of the registry keys, not a free string —
 * an unknown name is rejected at validation, before it can reach dispatch.
 */
export const toolBody = z.object({
  tool: z.enum(TOOL_NAMES),
  args: z.record(z.string(), z.unknown()).default({}),
});
