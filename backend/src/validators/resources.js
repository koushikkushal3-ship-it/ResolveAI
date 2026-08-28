import { z } from 'zod';
import { paginationSchema, sortSchema, searchSchema, boolish } from './common.js';

export const SEGMENTS = ['PREMIUM', 'STANDARD', 'NEW'];
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
export const INCIDENT_TYPES = [
  'DELIVERY_DELAY',
  'PAYMENT_FAILURE',
  'INVENTORY_SHORTAGE',
  'ORDER_CANCELLED',
  'SUBSCRIPTION_ISSUE',
];
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const INCIDENT_STATUSES = ['OPEN', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'ARCHIVED'];
export const ORDER_STATUSES = [
  'PLACED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT',
  'DELAYED', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED',
];
export const POLICY_CATEGORIES = [
  'SHIPPING', 'PREMIUM_CUSTOMER', 'REFUND', 'CANCELLATION',
  'PAYMENT_FAILURE', 'COMPENSATION', 'ESCALATION', 'PRIVACY',
];

// --- customers ---------------------------------------------------------------
export const listCustomersQuery = paginationSchema
  .merge(sortSchema(['name', 'lifetime_value', 'created_at', 'segment'], 'name'))
  .merge(searchSchema)
  .extend({
    segment: z.enum(SEGMENTS).optional(),
    riskLevel: z.enum(RISK_LEVELS).optional(),
  });

// --- orders ------------------------------------------------------------------
export const listOrdersQuery = paginationSchema
  .merge(sortSchema(['created_at', 'amount', 'status'], 'created_at'))
  .merge(searchSchema)
  .extend({
    customerId: z.string().uuid().optional(),
    status: z.enum(ORDER_STATUSES).optional(),
  });

/**
 * Orders are simulated upstream records, so only the operational fields a
 * support agent can legitimately influence are writable. Amount and customer
 * are deliberately absent.
 */
export const updateOrderBody = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    currentEta: z.string().datetime({ offset: true }).optional(),
    priority: z.enum(['STANDARD', 'EXPRESS', 'PRIORITY']).optional(),
    carrier: z.string().trim().min(2).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

// --- incidents ---------------------------------------------------------------
export const listIncidentsQuery = paginationSchema
  .merge(sortSchema(['started_at', 'severity', 'created_at'], 'started_at'))
  .merge(searchSchema)
  .extend({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    type: z.enum(INCIDENT_TYPES).optional(),
    mine: boolish.optional(),
  });

export const createIncidentBody = z.object({
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(SEVERITIES).default('MEDIUM'),
  title: z.string().trim().min(5, 'Give the incident a descriptive title').max(160),
  description: z.string().trim().max(2000).optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
});

export const updateIncidentBody = z
  .object({
    title: z.string().trim().min(5).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(['OPEN', 'INVESTIGATING', 'MITIGATING', 'RESOLVED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

// --- knowledge ---------------------------------------------------------------
export const listKnowledgeQuery = paginationSchema.merge(searchSchema).extend({
  category: z.enum(POLICY_CATEGORIES).optional(),
  includeInactive: boolish.optional(),
});

export const createKnowledgeBody = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens'),
  title: z.string().trim().min(5).max(160),
  category: z.enum(POLICY_CATEGORIES),
  version: z.string().trim().max(16).optional(),
  content: z.string().trim().min(40, 'A policy needs enough text to be actionable').max(8000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateKnowledgeBody = z
  .object({
    title: z.string().trim().min(5).max(160).optional(),
    category: z.enum(POLICY_CATEGORIES).optional(),
    version: z.string().trim().max(16).optional(),
    content: z.string().trim().min(40).max(8000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

// --- analytics ---------------------------------------------------------------
export const trendsQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(14),
});
