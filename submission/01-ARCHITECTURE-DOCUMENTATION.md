# Deliverable 1 — Architecture Documentation

**ResolveAI** · Theme: AI for Customer Experience · Build_to_Ship Hackathon

---

## 1. Problem statement

Customer support is reactive. A customer must notice a problem, contact support,
explain it, and wait — before anyone begins solving it.

The deeper failure sits one step earlier. **A business usually knows an
operational event has happened before it knows which customers that event is
about to hurt.** A carrier hub goes down at 09:00; the first support ticket
arrives at 14:00. In those five hours nothing was wrong with the information —
only with who was looking at it.

The cost: avoidable tickets, frustrated customers, inconsistent service, longer
resolution times, no personalization, and a support queue that grows for reasons
nobody chose.

**ResolveAI inverts the sequence:**

```
Detect → Understand → Score → Retrieve policy → Decide → Validate → Act → Notify → Measure
```

An operational incident is detected. The system resolves which orders and which
customers it touches, scores each customer's experience risk deterministically,
retrieves the governing business policy, asks a model for a structured
resolution, validates and constrains that proposal in the backend, executes what
is permitted, queues the rest for a human, and contacts the customer — before
they ever notice.

## 2. User roles

Three roles, hierarchical. Enforced by `requireRole()` middleware on the server;
the UI hides controls only to avoid a pointless 403.

| Role | Can | Cannot |
|---|---|---|
| **AGENT** | Read all customers, incidents, orders, policies. Create incidents. Run the simulator. Run AI analysis. Propose actions. | Approve or reject actions. Edit policies. Modify incidents they did not create. |
| **SUPERVISOR** | Everything an AGENT can, plus approve/reject actions and create/edit policy documents. | Approve an action they proposed themselves. Manage user accounts. |
| **ADMIN** | Everything, plus creating user accounts. | — |

**Data scoping.** Agents legitimately read all customer records — it is a shared
support console. Isolation is applied where it makes sense:

- **Ownership** — incidents, actions and knowledge documents carry `created_by`.
  An AGENT may only modify rows they created. `?mine=true` filters any list.
- **Separation of duties** — nobody approves an action they proposed. Enforced
  in the service layer **and** by a database `CHECK` constraint, so it holds
  even if the service layer is bypassed entirely.

## 3. System architecture

```
┌─────────────────────┐
│  Browser (Vercel)   │  React 19 · Vite · Tailwind v4 · React Router
│  knows ONE variable:│
│  VITE_API_URL       │
└──────────┬──────────┘
           │  HTTPS · JWT in the Authorization header
           ▼
┌─────────────────────┐
│ Express API (Render)│  ◄── the ONLY process holding secrets
│  Node · JWT · bcrypt│
│  Zod · @google/genai│
└─────┬──────────┬────┘
      │          │
      ▼          ▼
┌───────────┐  ┌──────────────────────────────┐
│ Supabase  │  │ LLM chain                    │
│ PostgreSQL│  │ Gemini → Groq → OpenRouter   │
│ + FTS     │  │ → deterministic fallback     │
└───────────┘  └──────────────────────────────┘
```

**Trust boundary.** The browser never contacts Supabase or a model provider.
There is exactly one privileged process. The single frontend variable,
`VITE_API_URL`, is not a secret.

**Request path**

```
route → rateLimit → authenticate → requireRole → validate(Zod)
      → controller → service → database / LLM
                        │
                   audit_logs
```

Controllers never touch the database directly; services never touch `req`/`res`.
That separation is what makes the risk engine and the guardrails unit-testable
without a server.

**State management.** React Context for the session plus a `useApi` hook. No
state library: there is one piece of global state and it changes twice per
session. **No caching layer, deliberately** — every screen reads live
operational state that a simulator run or an approval changes seconds later, and
stale data is precisely the failure this product exists to prevent.

## 4. Database schema

Supabase PostgreSQL. Ten tables, UUID keys, `timestamptz` throughout,
`created_at` + `updated_at` on every mutable table.

```
app_users ──creates──► incidents ──┐
(agents)                           │
                                   ▼
profiles ──────────────► customer_incidents ◄──── orders
(customers)  │           risk_score, risk_level,      │
             │           risk_factors,                │
             │           ai_recommendation            │
             ├──► conversations ──► messages          │
             └──► actions ◄────────────────────────────┘
                    │
knowledge_documents │        audit_logs
(policies + tsvector)        (append-only)
```

| Table | Purpose |
|---|---|
| `app_users` | Support agents — authentication subjects |
| `profiles` | Customers |
| `orders` | Orders, with `expected_delivery` / `current_eta` for delay computation |
| `incidents` | Operational events |
| `customer_incidents` | Which customers an incident hurt + risk snapshot + cached AI recommendation |
| `conversations` / `messages` | Support threads; `is_outbound` separates our outreach from customer sentiment |
| `actions` | Every AI or human decision, with the guardrail verdict stored alongside |
| `knowledge_documents` | Policy base, with a GENERATED `tsvector` for retrieval |
| `audit_logs` | Append-only trail |

> **Naming note.** `app_users` are the agents who log in; `profiles` are the
> customers. The original spec used `profiles` for customers while Supabase
> convention uses it for auth users — merging them would break both auth and the
> CX model, so they are deliberately separate.

**Invariants enforced by the database, not application code**, because a money
path should not have application logic as its only guard:

| Constraint | Prevents |
|---|---|
| `chk_action_separation_of_duties` | Anyone approving their own action |
| `chk_action_executed_at` | An execution timestamp on a non-executed action |
| `risk_score BETWEEN 0 AND 100` | An out-of-range score |
| `amount >= 0` | A negative credit |

Foreign keys are chosen deliberately: `orders → profiles` is `RESTRICT` (losing
order history would corrupt every risk score); `messages → conversations` is
`CASCADE`; `actions → incidents` is `SET NULL` so executed history survives an
incident being replaced.

Full detail: [`docs/DATABASE.md`](../docs/DATABASE.md)

## 5. AI integration

> **The model proposes. The backend decides.**

**The single most important decision:** `riskScore` and `riskLevel` are **not
model outputs**. They are computed by a deterministic engine *before* the call
and passed in as authoritative fact, so the model reasons about a number it
cannot change. This removes an entire class of hallucination from the product's
most consequential output rather than trying to detect it afterwards.

```
context assembled
      ↓
risk computed          deterministic, no AI
      ↓
policy retrieved       PostgreSQL full-text search, no AI
      ↓
model called           structured JSON, Gemini → Groq → OpenRouter
      ↓
Zod re-validation      the model is not trusted to honour its own schema
      ↓
tool whitelist         a closed registry; no eval, no dynamic dispatch
      ↓
role authorization
      ↓
business guardrails    pure function, every branch unit-tested
      ↓
execute or queue → audit
```

| Concern | Owner | Why |
|---|---|---|
| Risk score | Deterministic engine | Too consequential to hallucinate |
| Policy retrieval | PostgreSQL FTS | Deterministic, auditable, zero model quota |
| Resolution proposal | LLM | Genuinely needs judgement over unstructured context |
| Authorization | Express middleware | The model has no access to it |
| Monetary limits | Pure-function guardrails | Testable, and unreachable from prompt text |

**Resilience.** Key rotation within a provider (only on quota errors — the one
failure that is a property of the key), then provider failover, then a
deterministic rule table. Bounded by an 8s per-attempt timeout and a 20s chain
deadline. **The demo completes with every API key removed.**

Full detail: [`02-AI-INTEGRATION-BREAKDOWN.md`](02-AI-INTEGRATION-BREAKDOWN.md)
and [`docs/AI_AGENT.md`](../docs/AI_AGENT.md)
