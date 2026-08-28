<div align="center">

<img src="frontend/public/favicon.svg" width="64" alt="" />

# ResolveAI

**Resolve problems before customers have to ask.**

A proactive AI customer-experience platform.

Theme: *AI for Customer Experience* · Build_to_Ship Hackathon

*This repository is named `SupportIQ`; the product is **ResolveAI**.*

</div>

---

## The problem

Customer support is reactive:

```
Problem → customer notices → customer complains → support investigates
        → policy lookup    → resolution        → communication
```

The real failure sits one step earlier. A business usually knows an operational
event has happened — a carrier hub is backed up, a payment gateway is timing out,
a SKU is oversold — **before it knows which customers that event is about to
hurt, and which of them are about to churn over it.**

The cost is avoidable tickets, inconsistent service, no personalization, and a
support queue that grows for reasons nobody chose.

## The solution

ResolveAI inverts the sequence:

```
Detect → Understand → Score → Retrieve policy → Decide → Validate → Act → Notify → Measure
```

| Stage | What happens | Where it lives |
|---|---|---|
| **Detect** | An incident is created, or simulated | `/simulator` |
| **Understand** | Affected orders and customers resolved from the incident | backend |
| **Score** | **Deterministic** CX risk 0–100 with named factors — no AI | `services/risk.js` |
| **Retrieve** | Governing policy via PostgreSQL full-text search | `services/policy.js` |
| **Decide** | The model returns a structured JSON recommendation | `agent/` |
| **Validate** | Zod re-validates, then business guardrails run | `services/guardrails.js` |
| **Act** | Allowed actions execute; the rest queue for approval | `/actions` |
| **Notify** | A personalized message reaches the customer | `services/notify.js` |
| **Measure** | Coverage, tickets avoided, escalation rate | `/analytics` |

### The one idea that matters

> **The model proposes. The backend decides.**

No model output reaches the database without passing Zod validation, a tool
whitelist, a role check and the guardrail layer. No model-generated code is ever
executed.

The **risk score is computed before the model is called** and passed in as an
authoritative fact — so the model reasons about a number it cannot change. That
removes a whole class of hallucination rather than trying to detect it.

The decisive test, which passes: *a model claiming `requiresHumanApproval: false`
on a ₹5,000 credit is still stopped.* The model can ask **for** a human; it can
never clear a rule.

---

## Live demo

| | |
|---|---|
| **Application** | *(added at deployment)* |
| **API health** | *(added at deployment)* `/api/health` |
| **Repository** | https://github.com/koushikkushal3-ship-it/SupportIQ |

### Demo credentials

| Email | Role | Can |
|---|---|---|
| `supervisor@resolveai.demo` | SUPERVISOR | Approve and reject actions |
| `agent@resolveai.demo` | AGENT | Read and propose only |
| `admin@resolveai.demo` | ADMIN | Everything, plus user management |

Password for all three: **`ResolveAI#2026`**

> The backend runs on Render's free tier and sleeps after ~15 minutes idle.
> The first request may take 30–60s while it wakes; the UI shows a waking state
> rather than failing.

---

## The 90-second demo path

1. **Sign in** as the supervisor.
2. **Dashboard** — four numbers that drive an action, an outreach-coverage bar
   showing *0 of 17 contacted, 5 high-risk still waiting*, and a triage queue.
3. **Simulator → Simulate Delivery Delay.** A carrier hub backlog hits
   **17 orders / 17 customers / 5 high risk** — the same numbers every run.
4. **Open the incident**, then the top-risk customer.
5. **Customer 360** — Priya Sharma, premium, ₹8,999 order, 72h late, previous
   complaint, negative sentiment. **Risk 91/100 HIGH**, with every contributing
   factor listed.
6. **Analyze.** The policy `delivery-compensation-v2` is retrieved, and the model
   returns a structured recommendation with a one-sentence rationale.
7. **Execute.** The guardrail verdict appears — **SAFE TO EXECUTE**, within the
   ₹500 limit, confidence above threshold, policy matched — the action runs, and
   the customer message is sent.
8. **Analytics** updates: tickets avoided, coverage, resolution mix.

The customer never discovered the problem, explained it, or asked for help.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, React Router 7, Tailwind CSS v4, Axios, Recharts, lucide-react |
| Backend | Node.js, Express 5, JWT, bcrypt, Zod |
| Database | Supabase PostgreSQL — full-text search for policy retrieval |
| AI | Google Gemini (`@google/genai`), backend-only, structured JSON output, with Groq and OpenRouter as failover |
| Testing | Vitest, Playwright |
| Deployment | Vercel · Render · Supabase |

**JavaScript only.** No TypeScript anywhere.

---

## Prerequisites

- Node.js 20+ (developed on 24)
- A Supabase project (free tier)
- A Google Gemini API key — **optional**; the app has a deterministic fallback

## Environment variables

Copy each `.env.example` to `.env`. **Never commit a filled `.env`.**

**`backend/.env`**

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Backend only. Bypasses RLS. Never ship to a browser.** |
| `JWT_SECRET` | ≥32 chars — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRES_IN` | Default `8h` |
| `GEMINI_API_KEY` | Plus `GEMINI_API_KEY_2`, `_3`… rotated on quota errors |
| `GEMINI_MODEL` | Default `gemini-3.6-flash` |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Optional failover providers |
| `FRONTEND_URL` | Exact CORS origin |

**`frontend/.env`** — exactly one variable, `VITE_API_URL`, and it is not a
secret. Vite exposes every `VITE_*` value to the browser bundle, so nothing else
belongs here.

The backend **refuses to start** on a missing secret, naming the variable
without printing its value.

---

## Setup

### Supabase

1. Create a project (free tier; `ap-south-1` for an India-based demo).
2. **Project Settings → API** → copy `Project URL` and the `service_role` secret
   into `backend/.env`.
3. Open the **SQL Editor** and run, in order:
   - `backend/src/db/migrations/001_schema.sql`
   - `backend/src/db/migrations/002_rls.sql`
   - `backend/src/db/migrations/003_outbound_conversations.sql`
4. Verify — this should return 10 rows, all `true`:
   ```sql
   select tablename, rowsecurity from pg_tables
   where schemaname = 'public' order by tablename;
   ```

No extensions to enable. `gen_random_uuid()` and `tsvector` full-text search are
both core PostgreSQL.

### Gemini

Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
and put it in `backend/.env`. The app runs without one — a deterministic
rule-based fallback produces a valid recommendation and the UI labels it as such.

### Seed

```bash
cd backend && npm run seed
```

Must end with nine `PASS` lines, including `Priya Sharma = 91 HIGH`.

## Local development

```bash
cd backend  && npm install && npm run dev     # http://localhost:5000
cd frontend && npm install && npm run dev     # http://localhost:5173
```

## Testing

```bash
cd backend  && npm test                # 70 unit tests
cd frontend && npm run build           # production build
cd frontend && npx playwright test     # 14 E2E specs
```

Model providers are stubbed in unit tests. No test consumes API quota.

**Current state: 70/70 unit, 14/14 E2E, production build clean.**

The E2E suite is organised against the evaluation rubric, so a gap in the suite
maps to a gap in the score — the full journey, auth, authorization, CRUD,
search, validation, a runtime secret scan, responsive layout and accessibility.

---

## Security

Full detail in [`docs/SECURITY.md`](docs/SECURITY.md).

- bcrypt (cost 10), JWT with expiry and a per-request user re-read
- Zod on every body, param and query; the parsed result replaces the raw input
- Role **and** ownership authorization; separation of duties enforced in the
  service layer *and* by a database CHECK constraint
- helmet, exact-origin CORS, 100 kB body cap, tiered rate limits
- Append-only audit log for every decision
- **No provider key, service-role key or JWT secret in the browser** —
  grep-verified in the build and re-checked at runtime by an E2E test

**Row Level Security is enabled but is not the enforcement layer.** The backend
connects with the service-role key, which bypasses RLS by design; RLS is
defence-in-depth against a leaked `anon` key. This is stated plainly because a
security control you believe in but do not have is worse than one you know you
lack.

> No automated process can prove the absence of vulnerabilities. **No known
> critical or high security issues were identified by the selected checks and
> review.** Residual risks are listed in `docs/SECURITY.md`.

---

## Known limitations

- **Notification delivery is simulated.** No live SMS/email provider. The
  conversation and message rows are real, so outreach appears in the customer
  timeline and in analytics exactly as a live send would — only the transport is
  absent. The hackathon brief requires the demo to work without third-party
  integrations.
- **"Tickets avoided" is modelled, not measured.** A ticket that was never filed
  cannot be observed. The API returns its basis and the UI labels it.
- **Render's free tier sleeps.** First request after idle takes 30–60s.
- **The JWT lives in `localStorage`**, which is XSS-reachable. A deliberate
  trade for a cross-origin SPA; mitigations and the upgrade path are documented.
- **Policy retrieval is lexical, not semantic.** Correct for eight short
  documents; a larger corpus would want pgvector behind the same interface.
- **Rate limiting is in-process** — per-instance, resets on restart.
- **Demo credentials are public**, by requirement. They must not be reused.

---

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Topology, request path, where intelligence lives, what was deliberately not built |
| [API_SPEC](docs/API_SPEC.md) | Every endpoint, payloads, status codes, rate limits |
| [DATABASE](docs/DATABASE.md) | Schema, constraints, indexes, RLS posture, migrations, seed |
| [AI_AGENT](docs/AI_AGENT.md) | Risk engine, RAG, structured output, tools, guardrails, injection defence, cost |
| [SECURITY](docs/SECURITY.md) | Controls, checks performed, residual risks, key-exposure procedure |
| [RUNBOOK](docs/RUNBOOK.md) | Setup, deployment, troubleshooting, routine operations |
| [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) | Build plan, requirements validation, risk register |

## Submission

Everything an evaluator needs is in **[`submission/`](submission/)** — the
architecture documentation, the AI integration breakdown, the demo script,
captured test evidence, and a rubric mapping.

> The brief writes `/client` and `/server`. This repository uses **`frontend/`**
> (the React client) and **`backend/`** (the Express server) for the same
> separation.

## Repository layout

```
SupportIQ/
├── backend/          Express API (the "server") — the only process holding secrets
│   └── src/
│       ├── agent/    prompt, schema, LLM chain, tools, fallback, orchestrator
│       ├── services/ risk, policy, guardrails, actions, simulator, analytics
│       ├── db/       migrations + deterministic seed
│       └── ...       routes, controllers, middleware, validators
├── frontend/         React SPA (the "client") — knows one variable, VITE_API_URL
│   ├── src/          components, pages, hooks, services, layouts
│   └── e2e/          Playwright critical-flow suite
├── docs/             The seven documents above
└── submission/       Deliverables 1 & 2, demo script, test evidence
```
