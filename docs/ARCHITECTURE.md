# Architecture

## The problem this shape solves

Customer support is reactive. A business usually knows an operational event has
happened — a carrier hub is backed up, a payment gateway is timing out — **before
it knows which customers that event is about to hurt.** ResolveAI closes that gap.

Every architectural decision below serves one loop:

```
Detect → Understand → Score → Retrieve policy → Decide → Validate → Act → Notify → Measure
```

## Runtime topology

```
Browser (Vercel)
  │  HTTPS, JWT in the Authorization header
  ▼
Express API (Render)  ◄── the ONLY process holding secrets
  ├──────────────► Supabase PostgreSQL   data + full-text policy retrieval
  └──────────────► LLM provider chain    Gemini → Groq → OpenRouter
```

**Trust boundary:** the browser never contacts Supabase or any model provider.
There is exactly one privileged process. The frontend knows a single variable,
`VITE_API_URL`, and it is not a secret.

## Request path

```
route → rateLimit → authenticate → requireRole → validate(Zod) → controller → service → db / llm
                                                                                  │
                                                                             audit_logs
```

- **Controllers** never touch Supabase directly. **Services** never touch `req`/`res`.
  That separation is what makes the risk engine and the guardrails unit-testable
  without a server.
- One terminal error handler. Errors leave as `{ error: { code, message } }`.
  Stack traces and Postgres messages are logged server-side and never returned.
- Environment is parsed through a Zod schema at boot; **the process refuses to
  start** on a missing secret rather than failing later on a live request.

## Where the intelligence lives, and where it does not

This is the decision that shapes the whole system.

| Concern | Owner | Why |
|---|---|---|
| CX risk score | `services/risk.js`, deterministic | The most consequential number in the product. A model cannot be allowed to hallucinate it. |
| Policy retrieval | PostgreSQL full-text search | Deterministic, auditable, costs no model quota. |
| Resolution proposal | LLM | Genuinely needs judgement over unstructured context. |
| Authorization | Express middleware | The model has no access to it. |
| Monetary limits | `services/guardrails.js` | Pure function, every branch unit-tested. |
| Execution | `services/actions.js` | Only reachable after the guardrails pass. |

**The model proposes. The backend decides.** No model output reaches the database
without passing Zod validation, a tool whitelist, a role check and the guardrail
layer. No model-generated code is ever executed.

The risk score is computed *before* the model is called and passed in as an
authoritative fact, so the model reasons about a number it cannot change. That
removes an entire class of hallucination rather than trying to detect it.

## Frontend

React 19 + Vite + React Router + Tailwind v4. No state library: there is one
piece of global state (the session) and it changes twice per session, so React
context plus a `useApi` hook covers it.

**No caching layer, deliberately.** Every screen reads live operational state
that a simulator run or an approval changes seconds later. Stale-while-revalidate
would show numbers that are quietly wrong — which is precisely the failure this
product exists to prevent.

Bundle is split vendor / app / charts; the chart library is ~60% of the weight
and is only needed on two routes.

## Resilience

Three layers, in order:

1. **Key rotation** across every configured key for a provider — but only on a
   quota error, since that is the only failure that is a property of the key
   rather than the provider.
2. **Provider failover** — Gemini → Groq → OpenRouter. All three speak either
   the Gemini or the OpenAI chat-completions shape, so two adapters cover them.
3. **Deterministic fallback** — a rule table keyed on incident type, risk level
   and policy. Marked `ai_generated: false`, carries `confidence: 0`, and
   therefore lands below the confidence floor by construction, so a degraded AI
   path can never auto-spend money.

The whole chain is bounded by an 8s per-attempt timeout and a 20s deadline.
This is not theoretical: with the Gemini host intermittently unreachable, an
unbounded chain took **242 seconds** to reach a provider that answers in under
one. A slow fallback is as useless as no fallback when someone is watching.

**The demo completes with every API key removed.**

## What was deliberately not built

| Not built | Why |
|---|---|
| pgvector / embeddings | Eight short governance documents resolve reliably by lexical search. Embeddings would add a migration, a backfill, a per-query model call and a second failure mode for recall this corpus does not need. |
| Redis | Nothing here is hot enough to need it. |
| Microservices | Three deployed pieces, clear module boundaries. Splitting them would add network failure modes and no capability. |
| An agent framework | The agent loop is ~200 lines and every step needs to be auditable. A framework would hide the part that most needs to be visible. |
| A state library | One piece of global state. |
| Docker | Not required by the target platforms. |

## Related documents

[API_SPEC](API_SPEC.md) · [DATABASE](DATABASE.md) · [AI_AGENT](AI_AGENT.md) ·
[SECURITY](SECURITY.md) · [RUNBOOK](RUNBOOK.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)
