/**
 * Read and CRUD routes: customers, orders, incidents, knowledge, analytics,
 * simulator.
 *
 * One module because they are thin: parse, call a service, shape a response.
 * Six near-identical files would be six places to drift.
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { agentLimiter } from '../middleware/rateLimit.js';
import { uuidParam } from '../validators/common.js';
import {
  listCustomersQuery,
  listOrdersQuery,
  updateOrderBody,
  listIncidentsQuery,
  createIncidentBody,
  updateIncidentBody,
  listKnowledgeQuery,
  createKnowledgeBody,
  updateKnowledgeBody,
  trendsQuery,
} from '../validators/resources.js';
import { listCustomers, getCustomer360 } from '../services/customers.js';
import {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  archiveIncident,
  rescoreIncident,
} from '../services/incidents.js';
import {
  listKnowledge,
  getKnowledge,
  createKnowledge,
  updateKnowledge,
  deactivateKnowledge,
} from '../services/knowledge.js';
import {
  getOverview,
  getRiskDistribution,
  getTopRiskCustomers,
  getRecentActions,
  getTrends,
  getIncidentAnalytics,
  getWorklist,
  getCoverage,
} from '../services/analytics.js';
import { SCENARIOS } from '../services/simulator.js';
import { supabase, unwrap } from '../config/supabase.js';
import { delayHoursBetween } from '../services/risk.js';
import { notFound, badRequest } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';

// --- customers ---------------------------------------------------------------
export const customersRouter = Router();
customersRouter.use(authenticate);

customersRouter.get(
  '/',
  validate({ query: listCustomersQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await listCustomers(req.query);
    res.json({ data, meta });
  })
);

customersRouter.get(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await getCustomer360(req.params.id) });
  })
);

// --- orders ------------------------------------------------------------------
export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.get(
  '/',
  validate({ query: listOrdersQuery }),
  asyncHandler(async (req, res) => {
    const { customerId, status, search, sort, order, page, limit } = req.query;
    const from = (page - 1) * limit;

    let request = supabase
      .from('orders')
      .select('id, customer_id, order_number, product_name, amount, status, expected_delivery, current_eta, carrier, priority, created_at, profiles!inner(name, segment)', { count: 'exact' });

    if (customerId) request = request.eq('customer_id', customerId);
    if (status) request = request.eq('status', status);
    if (search) request = request.or(`order_number.ilike.%${search}%,product_name.ilike.%${search}%`);

    const { data, error, count } = await request
      .order(sort, { ascending: order === 'asc' })
      .range(from, from + limit - 1);
    if (error) {
      const e = new Error(`list orders: ${error.message}`);
      e.isDatabaseError = true;
      throw e;
    }

    res.json({
      data: data.map(({ profiles, ...o }) => ({
        ...o,
        amount: Number(o.amount),
        customerName: profiles.name,
        customerSegment: profiles.segment,
        delayHours: delayHoursBetween(o.expected_delivery, o.current_eta),
      })),
      meta: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
    });
  })
);

ordersRouter.get(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    const order = unwrap(
      await supabase
        .from('orders')
        .select('*, profiles!inner(id, name, email, segment)')
        .eq('id', req.params.id)
        .maybeSingle(),
      'get order'
    );
    if (!order) throw notFound('Order');
    const { profiles, ...rest } = order;
    res.json({
      data: {
        ...rest,
        amount: Number(rest.amount),
        customer: profiles,
        delayHours: delayHoursBetween(rest.expected_delivery, rest.current_eta),
      },
    });
  })
);

ordersRouter.patch(
  '/:id',
  validate({ params: uuidParam(), body: updateOrderBody }),
  asyncHandler(async (req, res) => {
    const updates = {};
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.currentEta !== undefined) updates.current_eta = req.body.currentEta;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.carrier !== undefined) updates.carrier = req.body.carrier;

    const order = unwrap(
      await supabase.from('orders').update(updates).eq('id', req.params.id).select('*').maybeSingle(),
      'update order'
    );
    if (!order) throw notFound('Order');

    await audit({
      actorType: 'USER',
      actorId: req.user.id,
      action: 'order.updated',
      entityType: 'order',
      entityId: order.id,
      metadata: { fields: Object.keys(updates) },
    });

    res.json({ data: { ...order, amount: Number(order.amount) } });
  })
);

// --- incidents ---------------------------------------------------------------
export const incidentsRouter = Router();
incidentsRouter.use(authenticate);

incidentsRouter.get(
  '/',
  validate({ query: listIncidentsQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await listIncidents({ ...req.query, actorId: req.user.id });
    res.json({ data, meta });
  })
);

incidentsRouter.get(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await getIncident(req.params.id) });
  })
);

incidentsRouter.post(
  '/',
  validate({ body: createIncidentBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createIncident(req.body, req.user) });
  })
);

incidentsRouter.patch(
  '/:id',
  validate({ params: uuidParam(), body: updateIncidentBody }),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateIncident(req.params.id, req.body, req.user) });
  })
);

incidentsRouter.delete(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await archiveIncident(req.params.id, req.user) });
  })
);

incidentsRouter.post(
  '/:id/rescore',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await rescoreIncident(req.params.id) });
  })
);

// --- knowledge ---------------------------------------------------------------
export const knowledgeRouter = Router();
knowledgeRouter.use(authenticate);

knowledgeRouter.get(
  '/',
  validate({ query: listKnowledgeQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await listKnowledge(req.query);
    res.json({ data, meta });
  })
);

knowledgeRouter.get(
  '/:id',
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await getKnowledge(req.params.id) });
  })
);

// Policy text drives every AI recommendation, so writes are SUPERVISOR+.
knowledgeRouter.post(
  '/',
  requireRole('SUPERVISOR'),
  validate({ body: createKnowledgeBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createKnowledge(req.body, req.user) });
  })
);

knowledgeRouter.patch(
  '/:id',
  requireRole('SUPERVISOR'),
  validate({ params: uuidParam(), body: updateKnowledgeBody }),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateKnowledge(req.params.id, req.body, req.user) });
  })
);

knowledgeRouter.delete(
  '/:id',
  requireRole('SUPERVISOR'),
  validate({ params: uuidParam() }),
  asyncHandler(async (req, res) => {
    res.json({ data: await deactivateKnowledge(req.params.id, req.user) });
  })
);

// --- analytics ---------------------------------------------------------------
export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const [overview, riskDistribution, recentActions, worklist, coverage] = await Promise.all([
      getOverview(),
      getRiskDistribution(),
      getRecentActions(6),
      getWorklist(12),
      getCoverage(),
    ]);
    res.json({
      data: {
        ...overview,
        riskDistribution,
        recentActions,
        worklist: worklist.rows,
        coverage,
      },
    });
  })
);

analyticsRouter.get(
  '/incidents',
  validate({ query: trendsQuery }),
  asyncHandler(async (req, res) => {
    const [analytics, trends] = await Promise.all([
      getIncidentAnalytics(),
      getTrends(req.query.days),
    ]);
    res.json({ data: { ...analytics, trends } });
  })
);

// --- simulator ---------------------------------------------------------------
export const simulatorRouter = Router();
simulatorRouter.use(authenticate);

/**
 * One handler for all three scenarios, keyed by URL segment.
 *
 * Rate-limited with the agent limiter: a simulator run creates an incident and
 * scores every affected customer, so it is the most expensive write in the API.
 */
simulatorRouter.post(
  '/:scenario',
  agentLimiter,
  asyncHandler(async (req, res) => {
    const run = Object.prototype.hasOwnProperty.call(SCENARIOS, req.params.scenario)
      ? SCENARIOS[req.params.scenario]
      : undefined;
    if (!run) {
      throw badRequest(`Unknown scenario. Expected one of: ${Object.keys(SCENARIOS).join(', ')}`);
    }
    res.status(201).json({ data: await run(req.user) });
  })
);

simulatorRouter.get('/', (req, res) => {
  res.json({ data: Object.keys(SCENARIOS).map((slug) => ({ slug, endpoint: `/api/simulator/${slug}` })) });
});
