/**
 * CX Risk Engine.
 *
 * This is the canonical risk score. It is deterministic, pure, and has no AI
 * involvement whatsoever. Gemini may later *describe* these factors in prose,
 * but it can never change the number — which removes an entire class of
 * hallucination from the product's most consequential output.
 *
 * Scores are clamped to 0..100 and bucketed:
 *   0-39 LOW · 40-69 MEDIUM · 70-100 HIGH
 */

/** @typedef {'LOW'|'MEDIUM'|'HIGH'} RiskLevel */

/**
 * @typedef {object} RiskContext
 * @property {'PREMIUM'|'STANDARD'|'NEW'} segment
 * @property {number} lifetimeValue          Customer lifetime value, INR.
 * @property {number} delayHours             Hours late. 0 when not a delay incident.
 * @property {number} orderAmount            Value of the affected order, INR.
 * @property {number} priorComplaintCount    Complaint conversations before this incident.
 * @property {'POSITIVE'|'NEUTRAL'|'NEGATIVE'} latestSentiment
 * @property {number} incidentCountLast90Days Incidents touching this customer in 90 days.
 */

export const RISK_THRESHOLDS = { MEDIUM: 40, HIGH: 70 };

export const HIGH_VALUE_ORDER_INR = 5000;
export const LTV_POINT_PER_INR = 50000;
export const LTV_MAX_POINTS = 10;

/**
 * The factor table.
 *
 * Each entry is `[key, label, points, predicate]`. Keeping them declarative
 * means the UI, the tests and the AI prompt all read the same source of truth,
 * and adding a factor is one line rather than a new branch.
 *
 * Note that the two delay tiers are mutually exclusive by construction: the
 * 24-48h predicate excludes anything over 48h, so a 72-hour delay scores 30,
 * not 45.
 */
const FACTORS = [
  ['premium_customer', 'Premium customer', 20, (c) => c.segment === 'PREMIUM'],
  ['delay_over_48h', 'Delivery delayed over 48 hours', 30, (c) => c.delayHours > 48],
  [
    'delay_24_48h',
    'Delivery delayed 24-48 hours',
    15,
    (c) => c.delayHours > 24 && c.delayHours <= 48,
  ],
  [
    'high_value_order',
    'High-value order',
    15,
    (c) => c.orderAmount >= HIGH_VALUE_ORDER_INR,
  ],
  ['previous_complaint', 'Previous complaint on record', 15, (c) => c.priorComplaintCount >= 1],
  ['negative_sentiment', 'Negative recent sentiment', 10, (c) => c.latestSentiment === 'NEGATIVE'],
  ['repeat_incident', 'Repeat incident within 90 days', 10, (c) => c.incidentCountLast90Days >= 2],
];

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Points contributed by lifetime value.
 *
 * A continuous factor, unlike the rest. It exists because the flat weights
 * alone cannot separate two otherwise identical customers whose value to the
 * business differs by an order of magnitude.
 *
 * @param {number} lifetimeValue
 * @returns {number} 0..10
 */
export function ltvPoints(lifetimeValue) {
  if (!Number.isFinite(lifetimeValue) || lifetimeValue <= 0) return 0;
  return clamp(Math.floor(lifetimeValue / LTV_POINT_PER_INR), 0, LTV_MAX_POINTS);
}

/**
 * @param {number} score
 * @returns {RiskLevel}
 */
export function toRiskLevel(score) {
  if (score >= RISK_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Hours between the promised delivery and the current estimate.
 * Returns 0 when either timestamp is missing or the order is not late — a
 * negative delay is an early delivery, not negative risk.
 *
 * @param {string|Date|null|undefined} expectedDelivery
 * @param {string|Date|null|undefined} currentEta
 * @returns {number}
 */
export function delayHoursBetween(expectedDelivery, currentEta) {
  if (!expectedDelivery || !currentEta) return 0;
  const expected = new Date(expectedDelivery).getTime();
  const eta = new Date(currentEta).getTime();
  if (Number.isNaN(expected) || Number.isNaN(eta)) return 0;
  return Math.max(0, Math.round((eta - expected) / 3_600_000));
}

/**
 * Score a customer's experience risk for one incident.
 *
 * @param {Partial<RiskContext>} input
 * @returns {{ score: number, level: RiskLevel, factors: Array<{key: string, label: string, points: number}> }}
 */
export function calculateCXRisk(input = {}) {
  /** @type {RiskContext} */
  const context = {
    segment: input.segment ?? 'STANDARD',
    lifetimeValue: Number(input.lifetimeValue) || 0,
    delayHours: Number(input.delayHours) || 0,
    orderAmount: Number(input.orderAmount) || 0,
    priorComplaintCount: Number(input.priorComplaintCount) || 0,
    latestSentiment: input.latestSentiment ?? 'NEUTRAL',
    incidentCountLast90Days: Number(input.incidentCountLast90Days) || 0,
  };

  const factors = [];

  for (const [key, label, points, applies] of FACTORS) {
    if (applies(context)) factors.push({ key, label, points });
  }

  const ltv = ltvPoints(context.lifetimeValue);
  if (ltv > 0) {
    factors.push({
      key: 'lifetime_value',
      label: `High lifetime value (${formatInr(context.lifetimeValue)})`,
      points: ltv,
    });
  }

  const score = clamp(
    factors.reduce((sum, f) => sum + f.points, 0),
    0,
    100
  );

  return { score, level: toRiskLevel(score), factors };
}

/** @param {number} n */
function formatInr(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}
