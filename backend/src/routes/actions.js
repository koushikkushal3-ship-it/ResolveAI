import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uuidParam } from '../validators/common.js';
import { listActionsQuery, rejectActionBody, createActionBody } from '../validators/actions.js';
import { listActions, getAction, approveAction, rejectAction, createManualAction } from '../services/actions.js';
import { REASON_LABELS, AUTO_CREDIT_LIMIT, DAILY_CREDIT_CAP, CONFIDENCE_FLOOR } from '../services/guardrails.js';

export const actionsRouter = Router();

actionsRouter.use(authenticate);

actionsRouter.get(
  '/',
  validate({ query: listActionsQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await listActions({ ...req.query, actorId: req.user.id });
    res.json({ data, meta });
  })
);

/** The guardrail thresholds, so the UI explains limits with the real numbers. */
actionsRouter.get('/guardrails', (req, res) => {
  res.json({
    data: {
      autoCreditLimit: AUTO_CREDIT_LIMIT,
      dailyCreditCap: DAILY_CREDIT_CAP,
      confidenceFloor: CONFIDENCE_FLOOR,
      reasonLabels: REASON_LABELS,
    },
  });
});

actionsRouter.get(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await getAction(req.params.id) });
  })
);

actionsRouter.post(
  '/',
  validate({ body: createActionBody }),
  asyncHandler(async (req, res) => {
    const result = await createManualAction({ ...req.body, actor: req.user });
    res.status(201).json({ data: result });
  })
);

/**
 * Approve and reject are SUPERVISOR+.
 * The service additionally refuses when the approver proposed the action, and
 * the database enforces the same rule as a CHECK constraint.
 */
actionsRouter.post(
  '/:id/approve',
  requireRole('SUPERVISOR'),
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await approveAction(req.params.id, req.user) });
  })
);

actionsRouter.post(
  '/:id/reject',
  requireRole('SUPERVISOR'),
  validate({ params: uuidParam(), body: rejectActionBody }),
  asyncHandler(async (req, res) => {
    res.json({ data: await rejectAction(req.params.id, req.user, req.body.reason) });
  })
);
