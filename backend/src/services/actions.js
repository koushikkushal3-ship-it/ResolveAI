/**
 * Action lifecycle.
 *
 *   PROPOSED -> APPROVED -> EXECUTED
 *   PROPOSED -> REJECTED
 *   PROPOSED -> ESCALATED -> APPROVED | REJECTED
 *
 * Every state change writes an audit row, and every transition is checked
 * against the legal-transition table before it is attempted. The database
 * enforces the two invariants that matter most (executed_at only on EXECUTED,
 * approver never equals proposer) with CHECK constraints, so a bug here fails
 * loudly rather than corrupting the record.
 */
import { supabase, unwrap } from '../config/supabase.js';
import { evaluateGuardrails, canTransition, REASON_LABELS } from './guardrails.js';
import { sendCustomerNotification } from './notify.js';
import { audit } from '../utils/audit.js';
import { conflict, forbidden, notFound, badRequest } from '../utils/httpError.js';

const DAY_MS = 24 * 3_600_000;

/**
 * Credit already granted to this customer in the last 24 hours.
 * Counts APPROVED and EXECUTED only — a proposal that never executed did not
 * spend anything, and counting it would block legitimate later actions.
 *
 * @param {string} customerId
 */
export async function creditIssuedLast24h(customerId) {
  const rows = unwrap(
    await supabase
      .from('actions')
      .select('amount')
      .eq('customer_id', customerId)
      .in('status', ['APPROVED', 'EXECUTED'])
      .gt('amount', 0)
      .gte('created_at', new Date(Date.now() - DAY_MS).toISOString()),
    'credit window'
  );
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}

/**
 * Turn a recommendation into a persisted action, applying the guardrails.
 *
 * This is the only path from a recommendation to a row in `actions`. The
 * guardrail verdict is stored alongside, so the reason a case is waiting on a
 * human survives in the record rather than living only in the UI.
 *
 * @param {object} input
 * @param {string} input.customerId
 * @param {string|null} input.incidentId
 * @param {object} input.recommendation
 * @param {boolean} input.policyFound
 * @param {object} input.actor
 * @param {boolean} [input.execute=true] Execute immediately when allowed.
 */
export async function proposeAction({
  customerId,
  incidentId,
  recommendation,
  policyFound,
  actor,
  execute = true,
}) {
  const verdict = evaluateGuardrails({
    recommendation,
    policyFound,
    creditIssuedLast24h: await creditIssuedLast24h(customerId),
  });

  const status = verdict.escalate ? 'ESCALATED' : 'PROPOSED';

  const action = unwrap(
    await supabase
      .from('actions')
      .insert({
        customer_id: customerId,
        incident_id: incidentId,
        action_type: recommendation.recommendedAction,
        reason: recommendation.rationale,
        // The guardrail's amount, not the model's — escalation zeroes it.
        amount: verdict.amount,
        requires_approval: verdict.requiresApproval,
        status,
        policy_reference: recommendation.policyReference,
        confidence: recommendation.confidence ?? null,
        ai_generated: recommendation.aiGenerated ?? false,
        customer_message: recommendation.customerMessage,
        guardrail_result: {
          allowed: verdict.allowed,
          requiresApproval: verdict.requiresApproval,
          escalate: verdict.escalate,
          reasons: verdict.reasons,
          explanations: verdict.reasons.map((r) => REASON_LABELS[r] ?? r),
        },
        created_by: actor?.id ?? null,
      })
      .select('*')
      .single(),
    'create action'
  );

  await audit({
    actorType: recommendation.aiGenerated ? 'AI' : 'SYSTEM',
    actorId: actor?.id ?? null,
    action: 'action.proposed',
    entityType: 'action',
    entityId: action.id,
    metadata: {
      actionType: action.action_type,
      amount: verdict.amount,
      verdict: verdict.allowed ? 'auto' : verdict.escalate ? 'escalated' : 'needs_approval',
      reasons: verdict.reasons,
    },
  });

  if (verdict.allowed && execute) {
    return executeAction({ actionId: action.id, actor });
  }

  return { action, verdict };
}

/**
 * Perform the action's side effect and record the outcome.
 *
 * A failure here marks the row FAILED and surfaces the reason. It must never
 * report success for something that did not happen — a compensation the
 * customer never received, shown as delivered, is worse than no automation.
 *
 * @param {object} input
 * @param {string} input.actionId
 * @param {object} input.actor
 */
export async function executeAction({ actionId, actor }) {
  const action = unwrap(
    await supabase.from('actions').select('*').eq('id', actionId).maybeSingle(),
    'load action for execution'
  );
  if (!action) throw notFound('Action');

  if (!canTransition(action.status, 'EXECUTED')) {
    throw conflict(`An action with status ${action.status} cannot be executed`);
  }

  try {
    let notification = null;
    if (action.customer_message) {
      notification = await sendCustomerNotification({
        customerId: action.customer_id,
        incidentId: action.incident_id,
        message: action.customer_message,
        actorId: actor?.id ?? null,
      });
    }

    // Simulated side effects. Priority delivery moves the order's own fields so
    // the change is visible in Customer 360, not just asserted in a log.
    if (['PRIORITY_DELIVERY', 'PRIORITY_DELIVERY_AND_CREDIT'].includes(action.action_type)) {
      const link = unwrap(
        await supabase
          .from('customer_incidents')
          .select('order_id')
          .eq('customer_id', action.customer_id)
          .eq('incident_id', action.incident_id)
          .maybeSingle(),
        'find order for priority upgrade'
      );
      if (link?.order_id) {
        unwrap(
          await supabase
            .from('orders')
            .update({
              priority: 'PRIORITY',
              status: 'IN_TRANSIT',
              current_eta: new Date(Date.now() + DAY_MS).toISOString(),
            })
            .eq('id', link.order_id)
            .select('id'),
          'apply priority delivery'
        );
      }
    }

    const executed = unwrap(
      await supabase
        .from('actions')
        .update({ status: 'EXECUTED', executed_at: new Date().toISOString() })
        .eq('id', actionId)
        .select('*')
        .single(),
      'mark action executed'
    );

    // Close the loop on the customer_incident so the dashboard reflects it.
    if (action.incident_id) {
      await supabase
        .from('customer_incidents')
        .update({ status: 'RESOLVED' })
        .eq('customer_id', action.customer_id)
        .eq('incident_id', action.incident_id);
    }

    await audit({
      actorType: actor ? 'USER' : 'AI',
      actorId: actor?.id ?? null,
      action: 'action.executed',
      entityType: 'action',
      entityId: actionId,
      metadata: { actionType: action.action_type, amount: Number(action.amount), notified: Boolean(notification) },
    });

    return { action: executed, notification, verdict: action.guardrail_result };
  } catch (err) {
    unwrap(
      await supabase
        .from('actions')
        .update({ status: 'FAILED', failure_reason: String(err.message).slice(0, 300) })
        .eq('id', actionId)
        .select('id'),
      'mark action failed'
    );

    await audit({
      actorType: 'SYSTEM',
      actorId: actor?.id ?? null,
      action: 'action.failed',
      entityType: 'action',
      entityId: actionId,
      metadata: { error: String(err.message).slice(0, 300) },
    });

    throw err;
  }
}

/**
 * Approve a pending action, then execute it.
 *
 * @param {string} actionId
 * @param {object} actor Must be SUPERVISOR or ADMIN — enforced by route middleware.
 */
export async function approveAction(actionId, actor) {
  const action = unwrap(
    await supabase.from('actions').select('*').eq('id', actionId).maybeSingle(),
    'load action for approval'
  );
  if (!action) throw notFound('Action');

  // Separation of duties. Also a database CHECK constraint — this check exists
  // to return a clear 403 rather than a constraint violation.
  if (action.created_by && action.created_by === actor.id) {
    throw forbidden('You cannot approve an action you proposed yourself');
  }

  if (!canTransition(action.status, 'APPROVED')) {
    throw conflict(`An action with status ${action.status} cannot be approved`);
  }

  unwrap(
    await supabase
      .from('actions')
      .update({ status: 'APPROVED', approved_by: actor.id })
      .eq('id', actionId)
      .select('id')
      .single(),
    'approve action'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'action.approved',
    entityType: 'action',
    entityId: actionId,
    metadata: { actionType: action.action_type, amount: Number(action.amount) },
  });

  return executeAction({ actionId, actor });
}

/**
 * @param {string} actionId
 * @param {object} actor
 * @param {string} [reason]
 */
export async function rejectAction(actionId, actor, reason) {
  const action = unwrap(
    await supabase.from('actions').select('*').eq('id', actionId).maybeSingle(),
    'load action for rejection'
  );
  if (!action) throw notFound('Action');

  if (action.created_by && action.created_by === actor.id) {
    throw forbidden('You cannot reject an action you proposed yourself');
  }
  if (!canTransition(action.status, 'REJECTED')) {
    throw conflict(`An action with status ${action.status} cannot be rejected`);
  }

  const rejected = unwrap(
    await supabase
      .from('actions')
      .update({
        status: 'REJECTED',
        approved_by: actor.id,
        failure_reason: reason ? String(reason).slice(0, 300) : null,
      })
      .eq('id', actionId)
      .select('*')
      .single(),
    'reject action'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'action.rejected',
    entityType: 'action',
    entityId: actionId,
    metadata: { actionType: action.action_type, reason: reason ?? null },
  });

  return { action: rejected };
}

/**
 * List actions with search, filter, sort and pagination.
 * @param {object} query
 */
export async function listActions(query) {
  const { status, customerId, incidentId, mine, actorId, search, sort, order, page, limit } = query;
  const from = (page - 1) * limit;

  let request = supabase
    .from('actions')
    .select(
      'id, customer_id, incident_id, action_type, reason, amount, requires_approval, status, ' +
        'policy_reference, confidence, ai_generated, customer_message, guardrail_result, ' +
        'created_by, approved_by, executed_at, created_at, profiles!inner(name, segment)',
      { count: 'exact' }
    );

  if (status) request = request.eq('status', status);
  if (customerId) request = request.eq('customer_id', customerId);
  if (incidentId) request = request.eq('incident_id', incidentId);
  if (mine && actorId) request = request.eq('created_by', actorId);
  if (search) request = request.ilike('reason', `%${search}%`);

  const { data, error, count } = await request
    .order(sort, { ascending: order === 'asc' })
    .range(from, from + limit - 1);

  if (error) {
    const e = new Error(`list actions: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }

  return {
    data: data.map(({ profiles, ...a }) => ({ ...a, customerName: profiles?.name, customerSegment: profiles?.segment })),
    meta: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  };
}

/** @param {string} id */
export async function getAction(id) {
  const action = unwrap(
    await supabase
      .from('actions')
      .select('*, profiles!inner(name, email, segment)')
      .eq('id', id)
      .maybeSingle(),
    'get action'
  );
  if (!action) throw notFound('Action');
  const { profiles, ...rest } = action;
  return { ...rest, customer: profiles };
}

/**
 * Manually create an action, without the AI path.
 * Guardrails still apply — a human proposing an action is not a reason to skip
 * the limits, only a reason to skip the model.
 *
 * @param {object} input
 */
export async function createManualAction({ customerId, incidentId, actionType, reason, amount, customerMessage, policyReference, actor }) {
  if (!customerMessage && actionType !== 'ESCALATE_TO_HUMAN') {
    throw badRequest('A customer message is required for this action type');
  }

  return proposeAction({
    customerId,
    incidentId: incidentId ?? null,
    recommendation: {
      recommendedAction: actionType,
      creditAmount: amount ?? 0,
      rationale: reason,
      customerMessage: customerMessage ?? null,
      policyReference: policyReference ?? 'manual',
      // A human proposal carries no model confidence. Full confidence is
      // asserted so the confidence rule does not fire on a human decision,
      // while every monetary limit still applies.
      confidence: 1,
      requiresHumanApproval: false,
      aiGenerated: false,
    },
    policyFound: true,
    actor,
    execute: true,
  });
}
