# Security

> No automated process can prove the absence of vulnerabilities. This document
> states what was checked, what was found, and what risk remains. It does not
> claim zero vulnerabilities.

## Summary

**No known critical or high security issues were identified by the selected
checks and review.** Residual risks are listed at the bottom, unhedged.

## Trust boundary

```
Browser  ──┐  knows exactly one variable: VITE_API_URL (not a secret)
           │
           ▼
Express API   ◄── the ONLY holder of every credential
           │
           ├──► Supabase (service-role key)
           └──► LLM providers (Gemini / Groq / OpenRouter keys)
```

The browser never contacts Supabase or a model provider. There is one
privileged process.

## Secrets

| Control | State |
|---|---|
| `.gitignore` covering `.env*` | In **commit 1**, before any env file could exist |
| `.env.example` | Empty values only |
| Secrets in git history | None — every commit scanned before push |
| Secrets in the production bundle | **Grep-verified absent** |

The bundle check is part of the Definition of Done and is also an automated E2E
test, because the hackathon makes an exposed key an instant disqualification and
a manual check is one forgotten step away from failing.

```
gsk_ · sk-or-v1 · AQ.Ab8 · SUPABASE_SERVICE_ROLE · JWT_SECRET · supabase.co
  → all absent from dist/
```

The E2E spec re-checks this at runtime across the served HTML, every loaded
script and `localStorage`.

## Authentication

- **bcrypt**, cost 10. Never logged, never returned, never in an error message.
- Password length capped at **72 bytes** — bcrypt's own limit. Without the cap,
  everything past byte 72 is silently ignored, which makes two different long
  passwords interchangeable.
- **JWT** HS256, 8h expiry, `{ sub, email, role }`. Verified on every protected
  route. Never logged.
- `authenticate()` **re-reads the user row on every request**, so a deactivated
  account or a demoted role loses access immediately rather than at token expiry.
- A JWT is signed but readable and editable by its holder, so the role it claims
  is never trusted — the server's own lookup is.

**Account enumeration.** Wrong password and unknown address return byte-identical
responses. A dummy bcrypt hash is compared when no account matches, so both take
the same time — uniform wording alone does not stop enumeration, response timing
does it anyway. Verified in the E2E suite by comparing both error strings.

## Authorization

Two layers.

**Role** — `AGENT` < `SUPERVISOR` < `ADMIN`. Approve/reject and knowledge writes
require SUPERVISOR+.

**Ownership** — incidents, actions and knowledge documents carry `created_by`.
An AGENT may only modify rows they created.

**Separation of duties** — nobody approves an action they proposed. Enforced in
the service layer *and* by a database `CHECK` constraint. Verified at both
layers, including with the service layer bypassed entirely:

```
service:  403 "You cannot approve an action you proposed yourself"
database: violates check constraint "chk_action_separation_of_duties"
```

Frontend role checks exist only to avoid a pointless 403. They are **not**
controls, and the E2E suite proves the API refuses even when the UI is bypassed.

## Input validation

Every body, path parameter and query value passes through Zod. The parsed result
**replaces** the raw input, so downstream code cannot read an unvalidated field.

`sort` is an allow-list per resource, never free text, because the value reaches
the query builder. Tool arguments are capped at the boundary as well as in the
guardrails.

## AI-specific controls

| Control | Detail |
|---|---|
| Backend-only calls | No provider SDK or key exists in frontend code |
| Tool authorization | Closed registry, Zod-validated args, role-checked, every rejection audited |
| No code execution | The model names a tool; it never invokes one. No eval, no dynamic dispatch. |
| Risk score integrity | Computed deterministically before the call; not a model output |
| Policy integrity | A cited slug that was not in the supplied block is downgraded to an escalation |
| Monetary limits | Pure-function guardrails, after the model, unreachable from prompt text |
| Prompt injection | Untrusted text fenced and labelled; fence delimiter escaped out of content |

**The decisive test:** a model claiming `requiresHumanApproval: false` on a
₹5,000 credit is still stopped. The model can ask *for* a human; it can never
clear a rule.

## Transport and HTTP

- `helmet()` — CSP, HSTS, `X-Content-Type-Options`, frame options, referrer
  policy. `x-powered-by` disabled.
- **CORS**: the exact `FRONTEND_URL` origin. Never reflected.
- Body cap **100 kB**. An unbounded parser is a free denial-of-service.
- Rate limits: auth 10/15min per IP (with `skipSuccessfulRequests`), agent and
  simulator 20/15min per user, global 300/15min.
- The agent limiter keys on user id and falls back to `ipKeyGenerator`, **not**
  raw `req.ip`: an IPv6 client holds a whole /64 and could otherwise rotate
  addresses to bypass the limit.

## Error handling

Two paths. Expected errors (`HttpError`, `ZodError`) return their own message.
Everything else returns a generic 500/503 with the real error logged
server-side only.

That default matters: a Postgres error message can contain a column list, a
constraint name or a connection string, and a stack trace can contain
filesystem paths.

## Audit

Append-only `audit_logs`. Every auth event, AI decision, guardrail verdict,
tool call, tool rejection, approval and execution. Never contains a password,
token or key.

## Database

RLS enabled and FORCEd on all ten tables, `anon`/`authenticated` grants revoked,
restrictive deny-all policies declared.

**RLS does not secure the API.** The backend connects with the service-role key,
which bypasses RLS by design. RLS here is defence-in-depth against one scenario:
the `anon` key becoming public. This is stated plainly because a security control
you believe in but do not have is worse than one you know you lack.

Invariants that a code bug must not be able to violate are `CHECK` constraints,
not application logic — separation of duties, `executed_at` only on `EXECUTED`,
`risk_score` in range, `amount >= 0`.

## Checks performed

| Check | Result |
|---|---|
| Secret scan of every commit before push | Clean |
| Secret scan of the production bundle | Clean |
| Runtime secret scan (E2E) | Clean |
| Authorization — role and ownership | 14/14 E2E specs pass |
| Separation of duties, both layers | Blocked at service and database |
| Guardrail branches | 36 unit tests, all branches |
| Risk engine | 34 unit tests |
| Account enumeration | Identical response and timing |
| Contrast / accessibility | Zero failures, both themes |
| `npm audit` | See below |

## Residual risks

**1. The JWT is stored in `localStorage`, which is XSS-reachable.**
Chosen because the SPA and API are on different origins, where an httpOnly
cookie needs `SameSite=None` plus credentialed CORS — more moving parts than a
one-day build should carry. Mitigations: 8h expiry, no
`dangerouslySetInnerHTML` anywhere, React's default escaping, CSP via helmet.
**Upgrade path:** httpOnly `SameSite=None; Secure` cookie.

**2. RLS is not the enforcement layer.** Documented above. If the API is ever
bypassed with the service-role key, RLS will not help.

**3. Rate limiting is in-process.** It resets on restart and is per-instance. On
a single Render instance that is the whole surface; horizontally scaled it would
need a shared store.

**4. Prompt injection is mitigated structurally, not perfectly.** The fencing
layer can be defeated. The reason that is acceptable is that defeating it yields
a bad *suggestion*, not an action — the model executes nothing, cannot steer
retrieval, cannot set the risk score, and cannot reach the guardrails.

**5. Notification delivery is simulated.** No live SMS/email provider. A real
integration would add outbound credentials and a new failure mode.

**6. Demo credentials are public.** Deliberate — the hackathon requires working
test logins. They must not be reused anywhere real.

## If a key is exposed

1. Revoke it at the provider immediately — Google AI Studio, Groq, OpenRouter,
   or Supabase (**Settings → API → roll the service-role key**).
2. Update the value in Render's environment and redeploy.
3. Rotate `JWT_SECRET`. This invalidates every session, which is the point.
4. Check `audit_logs` for activity in the exposure window.

Never rely on a git history rewrite. Treat any key that reached a public commit
as burned.
