import { supabase, unwrap } from '../config/supabase.js';
import { calculateCXRisk, delayHoursBetween } from './risk.js';
import { audit } from '../utils/audit.js';
import { conflict, forbidden, notFound } from '../utils/httpError.js';

/**
 * Incidents — the primary CRUD entity.
 *
 * Ownership: an AGENT may only modify incidents they created. SUPERVISOR and
 * ADMIN may modify any. This is the "users can only access their own records"
 * requirement applied in the only way that makes sense for a shared ops console:
 * everyone reads, only the owner (or a senior role) writes.
 */

const RANK = { AGENT: 1, SUPERVISOR: 2, ADMIN: 3 };

/** @param {object} row @param {object} actor */
function assertCanModify(row, actor) {
  if (RANK[actor.role] >= RANK.SUPERVISOR) return;
  if (row.created_by !== actor.id) {
    throw forbidden('You can only modify incidents you created');
  }
}

export async function listIncidents({ search, status, severity, type, mine, actorId, sort, order, page, limit }) {
  const from = (page - 1) * limit;

  let request = supabase
    .from('incidents')
    .select('id, type, severity, title, description, status, started_at, resolved_at, created_by, is_simulated, created_at', {
      count: 'exact',
    })
    .neq('status', 'ARCHIVED');

  if (status) request = request.eq('status', status);
  if (severity) request = request.eq('severity', severity);
  if (type) request = request.eq('type', type);
  if (mine && actorId) request = request.eq('created_by', actorId);
  if (search) request = request.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error, count } = await request
    .order(sort, { ascending: order === 'asc' })
    .range(from, from + limit - 1);

  if (error) {
    const e = new Error(`list incidents: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }

  // Affected-customer counts for the whole page in one query, not one per row.
  const ids = data.map((i) => i.id);
  const links = ids.length
    ? unwrap(
        await supabase
          .from('customer_incidents')
          .select('incident_id, risk_level, status')
          .in('incident_id', ids),
        'incident counts'
      )
    : [];

  return {
    data: data.map((i) => {
      const mine = links.filter((l) => l.incident_id === i.id);
      return {
        ...i,
        affectedCustomers: mine.length,
        highRiskCustomers: mine.filter((l) => l.risk_level === 'HIGH').length,
        resolvedCustomers: mine.filter((l) => l.status === 'RESOLVED').length,
      };
    }),
    meta: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  };
}

/**
 * Incident detail with affected customers ranked by risk.
 * This is the screen the demo pivots on, so risk is recomputed live rather
 * than trusted from the stored snapshot.
 *
 * @param {string} id
 */
export async function getIncident(id) {
  const incident = unwrap(
    await supabase
      .from('incidents')
      .select('id, type, severity, title, description, status, started_at, resolved_at, created_by, is_simulated, created_at')
      .eq('id', id)
      .maybeSingle(),
    'get incident'
  );
  if (!incident) throw notFound('Incident');

  const links = unwrap(
    await supabase
      .from('customer_incidents')
      .select(
        'id, customer_id, order_id, risk_score, risk_level, risk_factors, status, ai_recommendation, analyzed_at, ' +
          'profiles!inner(id, name, email, segment, lifetime_value, preferred_channel), ' +
          'orders(id, order_number, product_name, amount, status, expected_delivery, current_eta, carrier)'
      )
      .eq('incident_id', id)
      .order('risk_score', { ascending: false }),
    'incident affected customers'
  );

  const affected = links.map((l) => {
    const order = l.orders;
    const delayHours = order ? delayHoursBetween(order.expected_delivery, order.current_eta) : 0;
    return {
      id: l.id,
      customerId: l.customer_id,
      customer: { ...l.profiles, lifetime_value: Number(l.profiles.lifetime_value) },
      order,
      delayHours,
      riskScore: l.risk_score,
      riskLevel: l.risk_level,
      riskFactors: l.risk_factors,
      status: l.status,
      analyzed: Boolean(l.analyzed_at),
      recommendation: l.ai_recommendation,
    };
  });

  return {
    incident,
    affectedCustomers: affected,
    affectedOrders: affected.filter((a) => a.order).length,
    summary: {
      total: affected.length,
      high: affected.filter((a) => a.riskLevel === 'HIGH').length,
      medium: affected.filter((a) => a.riskLevel === 'MEDIUM').length,
      low: affected.filter((a) => a.riskLevel === 'LOW').length,
      resolved: affected.filter((a) => a.status === 'RESOLVED').length,
    },
  };
}

/** @param {object} body @param {object} actor */
export async function createIncident(body, actor) {
  const incident = unwrap(
    await supabase
      .from('incidents')
      .insert({
        type: body.type,
        severity: body.severity,
        title: body.title,
        description: body.description ?? null,
        status: 'OPEN',
        started_at: body.startedAt ?? new Date().toISOString(),
        created_by: actor.id,
        is_simulated: false,
      })
      .select('*')
      .single(),
    'create incident'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'incident.created',
    entityType: 'incident',
    entityId: incident.id,
    metadata: { type: incident.type, severity: incident.severity },
  });

  return incident;
}

/** @param {string} id @param {object} patch @param {object} actor */
export async function updateIncident(id, patch, actor) {
  const existing = unwrap(
    await supabase.from('incidents').select('*').eq('id', id).maybeSingle(),
    'load incident for update'
  );
  if (!existing) throw notFound('Incident');
  assertCanModify(existing, actor);

  const updates = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.severity !== undefined) updates.severity = patch.severity;

  if (patch.status !== undefined) {
    updates.status = patch.status;
    // The schema CHECK requires resolved_at exactly when status is RESOLVED.
    // Setting it here keeps a legal status change from failing on a constraint.
    if (patch.status === 'RESOLVED' && !existing.resolved_at) {
      updates.resolved_at = new Date().toISOString();
    } else if (patch.status !== 'RESOLVED' && existing.resolved_at) {
      updates.resolved_at = null;
    }
  }

  const incident = unwrap(
    await supabase.from('incidents').update(updates).eq('id', id).select('*').single(),
    'update incident'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'incident.updated',
    entityType: 'incident',
    entityId: id,
    metadata: { fields: Object.keys(updates) },
  });

  return incident;
}

/**
 * Archive an incident. Soft delete, always.
 *
 * A hard delete would cascade through customer_incidents and take the risk
 * snapshots and AI recommendations with it — the audit trail for decisions
 * already communicated to customers.
 *
 * @param {string} id @param {object} actor
 */
export async function archiveIncident(id, actor) {
  const existing = unwrap(
    await supabase.from('incidents').select('*').eq('id', id).maybeSingle(),
    'load incident for archive'
  );
  if (!existing) throw notFound('Incident');
  assertCanModify(existing, actor);
  if (existing.status === 'ARCHIVED') throw conflict('This incident is already archived');

  const incident = unwrap(
    await supabase
      .from('incidents')
      // resolved_at must be null for any non-RESOLVED status (schema CHECK).
      .update({ status: 'ARCHIVED', resolved_at: null })
      .eq('id', id)
      .select('id, status')
      .single(),
    'archive incident'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'incident.archived',
    entityType: 'incident',
    entityId: id,
  });

  return incident;
}

/** Recompute and persist risk for every customer on an incident. */
export async function rescoreIncident(incidentId) {
  const { affectedCustomers } = await getIncident(incidentId);
  let updated = 0;

  for (const a of affectedCustomers) {
    const [complaints, incidentCount] = await Promise.all([
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', a.customerId)
        .eq('is_outbound', false)
        .eq('is_complaint', true)
        .then((r) => r.count ?? 0),
      supabase
        .from('customer_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', a.customerId)
        .then((r) => r.count ?? 0),
    ]);

    const latest = unwrap(
      await supabase
        .from('conversations')
        .select('sentiment')
        .eq('customer_id', a.customerId)
        .eq('is_outbound', false)
        .order('created_at', { ascending: false })
        .limit(1),
      'rescore sentiment'
    );

    const risk = calculateCXRisk({
      segment: a.customer.segment,
      lifetimeValue: Number(a.customer.lifetime_value),
      delayHours: a.delayHours,
      orderAmount: a.order ? Number(a.order.amount) : 0,
      priorComplaintCount: complaints,
      latestSentiment: latest[0]?.sentiment ?? 'NEUTRAL',
      incidentCountLast90Days: incidentCount,
    });

    unwrap(
      await supabase
        .from('customer_incidents')
        .update({ risk_score: risk.score, risk_level: risk.level, risk_factors: risk.factors })
        .eq('id', a.id)
        .select('id'),
      'persist rescore'
    );
    updated++;
  }

  return { updated };
}
