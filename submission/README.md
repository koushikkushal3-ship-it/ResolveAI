# ResolveAI — Submission Package

**Theme:** AI for Customer Experience · **Event:** Build_to_Ship Hackathon

Everything an evaluator needs, in one folder.

---

## Deliverables checklist

| # | Deliverable | Status | Where |
|---|---|---|---|
| 1 | **Architecture Documentation** | ✅ Ready | [`01-ARCHITECTURE-DOCUMENTATION.md`](01-ARCHITECTURE-DOCUMENTATION.md) |
| 2 | **AI Integration Breakdown** | ✅ Ready | [`02-AI-INTEGRATION-BREAKDOWN.md`](02-AI-INTEGRATION-BREAKDOWN.md) |
| 3 | **GitHub Repository** | ✅ Public | https://github.com/koushikkushal3-ship-it/SupportIQ |
| 4 | **Live Deployed Link** | ✅ Live | https://resolve-ai-roan.vercel.app |
| 5 | **Demo Video (2–3 min)** | ⬜ **You record** | Script ready: [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) |

### Fill these in before submitting

```
Live application URL : https://resolve-ai-roan.vercel.app          ✅ live
API base URL         : https://resolveai-ukwt.onrender.com         ✅ live
API health check     : https://resolveai-ukwt.onrender.com/api/health
Demo video URL       : ______________________________________
```

Deployment steps: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)

### Test login credentials

| Email | Role |
|---|---|
| `supervisor@resolveai.demo` | SUPERVISOR — can approve actions |
| `agent@resolveai.demo` | AGENT — read and propose only |
| `admin@resolveai.demo` | ADMIN |

Password for all three: **`ResolveAI#2026`**

> Render's free tier sleeps after ~15 minutes idle. Load the app once and allow
> 30–60s for the first request. The UI shows a waking state rather than failing.

---

## Repository requirements

| Requirement | State |
|---|---|
| Public repository | ✅ |
| Readable source, client / server separated | ✅ **`frontend/` = client, `backend/` = server** |
| Commit history | ✅ 18 commits, each scoped and explained |
| `.env.example`, no real keys | ✅ Both apps, empty values only |
| `README.md` | ✅ Root of the repo |

> **Naming note for the evaluator:** the brief writes `/client` and `/server`.
> This repository uses **`frontend/`** and **`backend/`** for the same
> separation. Nothing else differs — `frontend/` is the React client,
> `backend/` is the Express server.

---

## Contents of this folder

| File | What it is |
|---|---|
| [`01-ARCHITECTURE-DOCUMENTATION.md`](01-ARCHITECTURE-DOCUMENTATION.md) | Deliverable 1 — problem statement, user roles, system architecture, database schema, AI integration |
| [`02-AI-INTEGRATION-BREAKDOWN.md`](02-AI-INTEGRATION-BREAKDOWN.md) | Deliverable 2 — prompt design, Zod validation, secret management |
| [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) | Timed 2–3 minute recording script, with what to say |
| [`TEST-EVIDENCE.md`](TEST-EVIDENCE.md) | Real captured output — tests, build, secret scan, determinism |
| [`SUBMISSION.md`](SUBMISSION.md) | One-page overview with rubric mapping |

Deeper technical documentation lives in [`../docs/`](../docs/): `ARCHITECTURE`,
`API_SPEC`, `DATABASE`, `AI_AGENT`, `SECURITY`, `RUNBOOK`, `IMPLEMENTATION_PLAN`.

---

## Rubric mapping

| Criterion | Weight | Evidence |
|---|---|---|
| **Problem Alignment & Value** | 25% | [Deliverable 1 §1](01-ARCHITECTURE-DOCUMENTATION.md#1-problem-statement). The live simulator → risk → policy → AI → guardrail → notification journey. Detects affected customers *before* they complain, which is the assigned problem. |
| **Full-Stack Implementation** | 25% | [`docs/API_SPEC.md`](../docs/API_SPEC.md) — clean REST, JWT auth, full CRUD on incidents/actions/policies, search + filter + sort + pagination on every list, 10-table schema with FK constraints and indexes, React Context state. |
| **AI Security & Integration** | 20% | [Deliverable 2](02-AI-INTEGRATION-BREAKDOWN.md). Backend-only calls, JSON mode with `responseSchema`, Zod re-validation, closed tool registry, guardrails, grep-verified no secrets in the bundle. |
| **Working Deployment & UX** | 20% | Live link above. Loading / error / empty states on every async surface, Zod validation with field-level errors, responsive to 375px, **zero contrast failures in both light and dark themes**. |
| **Video Demo & README Docs** | 10% | [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) + root `README.md` + seven `docs/` files. |

---

## Verification summary

| Check | Result |
|---|---|
| Backend unit tests | **70 / 70** |
| End-to-end (Playwright) | **15 / 15**, also run against production |
| Production build | Clean, no chunk > 500 kB |
| Secret scan — bundle + runtime | Clean |
| Contrast, both themes | **0 failures** across 31 pairs |
| Simulator determinism | 17 / 17 / 5, identical every run |
| Seed invariants | 9 / 9 |

Full output: [`TEST-EVIDENCE.md`](TEST-EVIDENCE.md)

---

## Before you submit

1. **Deploy.** Backend to Render first → copy its URL → set `VITE_API_URL` →
   deploy frontend to Vercel → set `FRONTEND_URL` on Render to the Vercel URL.
   CORS is an exact-origin match, so a mismatch fails every request.
2. **Run the three migrations** in the Supabase SQL Editor, then `npm run seed`.
3. **Record the video** using `DEMO-SCRIPT.md`.
4. **Fill in the three URLs** at the top of this file.
5. **Rotate your API keys** if any were shared outside the `.env` file. They are
   not in git — every commit was scanned — but treat any key that left the file
   as burned. Procedure in [`docs/SECURITY.md`](../docs/SECURITY.md).
6. **Confirm the repository is public** and stays public through judging.
