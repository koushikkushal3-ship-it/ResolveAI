import { z } from 'zod';
import { paginationSchema, sortSchema, searchSchema, boolish } from './common.js';
import { ACTION_TYPES } from '../agent/schema.js';

export const ACTION_STATUSES = ['PROPOSED', 'APPROVED', 'EXECUTED', 'REJECTED', 'ESCALATED', 'FAILED'];

export const listActionsQuery = paginationSchema
  .merge(sortSchema(['created_at', 'amount', 'status'], 'created_at'))
  .merge(searchSchema)
  .extend({
    status: z.enum(ACTION_STATUSES).optional(),
    customerId: z.string().uuid().optional(),
    incidentId: z.string().uuid().optional(),
    mine: boolish.optional(),
  });

export const rejectActionBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason for rejecting').max(300).optional(),
});

export const createActionBody = z.object({
  customerId: z.string().uuid(),
  incidentId: z.string().uuid().nullable().optional(),
  actionType: z.enum(ACTION_TYPES),
  reason: z.string().trim().min(5).max(300),
  amount: z.number().min(0).max(10_000).default(0),
  customerMessage: z.string().trim().min(20).max(700).optional(),
  policyReference: z.string().trim().min(1).max(80).optional(),
});
