import { z } from 'zod';

/**
 * The contract for a model recommendation.
 *
 * Note what is NOT here: riskScore and riskLevel. Those come from
 * services/risk.js and are attached by the backend after the model returns.
 * Letting the model produce the number it is meant to be reasoning about would
 * make the product's most consequential output hallucinable, so it simply is
 * not part of the model's job.
 *
 * The schema is enforced twice — once as a responseSchema on the request, and
 * again with this parser on receipt. A model is not trusted to have honoured
 * its own schema.
 */

export const ACTION_TYPES = [
  'PRIORITY_DELIVERY',
  'ISSUE_CREDIT',
  'PRIORITY_DELIVERY_AND_CREDIT',
  'REFUND',
  'REPLACEMENT',
  'PAYMENT_RETRY',
  'PAYMENT_METHOD_UPDATE',
  'ACCOUNT_ADJUSTMENT',
  'NOTIFICATION_ONLY',
  'ESCALATE_TO_HUMAN',
];

/** Action types that can never auto-execute, whatever the model proposes. */
export const ALWAYS_HUMAN_ACTIONS = [
  'PAYMENT_RETRY',
  'PAYMENT_METHOD_UPDATE',
  'ACCOUNT_ADJUSTMENT',
  'REFUND',
];

export const recommendationSchema = z.object({
  incidentSummary: z
    .string()
    .min(10, 'incidentSummary is too short to be useful')
    .max(400, 'incidentSummary must stay under 400 characters'),

  riskFactorSummary: z.array(z.string().max(120)).max(8).default([]),

  recommendedAction: z.enum(ACTION_TYPES),

  creditAmount: z
    .number()
    .min(0)
    .max(100_000)
    .default(0)
    // Money must not arrive as a float with sub-rupee noise.
    .transform((n) => Math.round(n)),

  customerMessage: z
    .string()
    .min(20, 'customerMessage is too short')
    .max(700, 'customerMessage must stay under 700 characters'),

  requiresHumanApproval: z.boolean().default(false),

  policyReference: z.string().min(1).max(80),

  confidence: z.number().min(0).max(1),

  /**
   * One sentence of decision evidence — not chain-of-thought. The prompt asks
   * for a conclusion, and the length cap makes a reasoning dump impossible to
   * fit even if the model tried.
   */
  rationale: z.string().min(10).max(300),
});

/** Shape handed to Gemini as responseSchema (OpenAPI subset, not Zod). */
export const geminiResponseSchema = {
  type: 'object',
  properties: {
    incidentSummary: { type: 'string' },
    riskFactorSummary: { type: 'array', items: { type: 'string' } },
    recommendedAction: { type: 'string', enum: ACTION_TYPES },
    creditAmount: { type: 'number' },
    customerMessage: { type: 'string' },
    requiresHumanApproval: { type: 'boolean' },
    policyReference: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: [
    'incidentSummary',
    'recommendedAction',
    'creditAmount',
    'customerMessage',
    'requiresHumanApproval',
    'policyReference',
    'confidence',
    'rationale',
  ],
  propertyOrdering: [
    'incidentSummary',
    'riskFactorSummary',
    'recommendedAction',
    'creditAmount',
    'customerMessage',
    'requiresHumanApproval',
    'policyReference',
    'confidence',
    'rationale',
  ],
};

/** Grounded Q&A response for /api/agent/chat. */
export const chatResponseSchema = z.object({
  answer: z.string().min(1).max(1200),
  citedPolicies: z.array(z.string().max(80)).max(5).default([]),
  confidence: z.number().min(0).max(1),
});

export const geminiChatSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citedPolicies: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: ['answer', 'confidence'],
  propertyOrdering: ['answer', 'citedPolicies', 'confidence'],
};
