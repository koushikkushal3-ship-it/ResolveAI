/**
 * Agent orchestration: assemble context, score, retrieve policy, ask the model,
 * validate, and fall back deterministically when any of that fails.
 *
 * The order matters. Risk is computed BEFORE the model is called and is passed
 * in as an authoritative fact, so the model reasons about a number it cannot
 * change. Policy is retrieved before the call for the same reason: the model
 * chooses among policies that were already selected for it, rather than naming
 * one itself.
 */
import { supabase, unwrap } from '../config/supabase.js';
import { calculateCXRisk, delayHoursBetween } from '../services/risk.js';
import { searchPolicy, buildPolicyQuery } from '../services/policy.js';
import { generateStructured, isGeminiConfigured } from './gemini.js';
import { recommendationSchema, chatResponseSchema, geminiResponseSchema, geminiChatSchema } from './schema.js';
import { SYSTEM_INSTRUCTION, CHAT_SYSTEM_INSTRUCTION, buildRecommendationPrompt, buildChatPrompt } from './prompt.js';
import { buildFallbackRecommendation, enforceAlwaysHuman } from './fallback.js';
import { notFound } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';

const NINETY_DAYS_MS = 90 * 24 * 3_600_000;

/**
 * Gather everything a decision needs, in a fixed number of queries.
 *
 * Five queries rather than a loop per customer: this runs once per analyze, but
 * the same loader backs the batch path on the incident page, where an N+1 would
 * turn one click into a hundred round trips.
 *
 * @param {string} customerId
 * @param {string} incidentId
 */
export async function loadDecisionContext(customerId, incidentId) {
  const [customer, incident, link] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, email, phone, segment, lifetime_value, preferred_channel')
      .eq('id', customerId)
      .maybeSingle()
      .then((r) => unwrap(r, 'load customer')),
    supabase
      .from('incidents')
      .select('id, type, severity, title, description, status, started_at')
      .eq('id', incidentId)
      .maybeSingle()
      .then((r) => unwrap(r, 'load incident')),
    supabase
      .from('customer_incidents')
      .select('id, order_id, risk_score, risk_level, risk_factors, status, ai_recommendation, analyzed_at')
      .eq('customer_id', customerId)
      .eq('incident_id', incidentId)
      .maybeSingle()
      .then((r) => unwrap(r, 'load customer_incident')),
  ]);

  if (!customer) throw notFound('Customer');
  if (!incident) throw notFound('Incident');

  const [order, conversations] = await Promise.all([
    link?.order_id
      ? supabase
          .from('orders')
          .select('id, order_number, product_name, amount, status, expected_delivery, current_eta, carrier')
          .eq('id', link.order_id)
          .maybeSingle()
          .then((r) => unwrap(r, 'load order'))
      : Promise.resolve(null),
    supabase
      .from('conversations')
      .select('id, sentiment, summary, is_complaint, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then((r) => unwrap(r, 'load conversations')),
  ]);

  const incidentCount = unwrap(
    await supabase
      .from('customer_incidents')
      .select('id, incidents!inner(started_at)')
      .eq('customer_id', customerId)
      .gte('incidents.started_at', new Date(Date.now() - NINETY_DAYS_MS).toISOString()),
    'count recent incidents'
  );

  const delayHours = order ? delayHoursBetween(order.expected_delivery, order.current_eta) : 0;
  const priorComplaintCount = conversations.filter((c) => c.is_complaint).length;
  const latestSentiment = conversations[0]?.sentiment ?? 'NEUTRAL';

  const risk = calculateCXRisk({
    segment: customer.segment,
    lifetimeValue: Number(customer.lifetime_value),
    delayHours,
    orderAmount: order ? Number(order.amount) : 0,
    priorComplaintCount,
    latestSentiment,
    incidentCountLast90Days: incidentCount.length,
  });

  return {
    customer,
    incident,
    link,
    order,
    risk,
    history: {
      priorComplaintCount,
      latestSentiment,
      incidentCountLast90Days: incidentCount.length,
      recentSummaries: conversations.slice(0, 3).map((c) => c.summary).filter(Boolean),
    },
    delayHours,
  };
}

/**
 * Produce a recommendation for one customer on one incident.
 *
 * Pure analysis — no action is created and nothing is executed here. That
 * separation is deliberate: /agent/analyze is safe to call repeatedly and safe
 * to show, while /agent/resolve is the endpoint that can change the world.
 *
 * @param {object} input
 * @param {string} input.customerId
 * @param {string} input.incidentId
 * @param {object} input.actor          The authenticated user.
 * @param {boolean} [input.force=false] Ignore the cached recommendation.
 */
export async function analyze({ customerId, incidentId, actor, force = false }) {
  const ctx = await loadDecisionContext(customerId, incidentId);

  // Cached result: re-opening a customer must not spend quota.
  if (!force && ctx.link?.ai_recommendation) {
    return {
      ...ctx.link.ai_recommendation,
      risk: ctx.risk,
      cached: true,
    };
  }

  const policies = await searchPolicy({
    query: buildPolicyQuery({
      incidentType: ctx.incident.type,
      segment: ctx.customer.segment,
      delayHours: ctx.delayHours,
      orderAmount: ctx.order ? Number(ctx.order.amount) : 0,
    }),
    incidentType: ctx.incident.type,
  });

  const promptInput = {
    customer: {
      name: ctx.customer.name,
      segment: ctx.customer.segment,
      lifetimeValue: Number(ctx.customer.lifetime_value),
      preferredChannel: ctx.customer.preferred_channel,
    },
    incident: ctx.incident,
    order: {
      productName: ctx.order?.product_name ?? 'your order',
      amount: ctx.order ? Number(ctx.order.amount) : 0,
      status: ctx.order?.status ?? 'UNKNOWN',
      carrier: ctx.order?.carrier,
      delayHours: ctx.delayHours,
    },
    risk: ctx.risk,
    policies,
    history: ctx.history,
  };

  let recommendation;
  let source;
  let failureReason = null;

  if (!isGeminiConfigured) {
    recommendation = buildFallbackRecommendation(promptInput);
    source = 'FALLBACK_NO_KEY';
  } else {
    const result = await generateStructured({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: buildRecommendationPrompt(promptInput),
      responseSchema: geminiResponseSchema,
    });

    if (result.ok) {
      const parsed = recommendationSchema.safeParse(result.data);
      if (parsed.success) {
        recommendation = parsed.data;
        source = 'GEMINI';
      } else {
        // The model answered but broke its own schema. One deterministic
        // fallback beats a re-prompt loop that can burn quota and still fail.
        recommendation = buildFallbackRecommendation(promptInput);
        source = 'FALLBACK_INVALID_OUTPUT';
        failureReason = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      }
    } else {
      recommendation = buildFallbackRecommendation(promptInput);
      source = `FALLBACK_${result.reason}`;
      failureReason = result.detail;
    }
  }

  recommendation = enforceAlwaysHuman(recommendation);

  // A model may cite a policy that was not in the block it was given. Anything
  // unrecognised is downgraded to an escalation rather than trusted.
  const validSlugs = new Set(policies.map((p) => p.slug));
  if (recommendation.policyReference && !validSlugs.has(recommendation.policyReference)) {
    recommendation = {
      ...recommendation,
      policyReference: policies[0]?.slug ?? 'escalation-policy',
      requiresHumanApproval: true,
      confidence: Math.min(recommendation.confidence, 0.5),
    };
    failureReason = [failureReason, 'cited_unknown_policy'].filter(Boolean).join('; ');
  }

  const payload = {
    ...recommendation,
    source,
    aiGenerated: source === 'GEMINI',
    policiesConsidered: policies.map((p) => ({
      slug: p.slug,
      title: p.title,
      version: p.version,
      category: p.category,
    })),
    generatedAt: new Date().toISOString(),
    ...(failureReason ? { degradedReason: failureReason } : {}),
  };

  // Cache and persist the risk snapshot together, so the incident list and the
  // customer view can never disagree about a customer's score.
  if (ctx.link) {
    unwrap(
      await supabase
        .from('customer_incidents')
        .update({
          risk_score: ctx.risk.score,
          risk_level: ctx.risk.level,
          risk_factors: ctx.risk.factors,
          ai_recommendation: payload,
          analyzed_at: new Date().toISOString(),
          status: 'ANALYZED',
        })
        .eq('id', ctx.link.id)
        .select('id'),
      'cache recommendation'
    );
  }

  await audit({
    actorType: source === 'GEMINI' ? 'AI' : 'SYSTEM',
    actorId: actor?.id ?? null,
    action: 'agent.analyze',
    entityType: 'customer_incident',
    entityId: ctx.link?.id ?? null,
    metadata: {
      source,
      riskScore: ctx.risk.score,
      recommendedAction: recommendation.recommendedAction,
      policyReference: recommendation.policyReference,
      ...(failureReason ? { degradedReason: failureReason } : {}),
    },
  });

  return { ...payload, risk: ctx.risk, cached: false };
}

/**
 * Grounded Q&A for a support agent.
 * @param {object} input
 * @param {string} input.customerId
 * @param {string} [input.incidentId]
 * @param {string} input.question
 */
export async function chat({ customerId, incidentId, question }) {
  const customer = unwrap(
    await supabase
      .from('profiles')
      .select('id, name, segment, lifetime_value')
      .eq('id', customerId)
      .maybeSingle(),
    'chat customer'
  );
  if (!customer) throw notFound('Customer');

  const incident = incidentId
    ? unwrap(
        await supabase
          .from('incidents')
          .select('id, type, status, title')
          .eq('id', incidentId)
          .maybeSingle(),
        'chat incident'
      )
    : null;

  const policies = await searchPolicy({
    query: question,
    incidentType: incident?.type,
    limit: 3,
  });

  if (!isGeminiConfigured) {
    return {
      answer:
        'AI answers are unavailable because no Gemini key is configured. The policies most relevant to this ' +
        `question are: ${policies.map((p) => p.title).join(', ') || 'none found'}.`,
      citedPolicies: policies.map((p) => p.slug),
      confidence: 0,
      degraded: true,
    };
  }

  const result = await generateStructured({
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    prompt: buildChatPrompt({
      question,
      customer: {
        name: customer.name,
        segment: customer.segment,
        lifetimeValue: Number(customer.lifetime_value),
      },
      policies,
      incident,
    }),
    responseSchema: geminiChatSchema,
    temperature: 0.2,
  });

  if (!result.ok) {
    return {
      answer:
        'The AI assistant is temporarily unavailable. Relevant policies for this question: ' +
        (policies.map((p) => p.title).join(', ') || 'none found') + '.',
      citedPolicies: policies.map((p) => p.slug),
      confidence: 0,
      degraded: true,
    };
  }

  const parsed = chatResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      answer: 'The AI assistant returned an unreadable response. Please consult the linked policies directly.',
      citedPolicies: policies.map((p) => p.slug),
      confidence: 0,
      degraded: true,
    };
  }

  return { ...parsed.data, degraded: false };
}
