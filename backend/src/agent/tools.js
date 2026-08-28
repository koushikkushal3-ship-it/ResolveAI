/**
 * Tool registry.
 *
 * Gemini may *name* a tool. It never invokes one. A request arrives as data,
 * and this module is the only thing that turns a name into a call:
 *
 *   name -> whitelist lookup -> Zod parse -> role check -> handler -> audit
 *
 * A name that is not in this registry is rejected and audited. There is no
 * dynamic dispatch, no eval, no string-to-function resolution — the registry is
 * a closed set defined at module load, so a model cannot reach anything the
 * author did not deliberately expose.
 *
 * Mutating tools carry `requiresRole` and route through the guardrail layer in
 * services/actions.js. Read-only tools cannot change state, so they only need
 * an authenticated caller.
 */
import { z } from 'zod';
import { supabase, unwrap } from '../config/supabase.js';
import { calculateCXRisk, delayHoursBetween } from '../services/risk.js';
import { searchPolicy } from '../services/policy.js';
import { proposeAction } from '../services/actions.js';
import { sendCustomerNotification } from '../services/notify.js';
import { audit } from '../utils/audit.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';

const uuid = z.string().uuid('Must be a valid id');
const RANK = { AGENT: 1, SUPERVISOR: 2, ADMIN: 3 };

/** @type {Record<string, { readOnly: boolean, requiresRole?: string, input: import('zod').ZodTypeAny, handler: Function }>} */
export const TOOLS = {
  // ---------------------------------------------------------------- read-only
  getCustomer: {
    readOnly: true,
    input: z.object({ customerId: uuid }),
    handler: async ({ customerId }) => {
      const row = unwrap(
        await supabase
          .from('profiles')
          .select('id, name, email, phone, segment, lifetime_value, preferred_channel, created_at')
          .eq('id', customerId)
          .maybeSingle(),
        'tool getCustomer'
      );
      if (!row) throw notFound('Customer');
      return row;
    },
  },

  getCustomerOrders: {
    readOnly: true,
    input: z.object({ customerId: uuid, limit: z.number().int().min(1).max(50).default(10) }),
    handler: async ({ customerId, limit }) =>
      unwrap(
        await supabase
          .from('orders')
          .select('id, order_number, product_name, amount, status, expected_delivery, current_eta, carrier, priority')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(limit),
        'tool getCustomerOrders'
      ),
  },

  getCustomerHistory: {
    readOnly: true,
    input: z.object({ customerId: uuid, limit: z.number().int().min(1).max(50).default(10) }),
    handler: async ({ customerId, limit }) => {
      const [conversations, actions] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, channel, sentiment, summary, is_complaint, status, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(limit)
          .then((r) => unwrap(r, 'tool history conversations')),
        supabase
          .from('actions')
          .select('id, action_type, amount, status, policy_reference, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(limit)
          .then((r) => unwrap(r, 'tool history actions')),
      ]);
      return {
        conversations,
        actions,
        complaintCount: conversations.filter((c) => c.is_complaint).length,
        latestSentiment: conversations[0]?.sentiment ?? 'NEUTRAL',
      };
    },
  },

  getOrderStatus: {
    readOnly: true,
    input: z.object({ orderId: uuid }),
    handler: async ({ orderId }) => {
      const order = unwrap(
        await supabase
          .from('orders')
          .select('id, order_number, product_name, amount, status, expected_delivery, current_eta, carrier, priority')
          .eq('id', orderId)
          .maybeSingle(),
        'tool getOrderStatus'
      );
      if (!order) throw notFound('Order');
      return { ...order, delayHours: delayHoursBetween(order.expected_delivery, order.current_eta) };
    },
  },

  searchPolicy: {
    readOnly: true,
    input: z.object({
      query: z.string().min(2).max(300),
      incidentType: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(5).default(3),
    }),
    handler: async (args) => {
      const hits = await searchPolicy(args);
      // Content is returned trimmed: a tool result is echoed back into a prompt,
      // and eight full policies would undo the token work done on the prompt.
      return hits.map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        version: p.version,
        excerpt: p.content.slice(0, 400),
        relevance: p.relevance,
      }));
    },
  },

  calculateCXRisk: {
    readOnly: true,
    input: z.object({
      segment: z.enum(['PREMIUM', 'STANDARD', 'NEW']).default('STANDARD'),
      lifetimeValue: z.number().min(0).default(0),
      delayHours: z.number().min(0).default(0),
      orderAmount: z.number().min(0).default(0),
      priorComplaintCount: z.number().int().min(0).default(0),
      latestSentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']).default('NEUTRAL'),
      incidentCountLast90Days: z.number().int().min(0).default(0),
    }),
    handler: async (args) => calculateCXRisk(args),
  },

  // ----------------------------------------------------------------- mutating
  offerPriorityDelivery: {
    readOnly: false,
    requiresRole: 'AGENT',
    input: z.object({
      customerId: uuid,
      incidentId: uuid.nullable().optional(),
      customerMessage: z.string().min(20).max(700),
      reason: z.string().min(5).max(300),
      policyReference: z.string().min(1).max(80),
    }),
    handler: async (args, actor) =>
      proposeAction({
        customerId: args.customerId,
        incidentId: args.incidentId ?? null,
        recommendation: {
          recommendedAction: 'PRIORITY_DELIVERY',
          creditAmount: 0,
          rationale: args.reason,
          customerMessage: args.customerMessage,
          policyReference: args.policyReference,
          confidence: 1,
          requiresHumanApproval: false,
          aiGenerated: true,
        },
        policyFound: true,
        actor,
      }),
  },

  issueCredit: {
    readOnly: false,
    requiresRole: 'AGENT',
    input: z.object({
      customerId: uuid,
      incidentId: uuid.nullable().optional(),
      // Capped here as well as in the guardrails. A tool argument is the first
      // place an absurd number can arrive, and rejecting it at the boundary is
      // cheaper than reasoning about it downstream.
      amount: z.number().min(0).max(10_000),
      customerMessage: z.string().min(20).max(700),
      reason: z.string().min(5).max(300),
      policyReference: z.string().min(1).max(80),
      confidence: z.number().min(0).max(1).default(1),
    }),
    handler: async (args, actor) =>
      proposeAction({
        customerId: args.customerId,
        incidentId: args.incidentId ?? null,
        recommendation: {
          recommendedAction: 'ISSUE_CREDIT',
          creditAmount: args.amount,
          rationale: args.reason,
          customerMessage: args.customerMessage,
          policyReference: args.policyReference,
          confidence: args.confidence,
          requiresHumanApproval: false,
          aiGenerated: true,
        },
        policyFound: true,
        actor,
      }),
  },

  sendCustomerNotification: {
    readOnly: false,
    requiresRole: 'AGENT',
    input: z.object({
      customerId: uuid,
      incidentId: uuid.nullable().optional(),
      message: z.string().min(20).max(700),
      channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PHONE']).optional(),
    }),
    handler: async (args, actor) =>
      sendCustomerNotification({ ...args, incidentId: args.incidentId ?? null, actorId: actor?.id }),
  },

  createEscalation: {
    readOnly: false,
    requiresRole: 'AGENT',
    input: z.object({
      customerId: uuid,
      incidentId: uuid.nullable().optional(),
      reason: z.string().min(5).max(300),
    }),
    handler: async (args, actor) =>
      proposeAction({
        customerId: args.customerId,
        incidentId: args.incidentId ?? null,
        recommendation: {
          recommendedAction: 'ESCALATE_TO_HUMAN',
          creditAmount: 0,
          rationale: args.reason,
          customerMessage: null,
          policyReference: 'escalation-policy',
          confidence: 0,
          requiresHumanApproval: true,
          aiGenerated: true,
        },
        // Forces the escalation branch regardless of what else is true.
        policyFound: false,
        actor,
      }),
  },
};

export const TOOL_NAMES = Object.keys(TOOLS);
export const READ_ONLY_TOOLS = TOOL_NAMES.filter((n) => TOOLS[n].readOnly);

/**
 * Execute one tool by name.
 *
 * The only entry point. Every rejection is audited, because a model asking for
 * a tool it may not have is exactly the signal worth keeping.
 *
 * @param {string} name
 * @param {unknown} args
 * @param {object} actor  Authenticated user.
 * @param {'AI'|'USER'} [origin='AI']
 */
export async function executeTool(name, args, actor, origin = 'AI') {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined;

  if (!tool) {
    await audit({
      actorType: origin,
      actorId: actor?.id ?? null,
      action: 'tool.rejected_unknown',
      entityType: 'tool',
      metadata: { requested: String(name).slice(0, 80) },
    });
    throw badRequest(`Unknown tool: ${String(name).slice(0, 80)}`);
  }

  if (tool.requiresRole) {
    if (!actor) throw forbidden('Tool execution requires an authenticated user');
    if ((RANK[actor.role] ?? 0) < RANK[tool.requiresRole]) {
      await audit({
        actorType: origin,
        actorId: actor.id,
        action: 'tool.rejected_unauthorized',
        entityType: 'tool',
        metadata: { tool: name, role: actor.role, required: tool.requiresRole },
      });
      throw forbidden(`Tool ${name} requires the ${tool.requiresRole} role`);
    }
  }

  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    await audit({
      actorType: origin,
      actorId: actor?.id ?? null,
      action: 'tool.rejected_invalid_args',
      entityType: 'tool',
      metadata: { tool: name, issues: parsed.error.issues.map((i) => i.path.join('.')) },
    });
    throw badRequest(`Invalid arguments for ${name}`, parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }

  const result = await tool.handler(parsed.data, actor);

  await audit({
    actorType: origin,
    actorId: actor?.id ?? null,
    action: `tool.${name}`,
    entityType: 'tool',
    metadata: { tool: name, readOnly: tool.readOnly },
  });

  return result;
}
