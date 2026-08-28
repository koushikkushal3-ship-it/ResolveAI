# ResolveAI

> **Resolve problems before customers have to ask.**

A proactive AI customer-experience platform. ResolveAI detects an operational incident, works out
*which customers it actually hurts*, scores their experience risk, retrieves the governing business
policy, asks Gemini for a structured resolution, enforces business guardrails in the backend, and
contacts the customer — all before anyone opens a support ticket.

**Theme:** AI for Customer Experience · **Event:** Build_to_Ship Hackathon

> The repository is named `SupportIQ`; the product is **ResolveAI**.

---

## The problem

Customer support is reactive:

```
Problem  ->  customer notices  ->  customer complains  ->  support investigates
         ->  policy lookup     ->  resolution         ->  communication
```

The deeper failure sits one step earlier. A business usually knows an operational event has occurred —
a carrier hub is delayed, a payment gateway is failing, a SKU is out of stock — **before it knows which
customers that event is about to hurt, and which of them are about to churn over it.**

The cost: avoidable tickets, frustrated customers, inconsistent service, slow resolutions, no
personalization, and a support queue that grows for reasons nobody chose.

## The solution

ResolveAI inverts the sequence:

```
Detect -> Understand -> Score -> Retrieve Policy -> Decide -> Validate -> Act -> Notify -> Measure
```

| Stage | What happens | Where |
|---|---|---|
| Detect | An incident is created, or simulated | `/simulator`, `/incidents` |
| Understand | Affected orders and customers are resolved from the incident | backend |
| Score | **Deterministic** CX risk 0–100 with named factors — no AI | `services/risk.js` |
| Retrieve | Governing policy found by PostgreSQL full-text search | `services/policy.js` |
| Decide | Gemini returns a structured JSON recommendation | `agent/` |
| Validate | Zod re-validates, then business guardrails run | `agent/`, `services/actions.js` |
| Act | Allowed actions execute; the rest queue for human approval | `/actions` |
| Notify | A personalized message is generated for the customer | `services/notify.js` |
| Measure | Tickets avoided, escalation rate, resolution mix | `/analytics` |

**Gemini proposes. The backend decides.** No model output reaches the database without passing Zod
validation, a tool whitelist, role authorization and the guardrail layer. No LLM-generated code is
ever executed.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, Tailwind CSS v4, Axios, Recharts, lucide-react |
| Backend | Node.js, Express 5, JWT, bcrypt, Zod |
| Database | Supabase PostgreSQL (full-text search for policy retrieval) |
| AI | Google Gemini (`@google/genai`), backend-only, structured JSON output |
| Deployment | Vercel (frontend) · Render (backend) · Supabase (database) |

**JavaScript only.** No TypeScript anywhere in the project.

---

## Repository layout

```
SupportIQ/
├── backend/     Express API — the only process holding secrets
├── frontend/    React SPA — knows exactly one variable, VITE_API_URL
└── docs/        Plan, architecture, API spec, database, AI agent, security, runbook
```

---

## Prerequisites

- Node.js 20 or newer (developed on 24)
- A Supabase project (free tier)
- A Google Gemini API key (free tier) — *optional to run; the app has a deterministic fallback*

## Environment variables

Copy each `.env.example` to `.env` and fill it in. **Never commit a filled `.env`.**

**`backend/.env`**

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only. Bypasses RLS. Never ship to a browser. |
| `JWT_SECRET` | Signing secret. Generate a random 48-byte value. |
| `JWT_EXPIRES_IN` | Token lifetime (default `8h`) |
| `GEMINI_API_KEY` | Google Gemini key |
| `GEMINI_MODEL` | Default `gemini-3.6-flash` |
| `FRONTEND_URL` | Exact CORS origin of the frontend |

**`frontend/.env`**

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the backend API |

Vite exposes every `VITE_*` variable to the browser bundle, so that file holds exactly one
non-secret value. `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET` never appear
in frontend code, in the bundle, or in a commit.

---

## Local development

```bash
# Backend
cd backend
cp .env.example .env      # then fill it in
npm install
npm run seed              # once, after the migrations have been applied
npm run dev               # http://localhost:5000
```

```bash
# Frontend
cd frontend
cp .env.example .env      # then fill it in
npm install
npm run dev               # http://localhost:5173
```

## Supabase setup

1. Create a project (free tier, region `ap-south-1` for an India-based demo).
2. **Project Settings → API** — copy `Project URL` and the `service_role` secret into `backend/.env`.
3. Open the **SQL Editor** and run, in order:
   - `backend/src/db/migrations/001_schema.sql`
   - `backend/src/db/migrations/002_rls.sql`
4. `cd backend && npm run seed`

No extensions need enabling. `gen_random_uuid()` and `tsvector` full-text search are both core PostgreSQL.

## Gemini setup

1. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Put it in `backend/.env` as `GEMINI_API_KEY`.
3. The app runs without it — a deterministic rule-based fallback produces a valid recommendation and
   labels it as such in the UI.

---

## Testing

```bash
cd backend  && npm test    # Vitest unit + Supertest API
cd frontend && npm test    # Vitest + React Testing Library
cd frontend && npm run e2e # Playwright critical flow
```

Gemini is stubbed in tests. No test consumes API quota.

---

## Demo credentials

*Populated by the seed script — see the Demo walkthrough section.*

## Deployment

*Live URLs added after Phase 18.*

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md). Summary: bcrypt password hashing, JWT with expiry,
Zod validation on every input, role and ownership authorization, rate limiting, helmet headers,
strict CORS, audit logging, and backend-only AI credentials.

Row Level Security is enabled as defence-in-depth, but the backend connects with the service-role
key, which bypasses RLS by design — the enforced authorization is the Express middleware and service
layer. This is documented rather than glossed over.

## Limitations

*Completed at handoff.*

---

## Documentation

| File | Contents |
|---|---|
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Full build plan, scope tiers, risk register |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/API_SPEC.md` | Endpoint reference |
| `docs/DATABASE.md` | Schema and relationships |
| `docs/AI_AGENT.md` | Prompt design, schema, guardrails |
| `docs/SECURITY.md` | Controls and residual risks |
| `docs/RUNBOOK.md` | Operations and troubleshooting |
