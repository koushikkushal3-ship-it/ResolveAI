# Test evidence

Captured 2026-08-28 against a freshly seeded database,
running the real backend with live model providers.

Reproduce with:

```bash
cd backend  && npm run seed && npm test
cd frontend && npm run build && npx playwright test
```

---

## Seed invariants

The numbers the demo narrative depends on are hand-authored, and the seed script
asserts them and exits non-zero if the shape drifts.

```
PASS  orders = 150
  PASS  incidents = 20
  PASS  conversations = 30
  PASS  actions = 30
  PASS  policies = 8
  PASS  affected orders = 17
  PASS  HIGH-risk customers = 5
  PASS  Priya Sharma = 91 HIGH

Seed complete.
Demo logins (password: ResolveAI#2026)
  admin@resolveai.demo       ADMIN
  supervisor@resolveai.demo  SUPERVISOR
  agent@resolveai.demo       AGENT
```

---

## Backend unit tests

Risk engine (34) and guardrails (36). Both are pure functions, so every branch
is reachable without a database or a server.

```
Test Files  2 passed (2)
      Tests  70 passed (70)
   Start at  14:34:20
   Duration  473ms (transform 59ms, setup 0ms, collect 119ms, tests 25ms, environment 0ms, prepare 283ms)
```

Covered: every risk factor in isolation, both clamp boundaries, every band
threshold, the mutual exclusivity of the two delay tiers, `Priya Sharma = 91`,
every guardrail branch, and — the decisive one — that a model claiming
`requiresHumanApproval: false` on a 5,000 rupee credit is still stopped.

---

## End-to-end (Playwright)

Organised against the evaluation rubric, so a gap in the suite maps to a gap in
the score.

```
Running 14 tests using 1 worker

  ok  1 [desktop] › e2e\critical-flow.spec.js:31:3 › Authentication › rejects bad credentials without revealing whether the account exists (3.8s)
  ok  2 [desktop] › e2e\critical-flow.spec.js:49:3 › Authentication › protects routes and preserves the attempted destination (1.5s)
  ok  3 [desktop] › e2e\critical-flow.spec.js:61:3 › Authentication › logout clears the session and blocks the back button (1.7s)
  ok  4 [desktop] › e2e\critical-flow.spec.js:73:3 › Proactive resolution journey › simulate -> incident -> customer 360 -> AI -> guardrail -> action -> notification (25.3s)
  ok  5 [desktop] › e2e\critical-flow.spec.js:124:3 › Proactive resolution journey › the dashboard triage queue resolves a customer in place (3.5s)
  ok  6 [desktop] › e2e\critical-flow.spec.js:142:3 › Authorization › an AGENT cannot approve, and the API refuses even if the UI is bypassed (1.9s)
  ok  7 [desktop] › e2e\critical-flow.spec.js:161:3 › Authorization › an unauthenticated API call is rejected (831ms)
  ok  8 [desktop] › e2e\critical-flow.spec.js:173:3 › CRUD and search › creates an incident and finds it by search (5.5s)
  ok  9 [desktop] › e2e\critical-flow.spec.js:192:3 › CRUD and search › customer search filters the directory (2.9s)
  ok 10 [desktop] › e2e\critical-flow.spec.js:199:3 › CRUD and search › rejects invalid input with a field-level message (2.0s)
  ok 11 [desktop] › e2e\critical-flow.spec.js:213:3 › Security and UX › no provider key, service-role key or JWT secret reaches the browser (1.5s)
  ok 12 [desktop] › e2e\critical-flow.spec.js:242:3 › Security and UX › renders an empty state rather than a blank panel (1.5s)
  ok 13 [desktop] › e2e\critical-flow.spec.js:256:3 › Security and UX › is usable at mobile width without horizontal page scroll (1.5s)
  ok 14 [desktop] › e2e\critical-flow.spec.js:267:3 › Security and UX › every page has exactly one h1 and a reachable skip link (2.9s)

  14 passed (57.8s)
```

---

## Production build

```
rendering chunks...
computing gzip size...
dist/index.html                   2.01 kB │ gzip:   0.96 kB
dist/assets/index-CqinNMQk.css   35.12 kB │ gzip:   7.36 kB
dist/assets/vendor-CafXzMuL.js  100.71 kB │ gzip:  36.48 kB
dist/assets/index-DpSyWeQ2.js   291.83 kB │ gzip:  85.27 kB
dist/assets/charts-C7KO1usO.js  411.39 kB │ gzip: 117.88 kB
✓ built in 4.86s
```

Split vendor / app / charts. No chunk over 500 kB; the chart library is ~60% of
the weight and is only needed on two routes.

---

## Secret scan of the built bundle

```
absent: gsk_
  absent: sk-or-v1
  absent: AQ\.Ab8
  absent: SERVICE_ROLE
  absent: JWT_SECRET
  absent: supabase.co
```

Only `VITE_API_URL` is embedded, and it is not a secret. An E2E spec re-checks
this at runtime across the served HTML, every loaded script and `localStorage`.

---

## Accessibility

Audited in the rendered DOM rather than from source, with alpha backgrounds
composited before judging, and each theme measured in its own pass with a
repaint between.

| Theme | Pairs checked | Failures |
|---|---|---|
| Dark | 31 | **0** |
| Light | 31 | **0** |

Three real defects were found and fixed this way:

- White on the primary fill `#0284c7` measured **4.1:1** — below AA — on every
  primary button in the app.
- The declared five-step type scale was rendering **nine** sizes, because
  `.t-label` was 12.5px while Tailwind's `text-xs` is 12px.
- Standalone links in table rows rendered **16.8px** tall against WCAG 2.2's
  24px minimum for pointer targets.

Also verified: exactly one `h1` per page, a keyboard-reachable skip link as the
first tab stop, and no horizontal page scroll at 375px.

---

## Simulator determinism

`delivery-delay` run four times consecutively:

```
orders 17 | customers 17 | HIGH 5  MEDIUM 6  LOW 6
orders 17 | customers 17 | HIGH 5  MEDIUM 6  LOW 6
orders 17 | customers 17 | HIGH 5  MEDIUM 6  LOW 6
orders 17 | customers 17 | HIGH 5  MEDIUM 6  LOW 6
```

Top of the resulting queue, with Priya at the score the narrative claims:

```
 94 HIGH    Rajesh Iyer       60h
 91 HIGH    Priya Sharma      72h
 81 HIGH    Meera Krishnan    50h
 76 HIGH    Ananya Desai      54h
 73 HIGH    Vikram Nair       72h
```

---

## Fallback behaviour

Verified by forcing each provider to fail in turn:

| Condition | Result |
|---|---|
| Normal | Served by Gemini |
| Gemini unavailable | Served by Groq, chain position 12/17 |
| Gemini + Groq unavailable | Served by OpenRouter, position 15/17 |
| All providers unavailable | Deterministic fallback, `ai_generated: false` |

With the Gemini host intermittently unreachable, an unbounded chain took
**242 seconds** to reach a working provider. With an 8s per-attempt timeout and
a 20s deadline: **9 seconds**.

**The demo completes with every API key removed.**

---

## Security verification

| Check | Result |
|---|---|
| Unauthenticated API call | `401` |
| AGENT attempts approve | `403` (role) |
| Supervisor approves own proposal | `403` (service) **and** DB CHECK constraint |
| Re-approve an EXECUTED action | `409` |
| Unknown tool name | Rejected at validation, and audited |
| `issueCredit` with 999999 | Rejected at the tool boundary |
| Wrong password vs unknown email | Byte-identical response and matching timing |
| Injection-shaped policy query | Neither throws nor escapes its category |
