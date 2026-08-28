/**
 * Analytics.
 *
 * Every number here is computed from the database. No AI call is made on this
 * path — dashboard metrics are arithmetic, and spending model quota to count
 * rows would be both slower and less accurate.
 */
import { supabase, unwrap } from '../config/supabase.js';
import { delayHoursBetween } from './risk.js';

const DAY = 24 * 3_600_000;

const countOf = async (table, apply = (q) => q) => {
  const { count, error } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }));
  if (error) {
    const e = new Error(`analytics ${table}: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }
  return count ?? 0;
};

/**
 * The six dashboard KPIs.
 *
 * "Estimated tickets avoided" is a modelled figure, not a measurement — we
 * cannot observe a ticket that was never filed. It is defined explicitly as
 * proactive contacts on MEDIUM/HIGH risk cases, which is the population that
 * would plausibly have complained, and the API labels it as an estimate so the
 * UI cannot present it as fact.
 */
export async function getOverview() {
  const [
    activeIncidents,
    customersAtRisk,
    aiResolved,
    proactivelyContacted,
    escalations,
    pendingApprovals,
    creditRows,
    ticketsAvoidedBase,
  ] = await Promise.all([
    countOf('incidents', (q) => q.in('status', ['OPEN', 'INVESTIGATING', 'MITIGATING'])),
    countOf('customer_incidents', (q) => q.in('risk_level', ['HIGH', 'MEDIUM']).neq('status', 'RESOLVED')),
    countOf('actions', (q) => q.eq('status', 'EXECUTED').eq('ai_generated', true)),
    countOf('conversations', (q) => q.eq('is_outbound', true)),
    countOf('actions', (q) => q.eq('status', 'ESCALATED')),
    countOf('actions', (q) => q.eq('status', 'PROPOSED').eq('requires_approval', true)),
    supabase
      .from('actions')
      .select('amount')
      .in('status', ['EXECUTED', 'APPROVED'])
      .gt('amount', 0)
      .then((r) => unwrap(r, 'analytics credit')),
    countOf('customer_incidents', (q) => q.eq('status', 'RESOLVED').in('risk_level', ['HIGH', 'MEDIUM'])),
  ]);

  return {
    activeIncidents,
    customersAtRisk,
    aiResolved,
    proactivelyContacted,
    estimatedTicketsAvoided: ticketsAvoidedBase,
    humanEscalations: escalations,
    pendingApprovals,
    totalCreditIssued: creditRows.reduce((s, r) => s + Number(r.amount), 0),
    // Stated so the UI can label it rather than implying it was measured.
    ticketsAvoidedBasis: 'Resolved MEDIUM/HIGH-risk customers who were contacted before they complained',
  };
}

/**
 * The triage queue: the actual work, not a summary of it.
 *
 * A dashboard that shows "5 HIGH, 6 MEDIUM, 6 LOW" tells an operator a number
 * they must then go and act on somewhere else. This returns the rows they act
 * on — who, why, what the agent proposes, and whether the customer has been
 * contacted yet — ranked worst-first.
 *
 * `contacted` is the operationally important field and cannot be derived from
 * the case status alone: a case can be ANALYZED with a recommendation sitting
 * unexecuted, which means the customer still knows nothing.
 *
 * @param {number} limit
 */
export async function getWorklist(limit = 12) {
  const links = unwrap(
    await supabase
      .from('customer_incidents')
      .select(
        'id, customer_id, incident_id, risk_score, risk_level, risk_factors, status, ai_recommendation, ' +
          'profiles!inner(id, name, segment, lifetime_value, preferred_channel), ' +
          'incidents!inner(id, title, type, severity, status), ' +
          'orders(id, order_number, product_name, amount, expected_delivery, current_eta)'
      )
      .neq('status', 'RESOLVED')
      .in('incidents.status', ['OPEN', 'INVESTIGATING', 'MITIGATING'])
      .order('risk_score', { ascending: false })
      .limit(limit),
    'worklist'
  );

  if (!links.length) return { rows: [], coverage: { total: 0, contacted: 0, uncontacted: 0, uncontactedHigh: 0 } };

  // One query for outreach across every customer on the page, rather than one
  // per row.
  const customerIds = [...new Set(links.map((l) => l.customer_id))];
  const outreach = unwrap(
    await supabase
      .from('conversations')
      .select('customer_id, incident_id')
      .eq('is_outbound', true)
      .in('customer_id', customerIds),
    'worklist outreach'
  );
  const contactedKey = new Set(outreach.map((o) => `${o.customer_id}:${o.incident_id}`));

  const rows = links.map((l) => {
    const order = l.orders;
    const contacted = contactedKey.has(`${l.customer_id}:${l.incident_id}`);
    return {
      id: l.id,
      customerId: l.customer_id,
      customerName: l.profiles.name,
      segment: l.profiles.segment,
      lifetimeValue: Number(l.profiles.lifetime_value),
      channel: l.profiles.preferred_channel,
      incidentId: l.incident_id,
      incidentTitle: l.incidents.title,
      incidentType: l.incidents.type,
      riskScore: l.risk_score,
      riskLevel: l.risk_level,
      // Top three only: an operator scanning a queue needs the reason, not the
      // full audit of it.
      topFactors: (l.risk_factors ?? []).slice(0, 3).map((f) => f.label),
      orderNumber: order?.order_number ?? null,
      productName: order?.product_name ?? null,
      orderAmount: order ? Number(order.amount) : 0,
      delayHours: order ? delayHoursBetween(order.expected_delivery, order.current_eta) : 0,
      analyzed: Boolean(l.ai_recommendation),
      proposedAction: l.ai_recommendation?.recommendedAction ?? null,
      proposedCredit: l.ai_recommendation?.creditAmount ?? 0,
      policyReference: l.ai_recommendation?.policyReference ?? null,
      contacted,
    };
  });

  return {
    rows,
    coverage: {
      total: rows.length,
      contacted: rows.filter((r) => r.contacted).length,
      uncontacted: rows.filter((r) => !r.contacted).length,
      uncontactedHigh: rows.filter((r) => !r.contacted && r.riskLevel === 'HIGH').length,
    },
  };
}

/**
 * Coverage across every unresolved case, not just the visible page.
 *
 * This is the number that says whether anyone is falling through, which is the
 * question a support lead actually opens the console to answer.
 */
export async function getCoverage() {
  const [links, outreach] = await Promise.all([
    supabase
      .from('customer_incidents')
      .select('customer_id, incident_id, risk_level, status, orders(amount)')
      .neq('status', 'RESOLVED')
      .then((r) => unwrap(r, 'coverage links')),
    supabase
      .from('conversations')
      .select('customer_id, incident_id')
      .eq('is_outbound', true)
      .then((r) => unwrap(r, 'coverage outreach')),
  ]);

  const contacted = new Set(outreach.map((o) => `${o.customer_id}:${o.incident_id}`));
  const isContacted = (l) => contacted.has(`${l.customer_id}:${l.incident_id}`);

  const band = (level) => {
    const inBand = links.filter((l) => l.risk_level === level);
    return {
      total: inBand.length,
      contacted: inBand.filter(isContacted).length,
      uncontacted: inBand.filter((l) => !isContacted(l)).length,
    };
  };

  return {
    total: links.length,
    contacted: links.filter(isContacted).length,
    high: band('HIGH'),
    medium: band('MEDIUM'),
    low: band('LOW'),
    // Order value sitting behind unresolved cases — the business framing of the
    // same queue, and the one a stakeholder reacts to.
    valueAtRisk: links
      .filter((l) => l.risk_level !== 'LOW')
      .reduce((sum, l) => sum + Number(l.orders?.amount ?? 0), 0),
  };
}

/** Risk distribution across unresolved cases. Feeds the analytics page. */
export async function getRiskDistribution() {
  const rows = unwrap(
    await supabase.from('customer_incidents').select('risk_level, status'),
    'analytics risk distribution'
  );
  const open = rows.filter((r) => r.status !== 'RESOLVED');
  return ['HIGH', 'MEDIUM', 'LOW'].map((level) => ({
    level,
    open: open.filter((r) => r.risk_level === level).length,
    total: rows.filter((r) => r.risk_level === level).length,
  }));
}

/** Highest-risk unresolved customers. */
export async function getTopRiskCustomers(limit = 5) {
  const rows = unwrap(
    await supabase
      .from('customer_incidents')
      .select('id, customer_id, incident_id, risk_score, risk_level, status, profiles!inner(name, segment, lifetime_value), incidents!inner(title, type)')
      .neq('status', 'RESOLVED')
      .order('risk_score', { ascending: false })
      .limit(limit),
    'analytics top risk'
  );

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    incidentId: r.incident_id,
    name: r.profiles.name,
    segment: r.profiles.segment,
    lifetimeValue: Number(r.profiles.lifetime_value),
    riskScore: r.risk_score,
    riskLevel: r.risk_level,
    incidentTitle: r.incidents.title,
    incidentType: r.incidents.type,
  }));
}

/** Recent AI actions for the dashboard feed. */
export async function getRecentActions(limit = 8) {
  const rows = unwrap(
    await supabase
      .from('actions')
      .select('id, action_type, amount, status, policy_reference, ai_generated, created_at, profiles!inner(name)')
      .order('created_at', { ascending: false })
      .limit(limit),
    'analytics recent actions'
  );
  return rows.map(({ profiles, ...a }) => ({ ...a, amount: Number(a.amount), customerName: profiles.name }));
}

/**
 * Day-by-day series for the analytics page.
 *
 * Bucketed in JS over a single windowed query rather than one query per day:
 * 30 days would otherwise be 30 round trips for data that fits in one response.
 *
 * @param {number} days
 */
export async function getTrends(days = 14) {
  const since = new Date(Date.now() - days * DAY).toISOString();

  const [actions, links, conversations] = await Promise.all([
    supabase
      .from('actions')
      .select('status, amount, created_at, ai_generated')
      .gte('created_at', since)
      .then((r) => unwrap(r, 'trend actions')),
    supabase
      .from('customer_incidents')
      .select('risk_level, status, created_at')
      .gte('created_at', since)
      .then((r) => unwrap(r, 'trend links')),
    supabase
      .from('conversations')
      .select('created_at')
      .eq('is_outbound', true)
      .gte('created_at', since)
      .then((r) => unwrap(r, 'trend outreach')),
  ]);

  const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);
  const series = [];

  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    const dayActions = actions.filter((a) => dayKey(a.created_at) === key);
    series.push({
      date: key,
      resolved: dayActions.filter((a) => a.status === 'EXECUTED').length,
      escalated: dayActions.filter((a) => a.status === 'ESCALATED').length,
      atRisk: links.filter((l) => dayKey(l.created_at) === key && l.risk_level !== 'LOW').length,
      contacted: conversations.filter((c) => dayKey(c.created_at) === key).length,
      creditIssued: dayActions
        .filter((a) => ['EXECUTED', 'APPROVED'].includes(a.status))
        .reduce((s, a) => s + Number(a.amount), 0),
    });
  }

  // Running total, so the "tickets avoided" area chart shows accumulation.
  let cumulative = 0;
  for (const point of series) {
    cumulative += point.resolved;
    point.cumulativeAvoided = cumulative;
  }

  return series;
}

/** Incident analytics: counts by type, severity and status, plus resolution mix. */
export async function getIncidentAnalytics() {
  const [incidents, actions] = await Promise.all([
    supabase.from('incidents').select('type, severity, status').then((r) => unwrap(r, 'incident analytics')),
    supabase.from('actions').select('action_type, status').then((r) => unwrap(r, 'action mix')),
  ]);

  const tally = (rows, key) =>
    Object.entries(
      rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {})
    ).map(([name, value]) => ({ name, value }));

  const executed = actions.filter((a) => a.status === 'EXECUTED');
  const decided = actions.filter((a) => ['EXECUTED', 'REJECTED', 'ESCALATED'].includes(a.status));

  return {
    byType: tally(incidents, 'type'),
    bySeverity: tally(incidents, 'severity'),
    byStatus: tally(incidents, 'status'),
    resolutionMix: tally(executed, 'action_type'),
    // Guarded: an empty action table would otherwise produce NaN in the UI.
    escalationRate: decided.length
      ? Number(((actions.filter((a) => a.status === 'ESCALATED').length / decided.length) * 100).toFixed(1))
      : 0,
    automationRate: executed.length
      ? Number(((executed.filter((a) => a.status === 'EXECUTED').length / executed.length) * 100).toFixed(1))
      : 0,
  };
}
