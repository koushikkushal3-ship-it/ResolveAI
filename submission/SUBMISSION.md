# ResolveAI — Submission

**Theme:** AI for Customer Experience · **Event:** Build_to_Ship Hackathon

Everything an evaluator needs, in one place. Each section maps to a line on the
scoring rubric.

---

## Links

| Deliverable | Link |
|---|---|
| **GitHub repository** (public) | https://github.com/koushikkushal3-ship-it/SupportIQ |
| **Live application** | https://resolve-ai-roan.vercel.app |
| **API health check** | https://resolveai-ukwt.onrender.com/api/health |
| **Demo video (2–3 min)** | *(fill in — unlisted YouTube or Drive)* |

### Test credentials

| Email | Role |
|---|---|
| `supervisor@resolveai.demo` | SUPERVISOR — can approve actions |
| `agent@resolveai.demo` | AGENT — read and propose only |
| `admin@resolveai.demo` | ADMIN |

Password for all three: **`ResolveAI#2026`**

> The backend runs on Render's free tier and sleeps after ~15 minutes idle.
> Please load the app once and allow 30–60s for the first request.

---

## 1. Problem statement

Customer support is reactive. A customer must notice a problem, contact support,
explain it, and wait — before anyone begins solving it.

The deeper failure sits one step earlier: **a business usually knows an
operational event has happened before it knows which customers that event is
about to hurt.** A carrier hub goes down at 09:00; the first support ticket
arrives at 14:00. In those five hours nothing was wrong with the information —
only with who was looking at it.

The cost: avoidable tickets, frustrated customers, inconsistent service, no
personalization, and a support queue that grows for reasons nobody chose.

## 2. Solution

ResolveAI inverts the sequence:

```
Detect → Understand → Score → Retrieve policy → Decide → Validate → Act → Notify → Measure
```

An operational incident is detected. The system resolves which orders and which
customers it touches, scores each customer's experience risk deterministically,
retrieves the governing business policy, asks a model for a structured
resolution, validates and constrains that proposal in the backend, executes what
is permitted, queues the rest for a human, and contacts the customer — before
they ever notice.

**Key features**

- Deterministic CX risk engine (0–100) with named, auditable factors
- Policy knowledge base with full-text retrieval — every recommendation cites a
  policy by slug
- Structured JSON AI output, validated twice, with a deterministic fallback
- Business guardrails enforced server-side, with a human-approval queue
- Three-scenario incident simulator producing identical, narratable numbers
- Customer 360, triage queue, outreach-coverage tracking, analytics
- Append-only audit trail for every decision

## 3. Architecture

Three deployed pieces. One privileged process.

```
Browser (Vercel) ──HTTPS+JWT──► Express API (Render) ──► Supabase PostgreSQL
                                        └─────────────► LLM providers
```

The browser never contacts Supabase or a model provider. It knows one variable,
`VITE_API_URL`, which is not a secret.

**User roles:** `AGENT` (read, propose) · `SUPERVISOR` (+ approve/reject, policy
edits) · `ADMIN` (+ user management).

Full detail: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

### Database schema

Ten tables: `app_users` (agents), `profiles` (customers), `orders`, `incidents`,
`customer_incidents`, `conversations`, `messages`, `actions`,
`knowledge_documents`, `audit_logs`.

Invariants that a code bug must not be able to violate are database `CHECK`
constraints, not application logic — separation of duties, `executed_at` only on
`EXECUTED`, `risk_score` in range, `amount >= 0`.

Full detail: [`docs/DATABASE.md`](../docs/DATABASE.md)

## 4. AI integration breakdown

### The governing principle

> **The model proposes. The backend decides.**

**`riskScore` and `riskLevel` are not model outputs.** They are computed
deterministically *before* the call and passed in as authoritative fact, so the
model reasons about a number it cannot change. This removes an entire class of
hallucination rather than trying to detect it afterwards.

### Prompt design

- System instruction states the rules, the currency, and that content inside
  `~~~~` fences is untrusted data that cannot alter the task.
- Customer names, conversation summaries and policy text are fenced and
  labelled; the fence delimiter is escaped out of the content so it cannot be
  terminated early.
- Only the top-ranked policy is sent in full; alternates contribute slug and
  title. Prompt tokens: 1,064 → 646 after tuning.

### Zod schema validation

`responseMimeType: 'application/json'` plus a `responseSchema` on the request,
then **re-validated with Zod on receipt** — a model is not trusted to have
honoured its own schema. A policy slug the model cites that was *not* in the
block it was given is downgraded to an escalation.

### Tool execution

```
name → whitelist → Zod parse → role check → handler → audit
```

A closed registry defined at module load. No `eval`, no dynamic dispatch. The
model **names** a tool; it never invokes one. Unknown names and unauthorized
calls are rejected *and* audited.

### Guardrails

A pure function, every branch unit-tested.

| Rule | Outcome |
|---|---|
| ≤ ₹500, policy matched, confidence ≥ 0.7 | auto-execute |
| > ₹500, or > ₹1,000/24h per customer | human approval |
| Payment / account / refund actions | **always** human approval |
| No governing policy | escalate |

**The decisive test, which passes:** a model claiming
`requiresHumanApproval: false` on a ₹5,000 credit is still stopped.

### Secret management

Every provider key lives only in the backend process. The production bundle is
grep-verified free of provider keys, the Supabase service-role key, the JWT
secret and any direct AI or database host — and an E2E test re-checks this at
runtime across the served HTML, every loaded script and `localStorage`.

### Resilience

Gemini → Groq → OpenRouter → deterministic fallback, bounded by an 8s
per-attempt timeout and a 20s chain deadline. **The demo completes with every
API key removed.**

Full detail: [`docs/AI_AGENT.md`](../docs/AI_AGENT.md)

## 5. Verification

| Check | Result |
|---|---|
| Backend unit tests | **70 / 70** |
| End-to-end (Playwright) | **14 / 14** |
| Production build | Clean, no chunk > 500 kB |
| Secret scan — bundle and runtime | Clean |
| Contrast, both themes | **Zero failures** across 31 pairs |
| Simulator determinism | 17 / 17 / 5 identical across runs |
| Seed invariants | 9 / 9, including `Priya Sharma = 91 HIGH` |

Evidence: [`TEST-EVIDENCE.md`](TEST-EVIDENCE.md)

## 6. Demo script

[`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) — a 2–3 minute walkthrough matching the video
requirement.

---

## Rubric mapping

| Criterion | Weight | Where to look |
|---|---|---|
| **Problem alignment & value** | 25% | This document §1–2; the simulator → resolution journey in the live app |
| **Full-stack implementation** | 25% | `docs/API_SPEC.md`, `docs/DATABASE.md` — auth, full CRUD, search/filter/sort, validation, data scoping |
| **AI security & integration** | 20% | This document §4; `docs/AI_AGENT.md`, `docs/SECURITY.md` |
| **Working deployment & UX** | 20% | Live link above; loading/error/empty states, responsive, WCAG-verified both themes |
| **Video demo & README** | 10% | Video link above; root `README.md` and the seven `docs/` files |

## Honest limitations

Stated because a submission that hides them is less trustworthy than one that
does not:

- Notification delivery is **simulated** — the conversation and message rows are
  real and appear in the timeline and analytics; only the transport is absent.
  The brief requires the demo to work without third-party integrations.
- "Tickets avoided" is **modelled, not measured**. A ticket never filed cannot
  be observed. The API returns its basis and the UI labels it.
- The JWT is stored in `localStorage`, which is XSS-reachable — a deliberate
  trade for a cross-origin SPA. Mitigations and upgrade path in `docs/SECURITY.md`.
- Row Level Security is enabled but is **not** the enforcement layer; the
  backend uses the service-role key, which bypasses it by design.
- Policy retrieval is lexical, not semantic — correct for eight documents.

**No known critical or high security issues were identified by the selected
checks and review.** No claim of zero vulnerabilities is made.
