/**
 * Incident simulator.
 *
 * Three scenarios that create a real incident, attach real orders and real
 * customers, and score them with the real risk engine. Nothing is faked past
 * the trigger: the only thing being simulated is the upstream operational
 * event that a logistics or payments provider would normally report.
 *
 * The delivery-delay scenario is the demo's spine, so it is deterministic —
 * it always selects the same 17 orders and always produces 5 HIGH-risk
 * customers, because a demo that reshuffles its own numbers cannot be narrated.
 */
import { supabase, unwrap } from '../config/supabase.js';
import { calculateCXRisk } from './risk.js';
import { audit } from '../utils/audit.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Gather the signals the risk engine needs for a batch of customers, in 2 queries. */
async function loadRiskSignals(customerIds) {
  const [conversations, links] = await Promise.all([
    supabase
      .from('conversations')
      .select('customer_id, sentiment, is_complaint, created_at')
      .in('customer_id', customerIds)
      .eq('is_outbound', false)
      .order('created_at', { ascending: false })
      .then((r) => unwrap(r, 'sim conversations')),
    supabase
      .from('customer_incidents')
      .select('customer_id')
      .in('customer_id', customerIds)
      .then((r) => unwrap(r, 'sim incident counts')),
  ]);

  const byCustomer = new Map();
  for (const id of customerIds) {
    const mine = conversations.filter((c) => c.customer_id === id);
    byCustomer.set(id, {
      priorComplaintCount: mine.filter((c) => c.is_complaint).length,
      latestSentiment: mine[0]?.sentiment ?? 'NEUTRAL',
      incidentCountLast90Days: links.filter((l) => l.customer_id === id).length,
    });
  }
  return byCustomer;
}

/**
 * Create the incident, link the affected orders, and score every customer.
 * Shared by all three scenarios — they differ only in which orders they select
 * and how they mutate them.
 */
/**
 * Remove any previous simulated incident of the same type.
 *
 * Without this, re-running a scenario stacks incidents on the same customers,
 * which fires the repeat_incident factor (+10) and inflates every score on each
 * run — Priya climbed from 91 to 100 after three runs. A demo that changes its
 * own numbers each time it is rehearsed cannot be narrated, so a scenario now
 * REPLACES its previous run rather than adding to it.
 *
 * Only simulated incidents are touched; real ones are never deleted.
 *
 * @param {string} type
 */
async function clearPreviousSimulation(type) {
  const prior = unwrap(
    await supabase.from('incidents').select('id').eq('is_simulated', true).eq('type', type),
    'simulator: find prior runs'
  );
  if (!prior.length) return 0;

  const ids = prior.map((i) => i.id);
  // customer_incidents cascades from incidents, but actions reference incidents
  // with ON DELETE SET NULL, so executed history survives the cleanup.
  unwrap(await supabase.from('incidents').delete().in('id', ids).select('id'), 'simulator: clear prior');
  return ids.length;
}

async function buildIncident({ incident, orders, delayHoursFor, actor }) {
  const created = unwrap(
    await supabase
      .from('incidents')
      .insert({ ...incident, status: 'OPEN', started_at: new Date().toISOString(), created_by: actor.id, is_simulated: true })
      .select('*')
      .single(),
    'simulator: create incident'
  );

  const customerIds = [...new Set(orders.map((o) => o.customer_id))];
  const [signals, customers] = await Promise.all([
    loadRiskSignals(customerIds),
    supabase
      .from('profiles')
      .select('id, name, segment, lifetime_value')
      .in('id', customerIds)
      .then((r) => unwrap(r, 'simulator: customers')),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // One row per customer. A customer with two affected orders gets the
  // higher-risk one — the unique(customer_id, incident_id) constraint means the
  // decision has to be made here rather than left to the database.
  const best = new Map();
  for (const order of orders) {
    const customer = customerById.get(order.customer_id);
    const sig = signals.get(order.customer_id);
    const risk = calculateCXRisk({
      segment: customer.segment,
      lifetimeValue: Number(customer.lifetime_value),
      delayHours: delayHoursFor(order),
      orderAmount: Number(order.amount),
      priorComplaintCount: sig.priorComplaintCount,
      latestSentiment: sig.latestSentiment,
      incidentCountLast90Days: sig.incidentCountLast90Days + 1,
    });

    const existing = best.get(order.customer_id);
    if (!existing || risk.score > existing.risk_score) {
      best.set(order.customer_id, {
        customer_id: order.customer_id,
        incident_id: created.id,
        order_id: order.id,
        risk_score: risk.score,
        risk_level: risk.level,
        risk_factors: risk.factors,
        status: 'IDENTIFIED',
      });
    }
  }

  const links = [...best.values()];
  unwrap(
    await supabase.from('customer_incidents').insert(links).select('id'),
    'simulator: link customers'
  );

  const summary = {
    incidentId: created.id,
    affectedOrders: orders.length,
    affectedCustomers: links.length,
    high: links.filter((l) => l.risk_level === 'HIGH').length,
    medium: links.filter((l) => l.risk_level === 'MEDIUM').length,
    low: links.filter((l) => l.risk_level === 'LOW').length,
  };

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'simulator.run',
    entityType: 'incident',
    entityId: created.id,
    metadata: { type: created.type, ...summary },
  });

  return { incident: created, ...summary };
}

/**
 * Delivery delay — the primary demo scenario.
 *
 * Deterministic by construction: it picks the 17 oldest-created orders whose
 * carrier is BlueDart, which is exactly the seeded cohort. Ordering by a stable
 * column rather than sampling is what keeps the affected count and the
 * HIGH-risk count identical on every run.
 *
 * @param {object} actor
 */
export async function simulateDeliveryDelay(actor) {
  await clearPreviousSimulation('DELIVERY_DELAY');

  // The seed writes the 17 hand-authored demo customers first, so they own
  // order numbers RA-1001..RA-1017. Selecting that range is deterministic and,
  // crucially, immune to status drift.
  //
  // Selecting by status instead does NOT work, which cost real debugging time:
  // executing a priority-delivery action moves an order to IN_TRANSIT, so
  // resolving Priya removed her from a `status = DELAYED` selection, and the
  // query silently backfilled with unrelated filler orders — one of which was
  // 2040 hours "late". The cohort is a fixed set of orders, so it is selected
  // as one.
  const orders = unwrap(
    await supabase
      .from('orders')
      .select('id, customer_id, amount, expected_delivery, current_eta')
      .gte('order_number', 'RA-1001')
      .lte('order_number', 'RA-1017')
      .order('order_number', { ascending: true }),
    'simulator: demo cohort orders'
  );

  // Re-anchor each order's delay to now while PRESERVING its own duration.
  //
  // The seed authors a spread of delays (26h, 30h, 50h, 72h...) and that spread
  // is what produces the 5 HIGH / 6 MEDIUM / 6 LOW mix the demo narrates.
  // Forcing a uniform 72h on every order pushed 7 customers into HIGH and
  // flattened the story. Re-anchoring instead keeps the mix while stopping the
  // delay from growing without bound as the seed ages.
  const now = Date.now();
  for (const order of orders) {
    const existing = Math.round(
      (new Date(order.current_eta ?? now) - new Date(order.expected_delivery ?? now)) / HOUR
    );
    const delayHours = existing > 0 ? existing : 72;
    const expectedIso = new Date(now - delayHours * HOUR).toISOString();
    const etaIso = new Date(now).toISOString();

    unwrap(
      await supabase
        .from('orders')
        .update({ status: 'DELAYED', expected_delivery: expectedIso, current_eta: etaIso })
        .eq('id', order.id)
        .select('id'),
      'simulator: delay order'
    );
    order.expected_delivery = expectedIso;
    order.current_eta = etaIso;
  }

  return buildIncident({
    incident: {
      type: 'DELIVERY_DELAY',
      severity: 'HIGH',
      title: 'Carrier hub delay — BlueDart North Zone',
      description:
        'BlueDart North Zone sorting hub reported a 72-hour processing backlog following a facility closure. ' +
        'Outbound shipments routed through this hub are delayed and downstream ETAs have been revised.',
    },
    orders,
    delayHoursFor: (o) =>
      Math.max(0, Math.round((new Date(o.current_eta) - new Date(o.expected_delivery)) / HOUR)),
    actor,
  });
}

/** @param {object} actor */
export async function simulatePaymentFailure(actor) {
  await clearPreviousSimulation('PAYMENT_FAILURE');

  const orders = unwrap(
    await supabase
      .from('orders')
      .select('id, customer_id, amount, expected_delivery, current_eta')
      .in('status', ['PLACED', 'PROCESSING'])
      .order('amount', { ascending: false })
      .limit(9),
    'simulator: payment orders'
  );

  for (const order of orders) {
    unwrap(
      await supabase.from('orders').update({ status: 'PAYMENT_FAILED' }).eq('id', order.id).select('id'),
      'simulator: fail payment'
    );
  }

  return buildIncident({
    incident: {
      type: 'PAYMENT_FAILURE',
      severity: 'HIGH',
      title: 'Payment gateway timeouts — UPI authorization',
      description:
        'The payment provider is returning elevated authorization timeouts on UPI. Affected orders are held ' +
        'for 48 hours and customers must be given a secure retry link.',
    },
    orders,
    // Not a delay incident: the delay factor must not contribute here.
    delayHoursFor: () => 0,
    actor,
  });
}

/** @param {object} actor */
export async function simulateInventoryShortage(actor) {
  await clearPreviousSimulation('INVENTORY_SHORTAGE');

  const orders = unwrap(
    await supabase
      .from('orders')
      .select('id, customer_id, amount, product_name, expected_delivery, current_eta')
      .in('status', ['PLACED', 'PROCESSING', 'SHIPPED'])
      .order('created_at', { ascending: false })
      .limit(12),
    'simulator: inventory orders'
  );

  const now = Date.now();
  for (const order of orders) {
    unwrap(
      await supabase
        .from('orders')
        .update({ status: 'PROCESSING', current_eta: new Date(now + 5 * DAY).toISOString() })
        .eq('id', order.id)
        .select('id'),
      'simulator: hold order'
    );
    order.current_eta = new Date(now + 5 * DAY).toISOString();
  }

  return buildIncident({
    incident: {
      type: 'INVENTORY_SHORTAGE',
      severity: 'MEDIUM',
      title: 'Stock shortfall — supplier shipment delayed',
      description:
        'A delayed supplier shipment has left several SKUs oversold across two warehouses. Affected orders ' +
        'cannot be fulfilled on the original date and customers need proactive options.',
    },
    orders,
    delayHoursFor: (o) =>
      o.expected_delivery
        ? Math.max(0, Math.round((new Date(o.current_eta) - new Date(o.expected_delivery)) / HOUR))
        : 0,
    actor,
  });
}

export const SCENARIOS = {
  'delivery-delay': simulateDeliveryDelay,
  'payment-failure': simulatePaymentFailure,
  'inventory-shortage': simulateInventoryShortage,
};
