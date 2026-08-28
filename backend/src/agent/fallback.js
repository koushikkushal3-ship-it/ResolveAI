/**
 * Deterministic fallback recommendation.
 *
 * This is what keeps the product demonstrable when Gemini is rate-limited,
 * misconfigured, or down — which on a free tier, during a live demo, is the
 * single most likely thing to go wrong.
 *
 * It is a rule table, not a model. Output is always schema-valid, is marked
 * ai_generated = false so nothing pretends otherwise, and carries no confidence
 * score — a rule has no opinion about its own certainty, and inventing one
 * would let it slip past the confidence guardrail.
 *
 * Every path here still goes through the same guardrail layer as a model
 * recommendation. The fallback proposes; it does not decide.
 */
import { ALWAYS_HUMAN_ACTIONS } from './schema.js';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

/** Credit ladder for delivery delays, read off the compensation policy. */
function deliveryCredit({ segment, delayHours, riskLevel }) {
  if (delayHours <= 24) return 0;
  if (segment === 'PREMIUM') {
    if (delayHours > 48) return riskLevel === 'HIGH' ? 300 : 200;
    return 100;
  }
  if (delayHours > 72) return 300;
  if (delayHours > 48) return 150;
  return 0;
}

/**
 * @param {object} input
 * @param {object} input.customer  { name, segment }
 * @param {object} input.incident  { type }
 * @param {object} input.order     { productName, delayHours }
 * @param {object} input.risk      { score, level, factors }
 * @param {Array}  input.policies  Ranked policies; [] means nothing governs this.
 * @returns {import('zod').infer<typeof import('./schema.js').recommendationSchema>}
 */
export function buildFallbackRecommendation({ customer, incident, order, risk, policies }) {
  const policy = policies[0] ?? null;
  const firstName = String(customer.name ?? 'there').split(' ')[0];

  // No governing policy: escalate. Never guess a resolution.
  if (!policy) {
    return {
      incidentSummary: `${incident.type.replace(/_/g, ' ').toLowerCase()} affecting ${customer.name}, risk ${risk.score}/100.`,
      riskFactorSummary: risk.factors.map((f) => f.label),
      recommendedAction: 'ESCALATE_TO_HUMAN',
      creditAmount: 0,
      customerMessage:
        `Hi ${firstName}, we have spotted a problem with your recent order and a member of our team is looking into it now. ` +
        `We will be in touch shortly with an update.`,
      requiresHumanApproval: true,
      policyReference: 'escalation-policy',
      confidence: 0,
      rationale: 'No governing policy matched this situation, so the case was routed to a human.',
    };
  }

  const base = {
    incidentSummary:
      `${incident.type.replace(/_/g, ' ').toLowerCase()} affecting ${customer.name} ` +
      `(${customer.segment.toLowerCase()}), risk ${risk.score}/100 ${risk.level}.`,
    riskFactorSummary: risk.factors.map((f) => f.label),
    policyReference: policy.slug,
    confidence: 0,
    requiresHumanApproval: false,
    creditAmount: 0,
  };

  switch (incident.type) {
    case 'DELIVERY_DELAY': {
      const credit = deliveryCredit({
        segment: customer.segment,
        delayHours: order.delayHours,
        riskLevel: risk.level,
      });
      const priority = customer.segment === 'PREMIUM' || risk.level === 'HIGH';

      if (credit === 0 && !priority) {
        return {
          ...base,
          recommendedAction: 'NOTIFICATION_ONLY',
          customerMessage:
            `Hi ${firstName}, your ${order.productName} is running a little behind schedule. ` +
            `We are tracking it closely and will let you know as soon as it is moving again.`,
          rationale: `Delay of ${order.delayHours}h is below the compensation threshold; proactive notification only.`,
        };
      }

      const action =
        credit > 0 && priority
          ? 'PRIORITY_DELIVERY_AND_CREDIT'
          : credit > 0
            ? 'ISSUE_CREDIT'
            : 'PRIORITY_DELIVERY';

      return {
        ...base,
        recommendedAction: action,
        creditAmount: credit,
        customerMessage:
          `Hi ${firstName}, your ${order.productName} has been delayed by a carrier issue and we are sorry about that. ` +
          `We have upgraded it to priority delivery${credit > 0 ? ` and added ${inr(credit)} to your wallet` : ''}. ` +
          `You will get tracking as soon as it is on the move.`,
        rationale: `${customer.segment} customer, ${order.delayHours}h delay, risk ${risk.score} — resolution taken from ${policy.slug}.`,
      };
    }

    case 'PAYMENT_FAILURE':
      return {
        ...base,
        // Payment paths never auto-execute, whatever the numbers say.
        recommendedAction: 'ESCALATE_TO_HUMAN',
        requiresHumanApproval: true,
        customerMessage:
          `Hi ${firstName}, the payment for your recent order did not go through. ` +
          `Your order is safe with us for the next 48 hours — you can retry payment from your orders page whenever suits you.`,
        rationale: 'Payment-path incident; policy requires human handling before any account change.',
      };

    case 'INVENTORY_SHORTAGE':
      return {
        ...base,
        recommendedAction: risk.level === 'HIGH' ? 'REPLACEMENT' : 'NOTIFICATION_ONLY',
        customerMessage:
          `Hi ${firstName}, your ${order.productName} is temporarily out of stock. ` +
          `We are sorry for the inconvenience and are working to get it to you as soon as possible. ` +
          `We will confirm your options shortly.`,
        requiresHumanApproval: risk.level === 'HIGH',
        rationale: `Stock unavailable; ${risk.level} risk customer handled under ${policy.slug}.`,
      };

    case 'ORDER_CANCELLED':
      return {
        ...base,
        recommendedAction: 'REFUND',
        requiresHumanApproval: true, // REFUND is in ALWAYS_HUMAN_ACTIONS.
        customerMessage:
          `Hi ${firstName}, your order for ${order.productName} has been cancelled and a full refund is on its way. ` +
          `It should reach your original payment method within 5 to 7 working days.`,
        rationale: `Cancellation requires a refund, which is reviewed by a human under ${policy.slug}.`,
      };

    default:
      return {
        ...base,
        recommendedAction: 'ESCALATE_TO_HUMAN',
        requiresHumanApproval: true,
        customerMessage:
          `Hi ${firstName}, we have noticed an issue affecting your recent order and our team is on it. ` +
          `We will update you as soon as we know more.`,
        rationale: 'Incident type has no deterministic resolution path; routed to a human.',
      };
  }
}

/** Belt and braces: nothing on the always-human list escapes without approval. */
export function enforceAlwaysHuman(recommendation) {
  if (ALWAYS_HUMAN_ACTIONS.includes(recommendation.recommendedAction)) {
    return { ...recommendation, requiresHumanApproval: true };
  }
  return recommendation;
}
