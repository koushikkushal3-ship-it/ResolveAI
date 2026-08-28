# API Specification

Base URL: `{API_URL}/api`

## Conventions

**Responses**

```jsonc
{ "data": { }, "meta": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ ] } }
```

**Auth** — every route except `/health` and the auth entry points requires
`Authorization: Bearer <jwt>`.

**Validation** — every body, path parameter and query value passes through Zod.
Unknown keys are stripped, so an unvalidated field can never reach a service.

**Status codes**

| Code | Meaning |
|---|---|
| `400` | Validation failed — `details` names the field |
| `401` | Missing, malformed or expired token |
| `403` | Authenticated but not permitted (role, or ownership) |
| `404` | Not found |
| `409` | Illegal state transition (e.g. approving an EXECUTED action) |
| `413` | Body over the 100 kB cap |
| `429` | Rate limited |
| `500` / `503` | Safe generic; the real cause is logged server-side only |

**List parameters** — every list endpoint accepts
`?search=&status=&sort=&order=&page=&limit=`. `sort` is an allow-list per
resource, never free text, because the value reaches the query builder.

**Rate limits** — auth 10 / 15 min per IP; agent and simulator 20 / 15 min per
user; global 300 / 15 min.

---

## Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | Open for the **first** account only, which is bootstrapped as ADMIN. ADMIN-only thereafter. |
| `POST` | `/auth/login` | Returns `{ user, token }` |
| `GET` | `/auth/me` | Re-reads the user row, so a deactivated account loses access immediately rather than at token expiry |
| `PATCH` | `/auth/me` | Update name / email |
| `POST` | `/auth/change-password` | Requires the current password |
| `GET` | `/auth/users` | ADMIN only |

```jsonc
// POST /auth/login
{ "email": "supervisor@resolveai.demo", "password": "ResolveAI#2026" }
// 200
{ "data": { "user": { "id": "…", "email": "…", "fullName": "…", "role": "SUPERVISOR" },
            "token": "eyJ…" } }
```

Failed logins return one message — `Invalid email or password` — for both a
wrong password and an unknown address, and take the same time, because uniform
wording alone does not stop account enumeration.

## Customers

| Method | Path | Notes |
|---|---|---|
| `GET` | `/customers` | `?search=&segment=&riskLevel=&sort=name\|lifetime_value\|segment\|created_at` |
| `GET` | `/customers/:id` | **Customer 360** — customer, orders, conversations, actions, incidents, live-recomputed risk |

Customers are read-only: they are simulated upstream records, not something a
support console should edit.

## Orders

| Method | Path | Notes |
|---|---|---|
| `GET` | `/orders` | `?customerId=&status=&search=` |
| `GET` | `/orders/:id` | |
| `PATCH` | `/orders/:id` | Operational fields only — `status`, `currentEta`, `priority`, `carrier`. Amount and customer are deliberately not writable. |

## Incidents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/incidents` | `?search=&status=&severity=&type=&mine=` |
| `GET` | `/incidents/:id` | Detail + affected customers ranked by risk |
| `POST` | `/incidents` | |
| `PATCH` | `/incidents/:id` | AGENT may modify only incidents they created |
| `DELETE` | `/incidents/:id` | **Soft archive.** A hard delete would cascade through `customer_incidents` and destroy the risk snapshots and AI recommendations behind decisions already communicated to customers. |
| `POST` | `/incidents/:id/rescore` | Recompute risk for every affected customer |

## Agent

| Method | Path | Notes |
|---|---|---|
| `POST` | `/agent/analyze` | **No side effects.** Safe to call repeatedly. |
| `POST` | `/agent/resolve` | Guardrails, then execute or queue for approval |
| `POST` | `/agent/chat` | Grounded Q&A over one customer and the policy base |
| `POST` | `/agent/tool` | Direct tool invocation — same registry, validation, authorization and audit path the model's requests take |
| `GET` | `/agent/tools` | Registry listing |
| `GET` | `/agent/context` | Decision evidence without calling a model |

```jsonc
// POST /agent/analyze  { "customerId": "…", "incidentId": "…", "force": false }
{ "data": {
  "incidentSummary": "…",
  "recommendedAction": "PRIORITY_DELIVERY_AND_CREDIT",
  "creditAmount": 500,
  "customerMessage": "…",
  "requiresHumanApproval": false,
  "policyReference": "delivery-compensation-v2",
  "confidence": 0.95,
  "rationale": "one sentence of decision evidence",
  "source": "GEMINI",
  "aiGenerated": true,
  "risk": { "score": 91, "level": "HIGH", "factors": [ ] },
  "cached": false
} }
```

`riskScore` and `riskLevel` are **not** model outputs. They are computed by
`services/risk.js` and attached by the backend.

The recommendation is cached on `customer_incidents`, so re-opening a customer
re-reads the row instead of spending quota. Pass `force: true` to bypass.

## Actions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/actions` | `?status=&customerId=&incidentId=&mine=` |
| `GET` | `/actions/:id` | |
| `POST` | `/actions` | Manual proposal — guardrails still apply |
| `GET` | `/actions/guardrails` | The live thresholds, so the UI states real numbers |
| `POST` | `/actions/:id/approve` | **SUPERVISOR+**, and never the proposer |
| `POST` | `/actions/:id/reject` | **SUPERVISOR+** |

Lifecycle: `PROPOSED → APPROVED → EXECUTED`, or `→ REJECTED`, or `→ ESCALATED →
APPROVED | REJECTED`. `EXECUTED` and `REJECTED` are terminal; anything else
returns `409`.

## Knowledge base

| Method | Path | Notes |
|---|---|---|
| `GET` | `/knowledge` | `?search=` runs the same ranked full-text retrieval the agent uses |
| `GET` | `/knowledge/:id` | |
| `POST` | `/knowledge` | **SUPERVISOR+** |
| `PATCH` | `/knowledge/:id` | **SUPERVISOR+**. Editing content auto-bumps the version. |
| `DELETE` | `/knowledge/:id` | **SUPERVISOR+**, soft delete — executed actions cite policies by slug |

Policy text drives every AI recommendation, so writes are gated: letting any
agent rewrite it would be a way to change what the system will authorize
without touching code.

## Analytics

| Method | Path | Returns |
|---|---|---|
| `GET` | `/analytics/overview` | KPIs, risk distribution, recent actions, **triage worklist**, **outreach coverage** |
| `GET` | `/analytics/incidents` | `?days=7..90` — trends, counts by type/severity/status, resolution mix, escalation rate |

No AI call is made on this path. Dashboard metrics are arithmetic.

`estimatedTicketsAvoided` is **modelled, not measured** — a ticket that was
never filed cannot be observed. The response carries `ticketsAvoidedBasis` so
the UI can label it rather than implying it is a fact.

## Simulator

| Method | Path |
|---|---|
| `POST` | `/simulator/delivery-delay` |
| `POST` | `/simulator/payment-failure` |
| `POST` | `/simulator/inventory-shortage` |
| `GET` | `/simulator` |

Each scenario **replaces** its own previous run rather than stacking, otherwise
re-running inflates every score through the repeat-incident factor and the demo
stops matching its own narrative.

`delivery-delay` is deterministic: **17 orders, 17 customers, 5 HIGH / 6 MEDIUM
/ 6 LOW**, with Priya Sharma at exactly **91**, on every run.

## Health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Public. Returns provider **counts**, never keys. Target for an uptime pinger against Render's cold start. |
