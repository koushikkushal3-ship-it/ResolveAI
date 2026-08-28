# Deployment

The app runs **both locally and deployed** from the same code. The only
difference is environment variables.

---

## Current state

| Piece | Status |
|---|---|
| Backend (Render) | ✅ https://resolveai-ukwt.onrender.com |
| Database (Supabase) | ✅ migrations applied, seeded |
| Frontend (Vercel) | ⬜ next step |

---

## Step 1 — Fix two things on Render now

Open your Render service → **Environment**, and set:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |

`/api/health` currently reports `"env":"development"`. In development the server
auto-allows `localhost` origins and disables rate limiting in test paths;
production is the correct posture for a public deployment.

Leave `FRONTEND_URL` for now — Step 3 sets it, once Vercel has given you a URL.

## Step 2 — Deploy the frontend to Vercel

**Import the repo**, then set:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

**Environment Variables** — add one:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://resolveai-ukwt.onrender.com` |

> No trailing slash. The client appends `/api/...` itself.

`frontend/vercel.json` is already committed and handles the SPA rewrite, so
refreshing on `/customers/:id` resolves instead of 404-ing.

Deploy, and copy the URL Vercel gives you.

## Step 3 — Point the backend back at it

Render → **Environment** → set:

| Key | Value |
|---|---|
| `FRONTEND_URL` | `https://YOUR-APP.vercel.app,http://localhost:5173` |

**Comma-separated, no spaces, no trailing slashes.**

Including `http://localhost:5173` lets you run the frontend on your laptop
against the deployed API — useful for debugging without a redeploy. Drop it if
you would rather the production API only ever answer the production frontend.

Render redeploys automatically on an environment change. Wait for it to finish
before testing, or CORS will still be running the old value.

## Step 4 — Verify

```bash
# Backend is up and knows it is in production
curl https://resolveai-ukwt.onrender.com/api/health

# CORS accepts your Vercel origin
curl -sI -H "Origin: https://YOUR-APP.vercel.app" \
  https://resolveai-ukwt.onrender.com/api/health | grep -i access-control

# ...and refuses anything else
curl -sI -H "Origin: https://evil.example.com" \
  https://resolveai-ukwt.onrender.com/api/health | grep -i access-control
```

The second should echo your origin. The third should print **nothing** — no
`Access-Control-Allow-Origin` header at all.

Then open the app and walk the journey: sign in → simulate delivery delay →
open the top-risk customer → analyze → execute → analytics.

---

## Running locally

Nothing changes. The same code works with local environment values:

```bash
# terminal 1
cd backend && npm run dev          # http://localhost:5000

# terminal 2
cd frontend && npm run dev         # http://localhost:5173
```

`frontend/.env` points at `http://localhost:5000`. Outside production the
backend always allows `localhost:5173` regardless of `FRONTEND_URL`, so a fresh
clone works before anything is configured.

### Local frontend against the deployed backend

Point `frontend/.env` at Render:

```
VITE_API_URL=https://resolveai-ukwt.onrender.com
```

This only works if `http://localhost:5173` is in the Render `FRONTEND_URL`
list (Step 3). Otherwise the browser blocks every request — correctly.

---

## How CORS resolves

```
FRONTEND_URL="https://app.vercel.app,http://localhost:5173"
                        │
                        ▼
              exact-origin allow-list
                        │
     ┌──────────────────┼──────────────────┐
     ▼                  ▼                  ▼
 on the list        no Origin          not on the list
 echo it back    (curl, health)         no header
                   allow                  BLOCKED
```

The Origin header is never reflected blindly — that would defeat the point of
CORS. Trailing slashes are normalised, so `https://app.vercel.app/` and
`https://app.vercel.app` both match.

---

## Troubleshooting

**"CORS policy: No 'Access-Control-Allow-Origin' header"**
`FRONTEND_URL` on Render does not contain your Vercel origin exactly. Check for
a trailing slash, `http` vs `https`, or a stale deploy. Confirm with the curl
command in Step 4.

**Every request 401s after login**
`VITE_API_URL` is wrong or has a trailing slash, producing `//api/...`. Check
the Network tab for the actual URL being called.

**First request takes 30–60s**
Render's free tier sleeps after ~15 minutes idle. Expected. The frontend uses a
60s timeout and shows a waking state. Before a demo, load `/api/health` a minute
early. For sustained uptime, point an external pinger at it — that also stops
the Supabase project pausing.

**`analyze` fails with a missing `is_outbound` column**
Migration `003_outbound_conversations.sql` has not been run against the Supabase
project the deployed backend is using.

**Refreshing a deep link 404s on Vercel**
`vercel.json` was not picked up — confirm Root Directory is `frontend`.
