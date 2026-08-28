import { describe, it, expect } from 'vitest';
import {
  evaluateGuardrails,
  canTransition,
  REASONS,
  AUTO_CREDIT_LIMIT,
  DAILY_CREDIT_CAP,
  CONFIDENCE_FLOOR,
} from '../src/services/guardrails.js';

/** A recommendation that passes every rule, for single-variable mutation. */
const clean = (over = {}) => ({
  recommendedAction: 'ISSUE_CREDIT',
  creditAmount: 300,
  confidence: 0.95,
  requiresHumanApproval: false,
  policyReference: 'delivery-compensation-v2',
  ...over,
});

const evaluate = (rec, opts = {}) =>
  evaluateGuardrails({ recommendation: clean(rec), policyFound: true, ...opts });

describe('auto-execute path', () => {
  it('allows a compliant credit at or under the automatic limit', () => {
    const v = evaluate({ creditAmount: AUTO_CREDIT_LIMIT });
    expect(v.allowed).toBe(true);
    expect(v.requiresApproval).toBe(false);
    expect(v.escalate).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it('allows a zero-amount notification', () => {
    const v = evaluate({ recommendedAction: 'NOTIFICATION_ONLY', creditAmount: 0 });
    expect(v.allowed).toBe(true);
  });

  it('allows priority delivery with no money attached', () => {
    const v = evaluate({ recommendedAction: 'PRIORITY_DELIVERY', creditAmount: 0 });
    expect(v.allowed).toBe(true);
  });
});

describe('approval triggers', () => {
  it('requires approval one rupee above the automatic limit', () => {
    const v = evaluate({ creditAmount: AUTO_CREDIT_LIMIT + 1 });
    expect(v.allowed).toBe(false);
    expect(v.requiresApproval).toBe(true);
    expect(v.reasons).toContain(REASONS.CREDIT_ABOVE_AUTO_LIMIT);
  });

  it('requires approval when the rolling 24h cap would be breached', () => {
    const v = evaluate({ creditAmount: 400 }, { creditIssuedLast24h: DAILY_CREDIT_CAP - 200 });
    expect(v.requiresApproval).toBe(true);
    expect(v.reasons).toContain(REASONS.DAILY_CAP_EXCEEDED);
  });

  it('allows a credit that lands exactly on the daily cap', () => {
    const v = evaluate({ creditAmount: 400 }, { creditIssuedLast24h: DAILY_CREDIT_CAP - 400 });
    expect(v.allowed).toBe(true);
  });

  it.each(['PAYMENT_RETRY', 'PAYMENT_METHOD_UPDATE', 'ACCOUNT_ADJUSTMENT', 'REFUND'])(
    '%s always requires a human, even at zero amount and full confidence',
    (recommendedAction) => {
      const v = evaluate({ recommendedAction, creditAmount: 0, confidence: 1 });
      expect(v.allowed).toBe(false);
      expect(v.reasons).toContain(REASONS.ALWAYS_HUMAN_ACTION);
    }
  );

  it('requires approval below the confidence floor when money is involved', () => {
    const v = evaluate({ confidence: CONFIDENCE_FLOOR - 0.01 });
    expect(v.requiresApproval).toBe(true);
    expect(v.reasons).toContain(REASONS.LOW_CONFIDENCE);
  });

  it('does not fire the confidence rule on a zero-amount action', () => {
    const v = evaluate({ recommendedAction: 'NOTIFICATION_ONLY', creditAmount: 0, confidence: 0.1 });
    expect(v.reasons).not.toContain(REASONS.LOW_CONFIDENCE);
    expect(v.allowed).toBe(true);
  });

  it('honours the model asking for a human', () => {
    const v = evaluate({ requiresHumanApproval: true });
    expect(v.allowed).toBe(false);
    expect(v.reasons).toContain(REASONS.MODEL_REQUESTED_APPROVAL);
  });

  it('does NOT let the model clear a rule by claiming no approval is needed', () => {
    // The decisive assertion: a model that says "no approval needed" on a
    // 5000-rupee credit must still be stopped.
    const v = evaluate({ creditAmount: 5000, requiresHumanApproval: false, confidence: 0.99 });
    expect(v.allowed).toBe(false);
    expect(v.reasons).toContain(REASONS.CREDIT_ABOVE_AUTO_LIMIT);
  });
});

describe('escalation', () => {
  it('escalates and zeroes the amount when no policy governs the case', () => {
    const v = evaluateGuardrails({
      recommendation: clean({ creditAmount: 300 }),
      policyFound: false,
    });
    expect(v.escalate).toBe(true);
    expect(v.allowed).toBe(false);
    expect(v.amount).toBe(0);
    expect(v.reasons).toContain(REASONS.NO_POLICY);
  });

  it('escalates when the recommendation is itself an escalation', () => {
    const v = evaluate({ recommendedAction: 'ESCALATE_TO_HUMAN' });
    expect(v.escalate).toBe(true);
    expect(v.amount).toBe(0);
  });

  it('rejects a negative amount outright rather than treating it as a credit', () => {
    const v = evaluate({ creditAmount: -100 });
    expect(v.allowed).toBe(false);
    expect(v.escalate).toBe(true);
    expect(v.amount).toBe(0);
    expect(v.reasons).toContain(REASONS.NEGATIVE_AMOUNT);
  });
});

describe('the deterministic fallback cannot auto-spend', () => {
  it('confidence 0 with a credit always routes to a human', () => {
    // The fallback reports confidence 0 by construction, so this is the
    // guarantee that a degraded AI path never issues money unsupervised.
    const v = evaluate({ confidence: 0, creditAmount: 300 });
    expect(v.allowed).toBe(false);
    expect(v.reasons).toContain(REASONS.LOW_CONFIDENCE);
  });

  it('still allows a zero-cost fallback notification', () => {
    const v = evaluate({ recommendedAction: 'NOTIFICATION_ONLY', creditAmount: 0, confidence: 0 });
    expect(v.allowed).toBe(true);
  });
});

describe('multiple rules', () => {
  it('reports every rule that fired, not just the first', () => {
    const v = evaluate(
      { creditAmount: 900, confidence: 0.2, requiresHumanApproval: true },
      { creditIssuedLast24h: 800 }
    );
    expect(v.reasons).toEqual(
      expect.arrayContaining([
        REASONS.CREDIT_ABOVE_AUTO_LIMIT,
        REASONS.DAILY_CAP_EXCEEDED,
        REASONS.LOW_CONFIDENCE,
        REASONS.MODEL_REQUESTED_APPROVAL,
      ])
    );
  });
});

describe('action status transitions', () => {
  it.each([
    ['PROPOSED', 'APPROVED'],
    ['PROPOSED', 'REJECTED'],
    ['PROPOSED', 'ESCALATED'],
    ['PROPOSED', 'EXECUTED'],
    ['APPROVED', 'EXECUTED'],
    ['APPROVED', 'FAILED'],
    ['ESCALATED', 'APPROVED'],
    ['ESCALATED', 'REJECTED'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['EXECUTED', 'REJECTED'],
    ['EXECUTED', 'APPROVED'],
    ['REJECTED', 'APPROVED'],
    ['REJECTED', 'EXECUTED'],
    ['FAILED', 'EXECUTED'],
    ['APPROVED', 'REJECTED'],
    ['PROPOSED', 'PROPOSED'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats an unknown status as having no legal transition', () => {
    expect(canTransition('NONSENSE', 'EXECUTED')).toBe(false);
  });
});
