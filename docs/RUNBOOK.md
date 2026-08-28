# Runbook

## Local start, from nothing

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill it in — see Environment below
npm install

# 2. Database — paste each file into the Supabase SQL Editor, in order:
#    src/db/migrations/001_schema.sql
#    src/db/migrations/002_rls.sql
#    src/db/migrations/003_outbound_conversations.sql

npm run seed                  # must end with 9 PASS lines
npm run dev                   # http://localhost:5000

# 3. Frontend, in a second terminal
cd frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

Sign in with `supervisor@resolveai.demo` / `ResolveAI#2026`.

## Environment

**`backend/.env`** — every value here is a secret except `PORT`, `NODE_ENV`,
`GEMINI_MODEL` and `FRONTEND_URL`.

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Bypasses RLS. Backend only.** |
| `JWT_SECRET` | ≥32 chars. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `GEMINI_API_KEY` | Plus `GEMINI_API_KEY_2`, `_3`, … — rotated on quota errors |
| `GROQ_API_KEY` / `GROQ_MODEL` | Optional fallback provider |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Optional fallback provider |
| `FRONTEND_URL` | Exact CORS origin, no trailing slash |

The process **refuses to start** on a missing or malformed secret, and prints
which variable is wrong without printing its value.

**`frontend/.env`** — exactly one variable, `VITE_API_URL`, and it is not a
secret. Vite exposes every `VITE_*` value to the browser bundle, so nothing else
may go in this file.

## Verification

```bash
cd backend  && npm test                # 70 unit tests
cd frontend && npm run build           # production build
cd frontend && npx playwright test     # 14 E2E specs
```

Health, which also tells you the provider chain without revealing keys:

```bash
curl http://localhost:5000/api/health
# {"data":{"status":"ok","aiConfigured":true,
#          "aiProviders":{"gemini":12,"groq":3,"openrouter":3}}}
```

Secret scan of the built bundle — run this before every submission:

```bash
cd frontend && npm run build
grep -rE "gsk_|sk-or-v1|AQ\.Ab8|SERVICE_ROLE|JWT_SECRET|supabase\.co" dist/ \
  && echo "!! SECRET IN BUNDLE" || echo "clean"
```

## Deployment

| Piece | Platform | Notes |
|---|---|---|
| Frontend | Vercel | Root `frontend`, build `npm run build`, output `dist`. Set `VITE_API_URL`. Add an SPA rewrite so deep links resolve. |
| Backend | Render | Root `backend`, build `npm install`, start `npm start`. Set all secrets. `FRONTEND_URL` = the Vercel URL. |
| Database | Supabase | Run the three migrations, then seed once. |

Vercel needs `frontend/vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Without it, refreshing on `/customers/123` returns a 404 — the server looks for
a file at that path.

**Order matters.** Deploy the backend first, take its URL, set `VITE_API_URL`,
then deploy the frontend and set `FRONTEND_URL` on Render to the Vercel URL.
CORS is an exact-origin match, so a mismatch fails every request.

Post-deploy, walk the real journey: login → simulate delivery delay → open the
top-risk customer → analyze → execute → check analytics → logout. Then re-run
the bundle secret scan against the deployed assets.

---

## Troubleshooting

### Every table returns "Invalid API key" with an empty error message

The service-role key is malformed. The most common cause is pasting it *after*
the placeholder instead of over it, producing `REPLACE_MEeyJhbGci…`. Check the
prefix — a Supabase service-role key starts with `eyJ`.

```bash
node -e "require('dotenv').config();const k=process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(k.slice(0,3), k.length)"   # expect: eyJ 219
```

### The AI falls back on every request

Check the health endpoint first — `aiConfigured: false` means no key was parsed.

If keys are configured, the cause is usually one of:

- **The model is not available on your plan.** `gemini-2.5-flash` returns 404 for
  new accounts; the API names `gemini-3.6-flash` as the replacement. Groq's model
  list varies by account — check `GET https://api.groq.com/openai/v1/models`.
- **Zero free-tier quota**, which surfaces as 429 with `limit: 0`. That is not
  transient; the model is unavailable on that plan.
- **Latency.** Gemini's endpoint shows intermittent 25–45s responses. Attempts
  are capped at 8s and the whole chain at 20s, so slow calls fail over rather
  than hanging. This is working as designed.

The app is fully usable in this state. The deterministic fallback produces a
valid recommendation, and the UI labels it rather than pretending.

### `analyze` errors on a missing `is_outbound` column

Migration `003_outbound_conversations.sql` has not been run.

### Tickets-avoided stays at zero after a successful resolution

Fixed, but the mechanism is worth knowing: `actions.incident_id` is
`ON DELETE SET NULL`, so re-running a simulator scenario nulls the link on any
action already raised against the incident it replaced. Code that keys the
"resolved" update on that column alone matches zero rows.

### Simulator numbers drift from 17 / 17 / 5

Re-seed. `npm run seed` asserts the shape and exits non-zero if it is wrong.
A scenario replaces its own previous run, so repeated simulator use is safe; a
partially-applied seed is not.

### Port 5173 already in use

The frontend needs that exact port — the backend pins CORS to it.

```bash
# PowerShell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

### Render cold start

Free web services sleep after ~15 minutes idle and take 30–60s to wake. The
frontend uses a 60s axios timeout and shows a waking state rather than failing.

Before a demo, hit `/api/health` a minute early. For sustained uptime, point an
external pinger at it — this also keeps the Supabase project from pausing.

### E2E specs fail on counts

Re-seed first. The specs assert exact numbers (17 / 17 / 5) and share one
database, which is why `workers: 1` is set — a simulator run in one worker would
move the numbers another worker is asserting on.

## Routine operations

**Reset the demo to a known state**

```bash
cd backend && npm run seed
```

Idempotent. Clears in FK order and rebuilds. Existing sessions are invalidated
because `app_users` rows get new ids — that is correct behaviour, and the app
returns you to the login screen rather than breaking.

**Add another provider key** — add `GEMINI_API_KEY_4` (or `_5`…) and restart.
Discovery scans the environment; no code change is needed.

**Rotate `JWT_SECRET`** — change it and restart. Every session is invalidated,
which is the point.

**Change a guardrail limit** — `backend/src/services/guardrails.js`. Change the
constant, run `npm test`, and confirm the branch tests still describe reality.
`GET /api/actions/guardrails` serves the live values to the UI, so the interface
updates without a second edit.
