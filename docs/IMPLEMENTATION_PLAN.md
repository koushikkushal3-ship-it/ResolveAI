# ResolveAI — Implementation Plan

> **Resolve problems before customers have to ask.**
> Theme: **AI for Customer Experience** · Build_to_Ship Hackathon
> Status: **PLAN — awaiting approval. No application code written yet.**

---

## 0. Phase 1 Result — Repository Inspection

| Check | Finding |
|---|---|
| Project root | `C:\Users\marut\OneDrive\Desktop\SupportIQ` |
| Contents | **Completely empty.** No files, no hidden files. |
| Git repository | **No.** `git init` required (hackathon requires a public GitHub repo). |
| `package.json` | None |
| Source / DB / env / docs / tests | None |
| `.claude` in project | None |
| Node / npm / git | Node v24.14.0 · npm 11.18.0 · git 2.55.0 |
| Python (for skill scripts) | 3.13.5 |
| User skills installed | `ui-ux-pro-max`, `design`, `design-system`, `ui-styling`, `banner-design`, `brand`, `slides` |
| Bundled skills used | `ui-ux-pro-max` (design system), `ponytail` (scope control), `caveman` (prose style only) |

**Consequence:** the "preserve existing code" rule (Master §40) is vacuous — this is a greenfield build.
Nothing to run, nothing to preserve, no rewrite risk.

---

## 1. Requirements Validation

Three source documents were reconciled: the **Master Build Prompt**, the **Theme brief**, and the
**Hackathon rulebook**. They mostly agree. The following are genuine conflicts or gaps that this plan resolves.

### V1 — Master API surface is read-only; hackathon demands full CRUD **(BLOCKER-CLASS GAP)**
- Master §24 lists `GET` for customers/orders and only `POST /api/incidents`.
- Hackathon §03.1 requires **"Full Create, Read, Update, and Delete/Archive capabilities for primary application records"** and **"Search & Filtering"**. Full-Stack Implementation is **25% of the score**.
- **Resolution:** treat **Incidents**, **Actions** and **Knowledge Documents** as the primary CRUD entities and add `PATCH`/`DELETE` (soft-archive) plus `?search=&status=&severity=&sort=&page=` on all list endpoints. Customers/Orders stay read-only apart from mutable operational fields (order status/ETA) — they are simulated upstream records.

### V2 — "Data scoping" vs. an internal ops console **(CONFLICT)**
- Hackathon §03.2: *"User data must be securely isolated so users can only access their own records."*
- ResolveAI is a support-agent console; agents legitimately read all customer records.
- **Resolution:** two-layer authorization.
  - **Role layer:** `AGENT` / `SUPERVISOR` / `ADMIN`. Only `SUPERVISOR`+ can approve/reject actions or edit knowledge documents.
  - **Ownership layer:** every incident, action and knowledge document carries `created_by`. An `AGENT` may only update/delete rows they created; `?mine=true` filters to own records. Approving an action you proposed yourself is blocked (separation of duties).
  - Satisfies the isolation requirement without breaking the product.

### V3 — Naming collision: `profiles` **(CORRECTION)**
- Master §21 uses `profiles` for **customers**. Supabase convention uses `profiles` for **authenticated users**.
- Support agents are not customers — merging them breaks both auth and the CX model.
- **Resolution:** `app_users` = support agents (auth). `profiles` = customers (as Master specifies). Documented explicitly so it is never ambiguous.

### V4 — Priya Sharma must score exactly **91**; the given weights sum to 90 **(ARITHMETIC GAP)**
- Master §14 weights: premium 20 + delay>48h 30 + high-value 15 + prior complaint 15 + negative sentiment 10 = **90**. `repeat incident +10` does not apply to her (single incident), so 91 is unreachable.
- **Resolution:** add one deterministic continuous factor, **lifetime-value weight** = `min(floor(lifetime_value / 50000), 10)`. Seed Priya with `lifetime_value = ₹50,000` → **+1** → **exactly 91 / HIGH**. All Master weights preserved. Full table in §7.

### V5 — pgvector / embeddings vs. free-tier Gemini budget **(SCOPE)**
- Master §20 allows pgvector *"if semantic search is needed"* and forbids a separate vector DB.
- Embeddings burn Gemini quota and add a migration plus a backfill step on hackathon day.
- **Resolution:** **MUST HAVE** = Postgres full-text search (`tsvector` + GIN) over `knowledge_documents`, filtered by incident `category`. Deterministic, zero AI cost, zero extra infrastructure. **OPTIONAL** = a pgvector column added later behind the same `searchPolicy()` interface. Ponytail ladder rung 4 (native platform feature beats a new dependency).

### V6 — RLS cannot be the real authorization control **(HONESTY / §42)**
- The backend connects with `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS by design**.
- **Resolution:** RLS is enabled with deny-by-default policies as **defence-in-depth** (it protects against a leaked `anon` key). The **enforced** authorization is Express middleware plus service-layer checks. The docs say this plainly rather than claiming RLS secures the API.

### V7 — Master §8 requires 13 pages; hackathon build window is ~6.5 h **(SCHEDULE RISK)**
- **Resolution:** all 13 routes exist and are reachable (navigation completeness is graded). Depth is tiered — see §13 MUST / SHOULD / OPTIONAL. `/settings` and `/knowledge` ship thin-but-real, not stubs.

### V8 — Deployment uptime requirement vs. Render free tier **(OPERATIONAL RISK)**
- Hackathon §08.5: the app must stay live until winners are announced. Render free web services sleep after ~15 min idle and cold-start in 30–60 s.
- **Resolution:** the frontend shows a "waking backend…" state with a longer axios timeout on the first request; the README documents the cold start; a `/api/health` endpoint gives an external uptime pinger something to hit. Escalation path: Railway or Fly.io if Render proves unreliable.

### V9 — Style guard: "not a default AI purple gradient/orb interface" **(DESIGN CONSTRAINT)**
- Accepted as a hard constraint. The direction in §4 is a dark operations console — no purple, no gradient orbs, no chatbot-bubble shell.

### Confirmed-compatible (no action needed)
The stack is a strict subset of the hackathon's allowed stack · JavaScript-only is compatible with everything ·
Gemini backend-only is required by both documents · Supabase PostgreSQL is explicitly allowed ·
Vercel + Render is an approved target · `lucide-react` is explicitly named in the hackathon stack table,
which satisfies the "SVG icons, never emoji" rule without inventing a dependency.

---

## 2. Product Architecture

The whole product is one loop. Every screen is a window onto one stage of it.

```
Detect  ->  Understand  ->  Score  ->  Retrieve Policy  ->  Decide  ->  Validate  ->  Act  ->  Notify  ->  Measure
  |             |            |              |                 |            |          |         |          |
Simulator   Customer      Risk          Knowledge          Gemini      Zod +       Actions   Message   Analytics
/Incidents     360       Engine            Base         (structured) Guardrails   + Audit   preview   dashboard
                     (deterministic)   (full-text)          JSON      (backend)
```

Runtime topology — three deployed pieces, no microservices, no Docker requirement:

```
Browser
  |  HTTPS + JWT (Authorization: Bearer)
  v
Vercel  -- React 19 + Vite SPA (knows only VITE_API_URL)
  |  axios
  v
Render  -- Node + Express API   <-- the ONLY holder of GEMINI_API_KEY,
  |                                  SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
  +---------------> Supabase PostgreSQL   (data + full-text policy search)
  +---------------> Google Gemini API     (structured JSON output only)
```

**Trust boundary:** the browser never talks to Supabase or Gemini. There is exactly one privileged process.

---

## 3. Repository Layout

```
SupportIQ/
├── backend/
│   ├── src/
│   │   ├── config/          env.js (Zod-validated), supabase.js, gemini.js
│   │   ├── routes/          auth, customers, orders, incidents, agent, actions, analytics, simulator, knowledge
│   │   ├── controllers/     thin — parse, call service, shape response
│   │   ├── services/        risk.js, policy.js, actions.js, analytics.js, simulator.js, notify.js
│   │   ├── agent/           prompt.js, schema.js, gemini.js, tools.js, orchestrator.js, fallback.js
│   │   ├── middleware/      auth.js, requireRole.js, validate.js, rateLimit.js, error.js
│   │   ├── validators/      Zod schemas per resource
│   │   ├── db/              migrations/001_schema.sql, 002_rls.sql, seed.js
│   │   ├── utils/           audit.js, httpError.js, paginate.js
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/               vitest + supertest
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      ui/      Button, Card, Badge, Table, Modal, Skeleton, EmptyState, ErrorState
│   │   │                    domain/  RiskBadge, RiskMeter, IncidentCard, DecisionTrace,
│   │   │                             GuardrailStatus, PolicyCard, ActionCard, NotificationPreview
│   │   │                    charts/  RiskDistribution, ResolutionTrend, TicketsAvoided
│   │   ├── pages/           13 route pages
│   │   ├── layouts/         AppShell.jsx, AuthLayout.jsx
│   │   ├── hooks/           useAuth, useApi, useDebounce
│   │   ├── services/        api.js (axios instance + interceptors) + one module per resource
│   │   ├── router/          index.jsx, ProtectedRoute.jsx
│   │   ├── utils/           format.js (INR, dates, tabular numerals), risk.js (level -> token)
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css        Tailwind v4 @theme tokens
│   ├── e2e/                 playwright critical-flow.spec.js
│   ├── .env.example
│   └── package.json
├── docs/                    IMPLEMENTATION_PLAN · ARCHITECTURE · API_SPEC · DATABASE · AI_AGENT · SECURITY · RUNBOOK
├── .gitignore
└── README.md
```

Two `package.json` files. No monorepo tooling, no workspaces. Ponytail: nothing added that a folder already does.

---

## 4. Frontend Architecture & Design System

Generated with **UI/UX Pro Max** (`--design-system --variance 5 --motion 4 --density 8`), then adjusted.
Resolved pattern: **Real-Time / Operations Landing**. Resolved style: **Dark Mode (OLED)**.

### 4.1 Two documented deviations from the raw dataset output

1. **Primary interactive colour moved off green.** The dataset returned `#16A34A` (green) as *primary* while
   also assigning green to "operational / healthy". If the button colour equals the success-status colour,
   status stops being readable (`state-clarity`, `color-not-only`). **Green / amber / red are reserved
   exclusively for risk and status.** Brand, interactive and focus become **sky `#0EA5E9`** — telemetry-coloured,
   and pointedly not purple (Master §9).
2. **Body font is not monospace.** The dataset paired JetBrains Mono with itself. At density 8 that hurts
   `readable-font-size` and `contrast-readability` for prose. Adopted the dataset's own *"Dashboard Data"*
   philosophy instead — sans for UI, mono for data: **Inter** for interface text, **JetBrains Mono** for
   figures, IDs, policy references and risk scores (`number-tabular`, prevents column jitter).

### 4.2 Tokens — dual theme (Tailwind v4 CSS-first `@theme`)

**Light and dark are both MUST HAVE** (user decision, 2026-08-28). Per the `dark-mode-pairing` rule the two
palettes are authored **together**, not generated by inverting one. Several hues had to change value between
themes to hold contrast — an inverted palette would have failed WCAG in one direction.

| Role | Token | Light | Dark |
|---|---|---|---|
| Background | `--color-bg` | `#F8FAFC` | `#0F172A` |
| Surface / card | `--color-surface` | `#FFFFFF` | `#111827` |
| Surface raised | `--color-surface-2` | `#F1F5F9` | `#1E293B` |
| Border | `--color-border` | `#CBD5E1` | `#334155` |
| Foreground | `--color-fg` | `#0F172A` | `#F8FAFC` |
| Muted foreground | `--color-fg-muted` | `#475569` | `#CBD5E1` |
| Brand / focus ring | `--color-brand` | `#0369A1` | `#0EA5E9` |
| Risk LOW / resolved (text) | `--color-low` | `#15803D` | `#16A34A` |
| Risk MEDIUM / pending (text) | `--color-medium` | `#B45309` | `#F59E0B` |
| Risk HIGH / incident (text) | `--color-high` | `#DC2626` | `#F87171` |
| Status fill (badge bg) | `--color-*-fill` | 600-weight, white text | 600-weight, white text |
| Escalated | `--color-escalated` | `#0369A1` | `#38BDF8` |

**Measured contrast** (why the values differ rather than invert):

| Pair | Ratio | Verdict |
|---|---|---|
| `#0369A1` brand on `#FFFFFF` (light) | 5.93:1 | AA normal text |
| `#0EA5E9` brand on `#0F172A` (dark) | 6.47:1 | AA normal text |
| `#15803D` low on `#FFFFFF` | 5.02:1 | AA |
| `#B45309` medium on `#FFFFFF` | 5.05:1 | AA |
| `#DC2626` high on `#FFFFFF` | 4.83:1 | AA |
| `#F87171` high on `#0F172A` | 6.48:1 | AA |
| white on `#DC2626` fill | 4.83:1 | AA |

Rejected: `#0EA5E9` as the light-mode brand (4.08:1 — fails normal text), `#16A34A` on white (3.30:1),
`#F59E0B` on white (~2.1:1), and `#DC2626` as dark-mode *text* (3.71:1). Each is replaced by a
darker or lighter step in the same hue so the product reads identically in both themes.

**Theme mechanics:** tokens on `:root`, overridden under `.dark`, with `@custom-variant dark (&:where(.dark, .dark *))`.
Default follows `prefers-color-scheme`; an explicit user choice persists in `localStorage`. A tiny inline script
in `index.html` sets the class before first paint so there is no flash of the wrong theme. Toggle lives in the
`AppShell` header and again in `/settings`.

Spacing scale (density 8): `4 · 8 · 12 · 16 · 24 · 32`. Radius `6px`. One elevation step — a flat console, no
floating cards (light: `1px border + 0 1px 2px rgba(15,23,42,.06)`; dark: `1px border + 0 1px 2px rgba(0,0,0,.4)`).

Every status is **colour + icon + text label**, never colour alone. Both themes are verified independently;
neither is inferred from the other. Recharts axes, gridlines, tooltips and series colours read from the same
CSS variables, so charts re-theme with the rest of the app rather than staying hardcoded dark.

### 4.3 Layout

`AppShell` = a fixed left sidebar at ≥1024px (`adaptive-navigation`), collapsing to a top bar plus a slide-over
drawer below that. Content `max-w-[1400px]`. Breakpoints 375 / 768 / 1024 / 1440. No horizontal page scroll;
wide tables get their own `overflow-x-auto` container.

### 4.4 Routes and their purpose

| Route | Purpose |
|---|---|
| `/login` | Agent sign-in. Seeded demo credentials shown on the page for judges. |
| `/dashboard` | 6 KPI tiles, live incident feed, risk distribution, recent AI actions, top-risk customers, resolution trend |
| `/customers` | Searchable / filterable / sortable customer list with a risk column |
| `/customers/:id` | **Customer 360** — all 15 Master §11 fields |
| `/incidents` | Incident list, create, filter by status / severity / type |
| `/incidents/:id` | Incident detail, affected orders, affected customers ranked by risk, per-customer "Analyze" |
| `/agent` | Decision workbench: pick customer + incident, see policy, Gemini recommendation, guardrail, execute |
| `/actions` | Approval queue — PROPOSED / APPROVED / EXECUTED / REJECTED / ESCALATED / FAILED |
| `/analytics` | Recharts trends, tickets avoided, escalation rate, resolution mix |
| `/simulator` | Three one-click scenario buttons plus a result summary |
| `/knowledge` | Policy CRUD, versioning, category filter, full-text search preview |
| `/settings` | Profile edit, password change, role display, Gemini/AI status |
| `*` | 404 |

### 4.5 Charts (Recharts, per `--domain chart`)

| Chart | Type | Why |
|---|---|---|
| Risk distribution | Horizontal bar | Comparison across only 3 buckets; bar beats pie (`no-pie-overuse`) |
| Resolution trend (7 / 30 d) | Line, solid + dashed series | `Trend Over Time`; line **style** distinguishes series, not hue alone |
| Tickets avoided | Area | Cumulative magnitude |

Each chart ships with a legend, tooltips, a keyboard-reachable `<table>` fallback plus an `aria-label` summary,
a skeleton loading state, an empty state, and an error state with retry.

### 4.6 Motion

Motion dial 4, so CSS transitions only: 150–250 ms, `transform` and `opacity` only. **No GSAP** — adding a
dependency for a fade is exactly what Ponytail forbids, and Master §9 permits only simple CSS/React motion.
`prefers-reduced-motion: reduce` disables all non-essential motion. The dataset's own warning applies:
never use `back.out` overshoot on data tables.

### 4.7 Playwright-stable selectors

`data-testid` on every element in Master §31 (`login-email` … `logout`), plus `affected-customers`,
`analyze-customer`, `ai-recommendation` and `approve-action`.

---

## 5. Backend Architecture

Layered, single process:

```
route -> rateLimit -> authenticate -> requireRole -> validate(Zod) -> controller -> service -> db / gemini
                                                                                        |
                                                                                   audit_logs
```

- **Controllers** never touch Supabase directly; **services** never touch `req` / `res`.
- One central error middleware. Errors leave as `{ error: { code, message, details? } }`.
  Stack traces and Postgres messages are logged server-side and never returned (Master §33).
- `express.json({ limit: '100kb' })`, `helmet()`, `cors({ origin: FRONTEND_URL, credentials: false })`.
- Env parsed through a Zod schema at boot; **the process refuses to start** on a missing secret.
- ESM (`"type": "module"`), plain `.js`, JSDoc where a shape is non-obvious. **No TypeScript anywhere.**

### Dependencies (deliberately short)

**Backend:** `express` · `cors` · `helmet` · `express-rate-limit` · `jsonwebtoken` · `bcrypt` · `zod` ·
`@supabase/supabase-js` · `@google/genai` · `dotenv`. Dev: `vitest`, `supertest`.

**Frontend:** `react` · `react-dom` · `react-router-dom` · `axios` · `recharts` · `lucide-react`.
Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite`, `vitest`,
`@testing-library/react`, `@playwright/test`.

Nothing else. No state library (React Context plus a `useApi` hook covers it), no form library, no UI kit,
no date library (`Intl.DateTimeFormat` is native), no GSAP, no Docker.

---

## 6. Database Design (Supabase PostgreSQL)

Ten tables. `snake_case`, UUID primary keys (`gen_random_uuid()`), `timestamptz` throughout,
`created_at` + `updated_at` on every mutable table (hackathon §03.2 requires timestamps).

| Table | Purpose | Key columns |
|---|---|---|
| `app_users` | **Support agents (auth)** | `email` UNIQUE, `password_hash`, `full_name`, `role` |
| `profiles` | **Customers** | `name`, `email` UNIQUE, `phone`, `segment`, `lifetime_value`, `preferred_channel` |
| `orders` | Orders | `customer_id` FK, `product_name`, `amount`, `status`, `expected_delivery`, `current_eta`, `carrier`, `priority` |
| `incidents` | Operational events | `type`, `severity`, `description`, `status`, `started_at`, `resolved_at`, `created_by` |
| `customer_incidents` | Join + risk snapshot | `customer_id`, `incident_id`, `order_id`, `risk_score`, `risk_level`, `risk_factors` JSONB, `status`; UNIQUE(`customer_id`, `incident_id`) |
| `conversations` | Support threads | `customer_id`, `channel`, `sentiment`, `summary`, `status` |
| `messages` | Thread messages | `conversation_id` FK ON DELETE CASCADE, `sender`, `content` |
| `actions` | AI / human decisions | `customer_id`, `incident_id`, `action_type`, `reason`, `amount`, `requires_approval`, `status`, `policy_reference`, `confidence`, `ai_generated`, `customer_message`, `created_by`, `approved_by` |
| `knowledge_documents` | Policy knowledge base | `title`, `category`, `version`, `content`, `metadata` JSONB, `search_vector` tsvector GENERATED, `is_active`, `created_by` |
| `audit_logs` | Append-only trail | `actor_type` (USER / AI / SYSTEM), `actor_id`, `action`, `entity_type`, `entity_id`, `metadata` JSONB |

**Constraints:** `CHECK` enums on `segment`, `role`, `severity`, `risk_level`, action `status`, `sentiment`
and `action_type` · `CHECK (risk_score BETWEEN 0 AND 100)` · `CHECK (amount >= 0)` · foreign keys everywhere ·
`ON DELETE CASCADE` for `messages`, `RESTRICT` for `orders` → `profiles`.

**Indexes:** `orders(customer_id)`, `orders(status)`, `customer_incidents(incident_id, risk_score DESC)`,
`actions(status, created_at DESC)`, `incidents(status, started_at DESC)`, `audit_logs(entity_type, entity_id)`,
GIN on `knowledge_documents.search_vector`.

**Status transitions** are enforced in the service layer, not only in the UI:
`PROPOSED → APPROVED | REJECTED | ESCALATED`, `APPROVED → EXECUTED | FAILED`;
`EXECUTED` and `REJECTED` are terminal. An illegal transition returns `409`.

**RLS:** enabled on all tables with deny-by-default policies as defence-in-depth against a leaked `anon` key.
See V6 — this is *not* the primary authorization control, and the docs will say so.

**Migrations:** plain SQL files run in the Supabase SQL Editor in numbered order. No ORM, no Prisma.

---

## 7. CX Risk Engine (deterministic — the canonical score)

A pure function in `services/risk.js`. **No AI involvement.** Gemini may *explain* the factors; it can never
change the number.

| Factor | Condition | Points |
|---|---|---|
| `premium_customer` | `segment = 'PREMIUM'` | +20 |
| `delay_over_48h` | `delay_hours > 48` | +30 |
| `delay_24_48h` | `24 < delay_hours <= 48` (mutually exclusive with the row above) | +15 |
| `high_value_order` | `order.amount >= 5000` | +15 |
| `previous_complaint` | at least one prior complaint conversation | +15 |
| `negative_sentiment` | latest conversation sentiment is `NEGATIVE` | +10 |
| `repeat_incident` | 2 or more incidents for this customer within 90 days | +10 |
| `ltv_weight` | `min(floor(lifetime_value / 50000), 10)` | +0…10 |

`score = clamp(sum, 0, 100)`, then `0–39 LOW · 40–69 MEDIUM · 70–100 HIGH`.

**Priya Sharma (seeded, reproducible):**
`20 (premium) + 30 (72 h delay) + 15 (₹8,999 order) + 15 (prior complaint) + 10 (negative sentiment) + 1 (LTV ₹50,000)` = **91 / HIGH**

Unit-tested against a fixture table covering both clamp boundaries and every level threshold.

---

## 8. AI Layer (Google Gemini)

**Model:** `gemini-2.5-flash` via `@google/genai`, overridable through `GEMINI_MODEL`.
**Backend-only.** The key never leaves Render. The frontend has exactly one variable: `VITE_API_URL`.

### 8.1 Structured output, enforced twice

`responseMimeType: 'application/json'` plus `responseSchema` on the request, then **re-validated with Zod**
on receipt — never trust the model to have honoured its own schema.

```jsonc
{
  "riskFactorSummary": ["premium customer", "72 hour delay", "previous delivery complaint"],
  "incidentSummary": "…",
  "recommendedAction": "PRIORITY_DELIVERY_AND_CREDIT",
  "creditAmount": 300,
  "customerMessage": "…",
  "requiresHumanApproval": false,
  "policyReference": "delivery-compensation-v2",
  "confidence": 0.94,
  "rationale": "one concise sentence of decision evidence"
}
```

`riskScore` and `riskLevel` are **deliberately not** model outputs. They come from §7 and are injected into
the response by the backend, which removes an entire class of hallucination.

`rationale` is one sentence of *decision evidence*. No hidden chain-of-thought is requested, stored or
displayed (Master §26).

### 8.2 Failure handling

| Failure | Behaviour |
|---|---|
| Network or 5xx | one retry with backoff, then fallback |
| Zod validation fails | one re-prompt carrying the validation error, then fallback |
| 429 rate limit | **no retry** — straight to fallback plus a visible "AI unavailable, deterministic path used" banner |
| Policy not found | **never invent a policy.** Action becomes `ESCALATED`; the UI shows "Policy unavailable" |
| Confidence below 0.7 | force `requires_approval = true` |

**Deterministic fallback** (`agent/fallback.js`): a rule table keyed on incident type, risk level and policy,
producing a valid recommendation with a templated customer message, `ai_generated = false` and
`confidence = null`. The demo therefore still works with a dead API key. This directly satisfies Master §34.

### 8.3 Cost discipline (free tier)

One Gemini call per `analyze`. The recommendation is cached on `customer_incidents`, so re-opening a customer
re-reads the database instead of calling again. Dashboard, analytics and risk scores make **zero** AI calls.
Only the relevant customer's context is sent, trimmed to the fields the prompt actually uses.

### 8.4 Prompt-injection defence

Customer messages, conversation summaries and policy text are **data, never instructions**. They are delivered
inside clearly fenced, labelled blocks with a standing instruction that their content is untrusted and cannot
alter the task. The model **cannot execute tools directly** — see §9. Guardrails run *after* the model and are
unreachable from prompt text. The worst outcome of a successful injection is a bad *suggestion* that a
guardrail rejects or a human reviews.

---

## 9. AI Tool Strategy

Gemini **requests**; the backend **decides**. There is no path from model output to a database write that
skips the guardrail layer, and no LLM-generated code is ever executed.

```
Gemini proposes { recommendedAction, creditAmount, policyReference, confidence }
   |
   v  Zod parse                       -- invalid -> retry once -> fallback
   v  Tool whitelist lookup           -- unknown tool -> reject + audit
   v  Authorize (JWT role, ownership) -- denied -> 403 + audit
   v  Business guardrails (section 10)-- breach -> PROPOSED + requires_approval, or ESCALATED
   v  Execute (simulated side effect) -- failure -> status FAILED, never reported as success
   v  audit_logs write                -- always, on success and on failure
```

Tools (Master §17), each a plain JS function with its own Zod input schema:

| Read-only (auto) | Mutating (guardrailed) |
|---|---|
| `getCustomer` · `getCustomerOrders` · `getCustomerHistory` · `getOrderStatus` · `searchPolicy` · `calculateCXRisk` | `offerPriorityDelivery` · `issueCredit` · `sendCustomerNotification` · `createEscalation` |

---

## 10. Business Guardrails (backend-enforced)

| Rule | Outcome |
|---|---|
| `credit <= ₹500` **and** policy matched **and** `confidence >= 0.7` | auto-execute |
| `credit > ₹500` | `requires_approval = true` |
| Cumulative credit to one customer above ₹1,000 in 24 h | `requires_approval = true` |
| Any `PAYMENT_*` or `ACCOUNT_*` action type | `requires_approval = true` |
| Policy unresolved | `ESCALATED` |
| `confidence < 0.7`, or the fallback path was used | `requires_approval = true` |
| Approver is the proposer | `403` (separation of duties) |
| Role `AGENT` attempts approve or reject | `403` |

Every branch is unit-tested. The frontend mirrors these rules for UX only and is documented explicitly as
**not a security control**.

---

## 11. Authentication, Authorization & Security

- **Passwords:** `bcrypt`, cost 10. Never logged, never returned, never included in an error message.
- **JWT:** HS256, 8 h expiry, payload `{ sub, email, role }`, sent as `Authorization: Bearer`.
  Verified on every protected route. Tokens are never logged.
- **Roles:** `AGENT` (read + propose) · `SUPERVISOR` (+ approve/reject, knowledge CRUD) · `ADMIN` (+ user management).
- **Rate limits:** `/api/auth/*` 10 requests per 15 min per IP · `/api/agent/*` 20 per 15 min per user ·
  global 300 per 15 min.
- **Login errors** are uniform ("Invalid email or password") so accounts cannot be enumerated.
- **Validation:** every body, param and query passes through Zod. Unknown keys are stripped.
- **Headers:** `helmet()`. **CORS:** the exact `FRONTEND_URL` origin only.
- **Secrets:** `.gitignore` covers `.env*` except `.env.example`; `.env.example` carries empty values only.
  A pre-submission grep for `GEMINI_API_KEY|SERVICE_ROLE|JWT_SECRET` across the built frontend bundle is part
  of the Definition of Done — hackathon §08.4 makes an exposed key an instant disqualification.
- **Audit:** every auth event, AI decision, guardrail verdict, approval and execution is written to `audit_logs`.

**Residual risk, stated rather than hidden:** the JWT lives in `localStorage`, which is reachable by XSS.
That was chosen for a cross-origin Vercel ↔ Render SPA under a one-day build. Mitigations: short expiry,
no `dangerouslySetInnerHTML`, React's default escaping, strict CSP headers via helmet. The upgrade path is an
httpOnly `SameSite=None; Secure` cookie. Recorded in `SECURITY.md`.

Per Master §42 the final report will state **"no known critical/high security issues were identified by the
selected checks and review"** — never "zero vulnerabilities".

---

## 12. API Design

All responses are `{ data, meta? }` or `{ error: { code, message } }`. All list endpoints accept
`?search=&status=&sort=&order=&page=&limit=`.

```
POST   /api/auth/register            (ADMIN-gated after the first user)
POST   /api/auth/login
GET    /api/auth/me
PATCH  /api/auth/me                  profile update          [CRUD-U]
POST   /api/auth/change-password

GET    /api/customers                search / filter / sort / paginate
GET    /api/customers/:id            Customer 360 aggregate

GET    /api/orders                   ?customerId=&status=&incidentId=
GET    /api/orders/:id
PATCH  /api/orders/:id               operational fields only  [CRUD-U]

GET    /api/incidents
GET    /api/incidents/:id            + affected orders + affected customers ranked by risk
POST   /api/incidents                                         [CRUD-C]
PATCH  /api/incidents/:id                                     [CRUD-U]
DELETE /api/incidents/:id            soft archive             [CRUD-D]

POST   /api/agent/analyze            risk + policy + Gemini recommendation (no side effects)
POST   /api/agent/resolve            validate, guardrail, then execute or queue
POST   /api/agent/chat               grounded Q&A over one customer / incident

GET    /api/actions                  ?status=&customerId=&mine=
GET    /api/actions/:id
POST   /api/actions/:id/approve      SUPERVISOR+
POST   /api/actions/:id/reject       SUPERVISOR+

GET    /api/knowledge                full-text search + category filter
POST   /api/knowledge                SUPERVISOR+              [CRUD-C]
PATCH  /api/knowledge/:id            version bump             [CRUD-U]
DELETE /api/knowledge/:id            soft delete              [CRUD-D]

GET    /api/analytics/overview       the 6 KPI tiles
GET    /api/analytics/incidents      trends, tickets avoided, escalation rate

POST   /api/simulator/delivery-delay
POST   /api/simulator/payment-failure
POST   /api/simulator/inventory-shortage

GET    /api/health                   uptime-pinger target
```

Status codes: `200` · `201` · `400` validation · `401` unauthenticated · `403` unauthorized · `404` ·
`409` illegal state transition · `429` rate limited · `500` safe generic.

---

## 13. Scope Tiers

### MUST HAVE — the MVP; nothing ships without these
Schema, migrations and seed · auth (register / login / me / JWT / bcrypt / roles) · Zod on every input ·
customers, orders and incidents read APIs · incident CRUD · the deterministic risk engine ·
full-text policy retrieval · Gemini analyze with Zod-validated JSON plus fallback · guardrails ·
the actions lifecycle and approval queue · three simulator scenarios · analytics overview ·
all 13 routes with loading / empty / error states · dashboard · Customer 360 · agent workbench ·
audit logging · **light + dark theme with a persisted toggle** · README and `.env.example` ·
**a live deployment on Vercel + Render**.

### SHOULD HAVE — quality and score
Knowledge CRUD UI · `/api/agent/chat` · search, filter and sort on every list · the Recharts analytics page ·
settings and password change · the Playwright critical flow · backend unit and API tests ·
notification preview panel · decision-trace timeline component · the full seven-file docs set.

### OPTIONAL — only once everything above is green
pgvector semantic search · CSV export · toast and undo on approvals ·
polling refresh on the dashboard · React Testing Library component tests.

---

## 14. Implementation Phases (dependency order)

| # | Phase | Depends on | Exit criterion |
|---|---|---|---|
| 0 | `git init`, `.gitignore`, README skeleton, both `package.json` | — | `npm i` clean in both apps |
| 1 | Supabase project, `001_schema.sql`, `002_rls.sql` | 0 | All 10 tables exist with constraints and indexes |
| 2 | Deterministic seed: 50 customers, 150 orders, 20 incidents, 30 conversations, 30 actions, 8 policies | 1 | Re-running the seed is idempotent; **Priya scores 91** |
| 3 | Express skeleton: config, Zod env, helmet, cors, rate limit, error middleware, `/api/health` | 0 | Server boots; health returns 200 |
| 4 | Auth: register, login, me, JWT middleware, `requireRole` | 3 | Supertest suite green |
| 5 | Read APIs: customers, orders, incidents, with search / filter / sort / paginate | 4 | Manual and Supertest checks pass |
| 6 | Risk engine plus unit tests | 2 | Priya fixture returns 91; boundary fixtures pass |
| 7 | Policy retrieval via `tsvector` full-text search | 2 | `searchPolicy('delivery delay premium')` returns `delivery-compensation-v2` |
| 8 | Gemini client, prompt, Zod schema, fallback | 3 | Valid JSON with a real key **and** with a deliberately broken key |
| 9 | Tools, guardrails, actions lifecycle, audit | 6, 7, 8 | Every guardrail branch unit-tested |
| 10 | Simulator, all three scenarios | 9 | Delivery delay produces exactly 17 affected orders and 5 HIGH-risk customers |
| 11 | Analytics endpoints | 9 | The 6 KPIs match hand-computed seed values |
| 12 | Frontend scaffold: Vite, Tailwind v4 tokens, AppShell, router, axios interceptors, auth context | 4 | Login into a protected dashboard works |
| 13 | UI primitives and domain components, with skeleton / empty / error states | 12 | Every state renders in isolation |
| 14 | Pages: dashboard, customers, 360, incidents, agent, actions, simulator, analytics, knowledge, settings | 13 and 5–11 | Full navigation, no dead route |
| 15 | Recharts plus accessible table fallbacks | 14 | Legends, tooltips, reduced motion, keyboard reachable |
| 16 | Playwright critical flow (Master §32) | 14 | Login through logout is green |
| 17 | Harden (Master §5) and write the seven docs | 16 | Audit checklist complete |
| 18 | Deploy Vercel + Render + Supabase, verify no secrets in the bundle | 17 | The public URL runs the full E2E flow |

**Critical path:** 1 → 2 → 6 → 7 → 8 → 9 → 10 → 14 → 18. Everything else can slip to SHOULD.

---

## 15. Testing Strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | Risk engine (including Priya = 91 and both clamps), guardrails (every branch), Zod schemas, AI-response validation, fallback, status-transition legality |
| API | Vitest + Supertest | Auth happy and failure paths, 401/403 on protected routes, ownership scoping, validation rejections, rate-limit 429, illegal-transition 409 |
| Component | React Testing Library *(SHOULD)* | RiskBadge, GuardrailStatus, ActionCard, empty and error states |
| E2E | Playwright | The Master §32 critical journey, driven entirely by `data-testid` |
| Build | `vite build` + `node --check` | Production bundle compiles; **grep proves no secret in `dist/`** |

Gemini is **stubbed** in tests. No test consumes free-tier quota.

---

## 16. Deployment

| Piece | Target | Notes |
|---|---|---|
| Frontend | **Vercel** | `VITE_API_URL` set to the Render URL. SPA rewrite so deep links resolve. |
| Backend | **Render** | Web service, `npm start`. All six secrets set in the dashboard. `FRONTEND_URL` set to the Vercel URL for CORS. |
| Database | **Supabase** | Migrations via the SQL Editor, then `npm run seed` once. |

Pre-deploy: build the frontend · run all tests · validate the env schema · confirm Supabase is reachable ·
verify Gemini with a live call · confirm the CORS origin.

Post-deploy: login → simulate delivery delay → open Priya → policy → recommendation → guardrail → execute →
notification → analytics → logout → **grep the deployed bundle for secrets**.

Seeded demo credentials go in the README and on the submission form, since the hackathon requires test logins.

---

## 17. Definition of Done

**Frontend** — all 13 routes reachable · navigation correct at 375 / 768 / 1024 / 1440 · forms validate with
inline errors and an error summary · loading, empty and error states on every async surface · charts have
legends, tooltips and table fallbacks · focus is visible everywhere · `prefers-reduced-motion` honoured ·
no emoji used as an icon.

**Backend** — the server boots on a clean env · JWT and bcrypt work · Zod covers every input · every protected
route rejects anonymous access · roles enforced · errors uniform and leak-free · audit rows written for every
state change.

**Database** — migrations apply to a fresh project · the seed is idempotent and deterministic · foreign keys
and CHECK constraints enforced · indexes present · RLS enabled with documented scope.

**AI** — Gemini returns schema-valid JSON · invalid output is retried and then falls back · the policy
reference is retained on every recommendation · tool authorization is enforced server-side · all guardrail
branches are covered · escalation works · **the demo still completes with the API key removed**.

**Security** — no secret in the frontend bundle, grep-verified · `npm audit` reviewed · no critical or high
finding left unresolved from the selected checks · residual risks written down.

**Testing** — `vite build` passes · unit and API suites green · the Playwright critical flow is green.

**Docs** — README covering all 17 Master §37 items · `.env.example` · the seven `docs/` files ·
a demo walkthrough · an honest limitations section.

---

## 18. Fallback Behaviour Summary

| Failure | Response |
|---|---|
| Gemini down, 429, or an invalid key | Deterministic rule-based recommendation, `ai_generated = false`, visible banner. **The demo never breaks.** |
| Gemini returns invalid JSON | One re-prompt, then fallback |
| Policy not found | Escalate. Never fabricate a policy. |
| Tool execution fails | Status `FAILED`, error surfaced, audit written. Never shown as success. |
| Supabase unreachable | `503` with a safe message; UI error state with retry |
| Backend cold-starting | Extended axios timeout plus a "waking backend" state |
| Empty dataset | Purposeful empty states with a "Run simulator" call to action |

---

## 19. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Gemini free-tier 429 during the live demo | **High** | **High** | Deterministic fallback (§8.2) · cached recommendations · one call per analyze · zero AI on dashboards |
| R2 | A Render cold start makes the judged app look dead | High | Medium | Health endpoint plus uptime pinger · "waking backend" UI state · longer first-request timeout |
| R3 | Scope exceeds the 6.5 h build window | **High** | **High** | Hard MUST / SHOULD / OPTIONAL tiers (§13) · identified critical path (§14) · thin-but-real pages, never stubs |
| R4 | A secret leaks to the public repo, causing **instant disqualification** | Low | **Critical** | `.gitignore` in the first commit · empty `.env.example` · grep the built bundle before submission · never paste keys into chat |
| R5 | The free Supabase project pauses after inactivity | Medium | High | Keep it queried by the uptime pinger · documented in RUNBOOK |
| R6 | The `bcrypt` native build fails on Render | Low | Medium | Documented one-line swap to `bcryptjs`, same API |
| R7 | Recharts / React 19 peer-dependency friction | Medium | Low | Pin Recharts 3.x, which supports React 19 · fallback is pinning React 18 |
| R8 | Tailwind v4 CSS-first config differs from v3 habits | Medium | Low | `@tailwindcss/vite` plus `@theme` tokens decided up front (§4.2) |
| R9 | Seed data drifts and Priya no longer scores 91 | Medium | Medium | Hard-coded deterministic seed plus a unit test asserting exactly 91 |
| R10 | Prompt injection via seeded customer or policy text | Low | Medium | Fenced untrusted-data blocks · the model cannot execute tools · guardrails run after the model (§8.4) |
| R11 | RLS mistaken for the real access control | Medium | Medium | The service-role bypass is documented in `SECURITY.md`; Express is the enforcement point |

---

## 20. Decisions — RESOLVED (2026-08-28)

| # | Decision | Outcome |
|---|---|---|
| 1 | Supabase project | **Fresh project, created by the user.** Plan assumes an empty project at Phase 1. Setup checklist in §21. |
| 2 | Gemini API key | **User supplies on request.** Not blocking — Phases 0–7 need no key, and Phase 8 is built against the fallback path first. |
| 3 | GitHub repo | **User creates and supplies the URL on request.** Requirements in §21. |
| 4 | Light mode | **Promoted to MUST HAVE.** Both themes ship. Dual palette authored in §4.2. |

### Secret-handling protocol

**No secret is ever pasted into this chat, and none is ever committed.** The user writes every value directly
into `backend/.env` (created by copying `backend/.env.example`), which `.gitignore` excludes from the first
commit onward. Claude never sees, requests, echoes or stores `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
`JWT_SECRET` or the database password. This is both the safer practice and a direct requirement of hackathon
rule §08.4, where an exposed key is an immediate disqualification.

The only values Claude needs in conversation are non-secret: the GitHub repository URL, the Supabase project
region, and later the deployed Vercel and Render URLs.

---

## 21. User Setup Checklists

### 21.1 Supabase (fresh project)

1. Create a new project at `supabase.com` on the free tier.
2. Region: **ap-south-1 (Mumbai)** — lowest latency for an India-based demo and jury.
3. Set a strong database password and save it in a password manager. It is not needed in `.env`.
4. From **Project Settings → API**, collect two values:
   - `Project URL` → becomes `SUPABASE_URL`
   - `service_role` secret → becomes `SUPABASE_SERVICE_ROLE_KEY`
5. Paste both into `backend/.env` directly. Do not send them here.
6. The `anon` key is not required — the browser never contacts Supabase.
7. No extensions to enable. `gen_random_uuid()` is built into the PostgreSQL version Supabase ships,
   and full-text search (`tsvector` + GIN) is core PostgreSQL. pgvector stays OPTIONAL per §V5.
8. Claude generates `001_schema.sql` and `002_rls.sql`; the user pastes each into the **SQL Editor** and runs
   them in numbered order, then Claude runs `npm run seed` once.

**Report back:** only that the project exists and its region. Nothing else.

### 21.2 GitHub repository

1. Create a **public** repository. It must stay public through the whole evaluation period (§08.3).
2. Create it **empty** — no README, no `.gitignore`, no licence. Claude writes the first commit, and a
   pre-populated repo would force an unnecessary merge on the clock.
3. Suggested name: `resolveai`. Note that the local folder is `SupportIQ` while the product is **ResolveAI** —
   the folder name does not have to match, but the repo, README and deployed app should all say ResolveAI.
   Say the word if you would rather rename the product to SupportIQ instead.
4. Commit identity will be `koushikkushal3@gmail.com` unless told otherwise.
5. Commits are made **per phase**, not as one bulk push — the hackathon grades commit history.
6. `.gitignore` covering `.env*`, `node_modules`, `dist` and `.vercel` lands in **commit 1**, before any
   env file can exist.

**Report back:** the HTTPS clone URL. Not a secret.

### 21.3 Gemini API key

1. Create a key at `aistudio.google.com/apikey` on the free tier.
2. Paste it into `backend/.env` as `GEMINI_API_KEY`. Do not send it here.
3. Claude will ask for confirmation only at **Phase 8**, and will have built and tested the deterministic
   fallback path before that point so the demo is never blocked on quota.

---

## 22. What Claude Will Ask For, and When

| Phase | Request | Blocking? |
|---|---|---|
| 0 | GitHub repository URL | Yes — needed for the first push |
| 1 | Confirmation the Supabase project exists; then the user runs two SQL files | Yes |
| 2 | Confirmation `backend/.env` holds `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Yes |
| 8 | Confirmation `GEMINI_API_KEY` is set in `backend/.env` | No — fallback path builds and tests without it |
| 18 | Vercel and Render URLs after deployment | Yes |

Everything between these points runs autonomously.

---

*Plan complete. No application code has been written. Awaiting explicit approval before Phase 4 (BUILD).*
