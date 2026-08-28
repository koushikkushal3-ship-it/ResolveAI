/**
 * Business guardrails.
 *
 * This is where a proposal becomes a decision. Everything above it — the model,
 * the fallback, the prompt — only ever proposes. Nothing reaches the database
 * without passing through here.
 *
 * Written as a pure function on purpose: no database, no request, no clock it
 * does not receive. That makes every branch testable, and it makes the rules
 * readable as rules rather than scattered across controllers.
 *
 * The frontend mirrors some of this for UX. That mirror is NOT a control.
 */
import { ALWAYS_HUMAN_ACTIONS } from '../agent/schema.js';

/** Credit at or below this may execute without a human, if nothing else objects. */
export const AUTO_CREDIT_LIMIT = 500;

/** Ceiling on total credit to one customer in a rolling 24 hours. */
export const DAILY_CREDIT_CAP = 1000;

/** Model confidence below this is not trusted to act alone. */
export const CONFIDENCE_FLOOR = 0.7;

/** Reason codes. Stable strings — the UI maps these to explanations. */
export const REASONS = {
  NO_POLICY: 'no_governing_policy',
  CREDIT_ABOVE_AUTO_LIMIT: 'credit_above_auto_limit',
  DAILY_CAP_EXCEEDED: 'daily_credit_cap_exceeded',
  ALWAYS_HUMAN_ACTION: 'action_requires_human_by_policy',
  LOW_CONFIDENCE: 'low_confidence',
  MODEL_REQUESTED_APPROVAL: 'model_requested_approval',
  NEGATIVE_AMOUNT: 'invalid_amount',
};

/**
 * @typedef {object} GuardrailVerdict
 * @property {boolean} allowed          May execute immediately.
 * @property {boolean} requiresApproval Needs a SUPERVISOR before executing.
 * @property {boolean} escalate         No policy governs this; a human must decide from scratch.
 * @property {string[]} reasons         Every rule that fired, for the audit trail and the UI.
 * @property {number} amount            The amount that will actually be applied.
 */

/**
 * Evaluate a recommendation against the business rules.
 *
 * @param {object} input
 * @param {object} input.recommendation        Validated recommendation.
 * @param {boolean} input.policyFound          Whether retrieval produced a governing policy.
 * @param {number} [input.creditIssuedLast24h] Credit already given to this customer in 24h.
 * @returns {GuardrailVerdict}
 */
export function evaluateGuardrails({ recommendation, policyFound, creditIssuedLast24h = 0 }) {
  const reasons = [];
  const amount = Number(recommendation.creditAmount) || 0;
  const action = recommendation.recommendedAction;

  // A negative amount should be impossible after Zod, but a money path is the
  // wrong place to rely on an upstream check holding.
  if (amount < 0) {
    return {
      allowed: false,
      requiresApproval: true,
      escalate: true,
      reasons: [REASONS.NEGATIVE_AMOUNT],
      amount: 0,
    };
  }

  // No policy governs this. Escalate rather than improvise — the retriever
  // returning nothing is exactly the case where inventing a resolution does
  // the most damage.
  if (!policyFound || action === 'ESCALATE_TO_HUMAN') {
    if (!policyFound) reasons.push(REASONS.NO_POLICY);
    return { allowed: false, requiresApproval: true, escalate: true, reasons, amount: 0 };
  }

  if (ALWAYS_HUMAN_ACTIONS.includes(action)) reasons.push(REASONS.ALWAYS_HUMAN_ACTION);
  if (amount > AUTO_CREDIT_LIMIT) reasons.push(REASONS.CREDIT_ABOVE_AUTO_LIMIT);
  if (creditIssuedLast24h + amount > DAILY_CREDIT_CAP) reasons.push(REASONS.DAILY_CAP_EXCEEDED);

  // The fallback reports confidence 0, so it lands here by construction: a rule
  // table has no opinion about its own certainty and must not act unsupervised
  // on anything that spends money.
  if (amount > 0 && Number(recommendation.confidence) < CONFIDENCE_FLOOR) {
    reasons.push(REASONS.LOW_CONFIDENCE);
  }

  // The model asking for a human is honoured. It may never do the reverse —
  // requiresHumanApproval: false does not clear any rule above.
  if (recommendation.requiresHumanApproval === true) reasons.push(REASONS.MODEL_REQUESTED_APPROVAL);

  const requiresApproval = reasons.length > 0;
  return { allowed: !requiresApproval, requiresApproval, escalate: false, reasons, amount };
}

/**
 * Legal action status transitions. Anything not listed is rejected with 409.
 * Terminal states have no outgoing edges by design.
 */
export const ACTION_TRANSITIONS = {
  PROPOSED: ['APPROVED', 'REJECTED', 'ESCALATED', 'EXECUTED', 'FAILED'],
  APPROVED: ['EXECUTED', 'FAILED'],
  ESCALATED: ['APPROVED', 'REJECTED'],
  EXECUTED: [],
  REJECTED: [],
  FAILED: [],
};

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return (ACTION_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Human-readable explanation for each reason code. Used by the UI so an agent
 * sees why a case is waiting on them rather than an opaque status.
 */
export const REASON_LABELS = {
  [REASONS.NO_POLICY]: 'No governing policy was found for this situation',
  [REASONS.CREDIT_ABOVE_AUTO_LIMIT]: `Credit exceeds the ₹${AUTO_CREDIT_LIMIT} automatic limit`,
  [REASONS.DAILY_CAP_EXCEEDED]: `Would exceed the ₹${DAILY_CREDIT_CAP} daily cap for this customer`,
  [REASONS.ALWAYS_HUMAN_ACTION]: 'This action type always requires human approval',
  [REASONS.LOW_CONFIDENCE]: `Confidence is below the ${CONFIDENCE_FLOOR} threshold`,
  [REASONS.MODEL_REQUESTED_APPROVAL]: 'The recommendation itself requested human review',
  [REASONS.NEGATIVE_AMOUNT]: 'The proposed amount is invalid',
};
