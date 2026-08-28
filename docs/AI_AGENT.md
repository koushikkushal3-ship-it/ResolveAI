# AI Agent

## The governing principle

**The model proposes. The backend decides.**

No model output reaches the database without passing Zod validation, a tool
whitelist, a role check and the guardrail layer. No model-generated code is ever
executed. The worst outcome of a fully successful prompt injection is a *bad
suggestion* that a guardrail rejects or a human reviews.

## What the model is not allowed to decide

The single most important design choice here: **`riskScore` and `riskLevel` are
not model outputs.**

They are computed by `services/risk.js` *before* the call and passed in as an
authoritative fact. The model reasons about a number it cannot change. That
removes an entire class of hallucination rather than trying to detect it after
the fact.

The model also has no access to authentication, database permissions, monetary
limits, or authorization rules.

## The risk engine

Deterministic, pure, no AI. Gemini may *describe* these factors in prose; it can
never change the number.

| Factor | Condition | Points |
|---|---|---|
| `premium_customer` | `segment = 'PREMIUM'` | +20 |
| `delay_over_48h` | `delay_hours > 48` | +30 |
| `delay_24_48h` | `24 < delay_hours ≤ 48` (mutually exclusive with the above) | +15 |
| `high_value_order` | `amount ≥ ₹5,000` | +15 |
| `previous_complaint` | ≥ 1 prior complaint conversation | +15 |
| `negative_sentiment` | latest **inbound** sentiment is NEGATIVE | +10 |
| `repeat_incident` | ≥ 2 incidents in 90 days | +10 |
| `ltv_weight` | `min(floor(lifetime_value / 50000), 10)` | +0…10 |

`clamp(0,100)` → `0–39 LOW · 40–69 MEDIUM · 70–100 HIGH`.

**On `ltv_weight`:** the original spec asserts Priya Sharma scores 91, but its
flat weights sum to **90** for her case — `repeat_incident` does not apply, so 91
was arithmetically unreachable. Rather than fudge a weight, a continuous
lifetime-value factor closes the gap. Seeded at ₹50,000 she gains +1 →
**exactly 91 / HIGH**, and a unit test pins it so a future seed change cannot
silently break the demo narrative.

34 unit tests cover every factor in isolation, both clamp boundaries, every band
threshold, and the mutual exclusivity of the two delay tiers.

## Policy retrieval (RAG)

PostgreSQL full-text search over a GENERATED tsvector — **not embeddings**.

Eight short governance documents resolve reliably by lexical search. Embeddings
would add a migration, a backfill, a model call per query and a second failure
mode, in exchange for recall this corpus does not need. If the base grows past a
few dozen documents, add a pgvector column behind the same `searchPolicy()`
interface; nothing else changes.

Two signals, weighted so the deterministic one dominates:

1. **Incident type → category map** — the primary signal. Deterministic, and
   crucially **cannot be steered by text in a customer message**.
2. **Full-text relevance** — orders candidates within that set.

Queries are stripped of quotes, parentheses and websearch boolean operators
before they reach `websearch_to_tsquery`. The query is built partly from
customer-supplied text, and that text is data, not syntax it gets to control.

**Empty results are returned as empty.** The retriever never invents a policy;
the caller escalates.

## Structured output, enforced twice

`responseMimeType: 'application/json'` plus a `responseSchema` on the request,
then **re-validated with Zod on receipt**. A model is not trusted to have
honoured its own schema.

```jsonc
{
  "incidentSummary": "…",
  "riskFactorSummary": ["premium customer", "72 hour delay"],
  "recommendedAction": "PRIORITY_DELIVERY_AND_CREDIT",
  "creditAmount": 500,
  "customerMessage": "…",
  "requiresHumanApproval": false,
  "policyReference": "delivery-compensation-v2",
  "confidence": 0.95,
  "rationale": "one sentence of decision evidence"
}
```

A cited policy slug that was **not in the block the model was given** is
downgraded to an escalation rather than trusted.

`rationale` is a *conclusion*, not chain-of-thought. No hidden reasoning is
requested, stored or displayed, and the length cap makes a reasoning dump
impossible to fit even if the model tried.

## Tool registry

Gemini **names** a tool. It never invokes one.

```
name → whitelist lookup → Zod parse → role check → handler → audit
```

A closed set defined at module load. No `eval`, no dynamic resolution, no
string-to-function lookup. Unknown names and unauthorized calls are rejected
**and audited** — a model reaching for a tool it may not have is signal worth
keeping.

| Read-only (auto) | Mutating (guardrailed) |
|---|---|
| `getCustomer` `getCustomerOrders` `getCustomerHistory` `getOrderStatus` `searchPolicy` `calculateCXRisk` | `offerPriorityDelivery` `issueCredit` `sendCustomerNotification` `createEscalation` |

Tool arguments are capped at the boundary too — `issueCredit` rejects an absurd
amount before it reaches the guardrails, because a tool argument is the first
place a nonsense value can arrive.

## Guardrails

A pure function: no database, no request, no clock it does not receive. Every
branch is unit-tested, and the rules read as rules instead of scattering across
controllers.

| Rule | Outcome |
|---|---|
| `credit ≤ ₹500` **and** policy matched **and** `confidence ≥ 0.7` | auto-execute |
| `credit > ₹500` | human approval |
| Cumulative credit > ₹1,000 per customer in 24h | human approval |
| `PAYMENT_*`, `ACCOUNT_*`, `REFUND` | **always** human approval |
| No governing policy | escalate, amount forced to 0 |
| `confidence < 0.7` on any monetary action | human approval |
| Approver is the proposer | `403` — and a DB constraint besides |

**The decisive property, with its own test:** a model claiming
`requiresHumanApproval: false` on a ₹5,000 credit is still stopped. The model can
ask *for* a human; it can never clear a rule. Reasons accumulate rather than
short-circuiting, so the audit row shows every rule that fired.

The frontend mirrors these for UX. That mirror is **not** a control.

## Prompt injection

Customer messages, conversation summaries and policy text are **data, never
instructions**. They are delivered inside labelled, fenced blocks, and the fence
delimiter is escaped out of the content so it cannot be terminated early. The
system instruction states that content inside a fence cannot alter the task.

That layer is real but it is not the load-bearing one, and it is not treated as
such. The structural defences are: the model executes nothing, retrieval cannot
be steered by message text, the risk score is not the model's to set, and the
guardrails run *after* the model and are unreachable from prompt text.

Verified: an injection-shaped query neither throws nor escapes its policy
category.

## Failure handling

| Failure | Behaviour |
|---|---|
| Quota / 429 | Next key for that provider — the only failure that is a property of the key |
| Any other provider error | Write the whole provider off for this call; every sibling key fails identically |
| Transient 5xx | One retry, only if there is budget left in the deadline |
| Invalid JSON / schema | One fallback. A re-prompt loop can burn quota and still fail. |
| No policy found | Escalate. Never invent one. |
| Confidence below floor | Force human approval |

Bounded by an **8s per-attempt timeout and a 20s chain deadline**. Classification
alone cannot bound this: a bad model surfaces from the SDK as
`TypeError: fetch failed` with no status — indistinguishable from a network blip
— and each attempt costs ~11s of connect timeout. Treated as transient and
retried across 11 keys, one misconfiguration took **242 seconds** to reach the
fallback. Now: **9 seconds.**

## Cost discipline

- **One** model call per analyze.
- Recommendation cached on `customer_incidents` — re-opening a customer re-reads
  the row.
- Dashboards, analytics and risk scores make **zero** model calls.
- Only the fields the decision needs are sent; the top-ranked policy goes in
  full, alternates contribute slug and title.
- `thinkingLevel: 'low'` — Gemini 3.x thinking tokens count against
  `maxOutputTokens`, and left alone this prompt burned ~1,150 of them and
  truncated the JSON mid-object.

Measured, before → after: prompt 1,064 → 646 tokens, thinking 1,148 → 294,
**total 2,247 → 1,205 per call (−46%)**, latency 18.8s → 4.7s.

## The deterministic fallback

A rule table keyed on incident type, risk level and policy. Produces
schema-valid output with a templated customer message, `ai_generated: false`,
and `confidence: 0`.

That zero is deliberate. A rule has no opinion about its own certainty, and
inventing one would let it slip past the confidence floor. Because it reports
zero, **a degraded AI path can never auto-spend money** — with no special case
written for it.

**The demo completes with every API key removed.**
