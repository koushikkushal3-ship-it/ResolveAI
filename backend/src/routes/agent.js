import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { agentLimiter } from '../middleware/rateLimit.js';
import { analyzeBody, resolveBody, chatBody, toolBody } from '../validators/agent.js';
import { analyze, chat, loadDecisionContext } from '../agent/orchestrator.js';
import { executeTool, TOOL_NAMES, READ_ONLY_TOOLS } from '../agent/tools.js';
import { proposeAction } from '../services/actions.js';
import { badRequest } from '../utils/httpError.js';

export const agentRouter = Router();

agentRouter.use(authenticate);

/**
 * POST /api/agent/analyze
 * Pure analysis. Produces a recommendation and changes nothing the customer
 * can see, so it is safe to call repeatedly and safe to show before deciding.
 */
agentRouter.post(
  '/analyze',
  agentLimiter,
  validate({ body: analyzeBody }),
  asyncHandler(async (req, res) => {
    const result = await analyze({ ...req.body, actor: req.user });
    res.json({ data: result });
  })
);

/**
 * POST /api/agent/resolve
 * The endpoint that can change the world: takes a recommendation, runs the
 * guardrails, and either executes or queues for approval.
 *
 * Defaults to the cached recommendation so approving from the UI does not spend
 * a second Gemini call on a decision that was already made.
 */
agentRouter.post(
  '/resolve',
  agentLimiter,
  validate({ body: resolveBody }),
  asyncHandler(async (req, res) => {
    const { customerId, incidentId, useCached } = req.body;

    const recommendation = await analyze({
      customerId,
      incidentId,
      actor: req.user,
      force: !useCached,
    });

    const result = await proposeAction({
      customerId,
      incidentId,
      recommendation,
      policyFound: (recommendation.policiesConsidered ?? []).length > 0,
      actor: req.user,
    });

    res.status(201).json({
      data: {
        action: result.action,
        verdict: result.verdict ?? result.action?.guardrail_result,
        notification: result.notification ?? null,
        recommendation,
      },
    });
  })
);

/** POST /api/agent/chat — grounded Q&A over one customer and the policy base. */
agentRouter.post(
  '/chat',
  agentLimiter,
  validate({ body: chatBody }),
  asyncHandler(async (req, res) => {
    res.json({ data: await chat(req.body) });
  })
);

/**
 * POST /api/agent/tool
 * Direct tool invocation, for the agent workbench.
 *
 * The same registry, validation, authorization and audit path the model's
 * requests take. There is no second, looser route into the tools.
 */
agentRouter.post(
  '/tool',
  agentLimiter,
  validate({ body: toolBody }),
  asyncHandler(async (req, res) => {
    const result = await executeTool(req.body.tool, req.body.args, req.user, 'USER');
    res.json({ data: result });
  })
);

/** GET /api/agent/tools — registry listing, for the UI. */
agentRouter.get('/tools', (req, res) => {
  res.json({
    data: TOOL_NAMES.map((name) => ({ name, readOnly: READ_ONLY_TOOLS.includes(name) })),
  });
});

/**
 * GET /api/agent/context — the decision evidence behind a recommendation,
 * without calling the model. Backs the decision-trace panel.
 */
agentRouter.get(
  '/context',
  asyncHandler(async (req, res) => {
    const { customerId, incidentId } = req.query;
    if (!customerId || !incidentId) throw badRequest('customerId and incidentId are required');

    const ctx = await loadDecisionContext(String(customerId), String(incidentId));
    res.json({
      data: {
        customer: ctx.customer,
        incident: ctx.incident,
        order: ctx.order,
        risk: ctx.risk,
        history: ctx.history,
        delayHours: ctx.delayHours,
        cachedRecommendation: ctx.link?.ai_recommendation ?? null,
      },
    });
  })
);
