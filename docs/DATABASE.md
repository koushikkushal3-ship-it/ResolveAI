# Database

Supabase PostgreSQL. Ten tables, `snake_case`, UUID primary keys
(`gen_random_uuid()`), `timestamptz` throughout, `created_at` + `updated_at` on
every mutable table via a shared trigger.

## Naming, and one collision worth knowing

| Table | Holds |
|---|---|
| `app_users` | **Support agents** — the people who log in |
| `profiles` | **Customers** — the people incidents happen to |

The original spec used `profiles` for customers while Supabase convention uses
it for authenticated users. Merging them would have broken both auth and the CX
model, so they are deliberately separate. Everything downstream reads more
clearly once that distinction is fixed.

## Schema

| Table | Purpose | Notable columns |
|---|---|---|
| `app_users` | Auth subjects | `email` UNIQUE, `password_hash`, `role`, `is_active` |
| `profiles` | Customers | `segment`, `lifetime_value`, `preferred_channel` |
| `orders` | Orders | `customer_id` FK **RESTRICT**, `amount`, `status`, `expected_delivery`, `current_eta`, `carrier` |
| `incidents` | Operational events | `type`, `severity`, `status`, `started_at`, `resolved_at`, `created_by`, `is_simulated` |
| `customer_incidents` | Who an incident hurt | `risk_score`, `risk_level`, `risk_factors` JSONB, `ai_recommendation` JSONB, UNIQUE(`customer_id`,`incident_id`) |
| `conversations` | Support threads | `sentiment`, `is_complaint`, **`is_outbound`** |
| `messages` | Thread messages | `conversation_id` FK **CASCADE**, `sender` |
| `actions` | Every AI/human decision | `action_type`, `amount`, `status`, `policy_reference`, `confidence`, `guardrail_result` JSONB, `created_by`, `approved_by` |
| `knowledge_documents` | Policy base | `slug` UNIQUE, `version`, `content`, **`search_vector`** GENERATED tsvector |
| `audit_logs` | Append-only trail | `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata` |

## Invariants enforced by the database, not the application

These are `CHECK` constraints because application code is the wrong place to be
the only guard on a money path.

| Constraint | Prevents |
|---|---|
| `chk_action_separation_of_duties` | `approved_by <> created_by` — nobody approves their own action, even if the service layer is bypassed entirely |
| `chk_action_executed_at` | An `executed_at` on anything that is not `EXECUTED` |
| `chk_incident_resolved_at` | A `resolved_at` on anything that is not `RESOLVED` |
| `risk_score BETWEEN 0 AND 100` | An out-of-range score |
| `amount >= 0` | A negative credit |
| CHECK enums | An unknown segment, role, severity, status, sentiment or action type |

Separation of duties is verified at both layers. With the service layer skipped
and the write issued directly, PostgreSQL still refuses:

```
new row for relation "actions" violates check constraint
"chk_action_separation_of_duties"
```

## Two columns that carry more weight than they look

**`knowledge_documents.search_vector`** — a GENERATED tsvector with weighted
title (A), category (B) and content (C). This is the entire RAG layer. It means
policy retrieval is deterministic, auditable and costs zero model quota. A GIN
index backs it.

**`conversations.is_outbound`** — added in migration 003 to fix a real bug.
Executing an action writes the customer notification as a conversation, which
then became that customer's *latest sentiment*. Resolving a HIGH-risk customer
therefore **lowered their risk score** — Priya dropped 91 → 81 the moment she
was helped. A message the business sends is not evidence of how the customer
feels, so outbound threads are marked and excluded from the risk signal.

## Foreign key behaviour, and why each was chosen

| Relationship | Behaviour | Reason |
|---|---|---|
| `orders → profiles` | `RESTRICT` | Losing order history would silently corrupt every risk score |
| `messages → conversations` | `CASCADE` | A message has no meaning without its thread |
| `customer_incidents → incidents` | `CASCADE` | The link exists only for that incident |
| `actions → incidents` | `SET NULL` | Executed history must survive an incident being replaced |

The last one has a consequence worth stating: re-running a simulator scenario
deletes its previous incident, which nulls `incident_id` on any action already
raised against it. Code that keys on that column alone will match zero rows —
which is exactly the bug that held "tickets avoided" at zero on the dashboard
after a successful resolution. `executeAction` now falls back to the customer's
open case when the link is null.

## Indexes

`orders(customer_id)` · `orders(status)` ·
`customer_incidents(incident_id, risk_score DESC)` ·
`actions(status, created_at DESC)` · `incidents(status, started_at DESC)` ·
`audit_logs(entity_type, entity_id)` · GIN on `knowledge_documents.search_vector` ·
partial index on `conversations(customer_id) WHERE NOT is_outbound` ·
partial index on the 24-hour credit window.

## Row Level Security — read this before assuming it protects the API

RLS is enabled and FORCEd on all ten tables, direct `anon`/`authenticated`
grants are revoked, and restrictive deny-all policies are declared.

**It does not secure the API.** The backend connects with
`SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS by design. RLS here is
defence-in-depth against one specific scenario: the `anon` key becoming public.
The frontend never uses it, but keys leak, and a leaked anon key against a table
with RLS disabled reads the entire database.

The enforced authorization is Express middleware plus service-layer ownership
checks. This is stated plainly rather than glossed, because a security control
you believe in but do not have is worse than one you know you lack.

## Migrations

Plain SQL, run in the Supabase SQL Editor in numbered order. No ORM.

| File | Contents |
|---|---|
| `001_schema.sql` | Ten tables, constraints, indexes, `updated_at` triggers |
| `002_rls.sql` | RLS enable + FORCE, grant revocation, deny-all policies |
| `003_outbound_conversations.sql` | `is_outbound` column, partial index, backfill |

Verify after running:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;   -- 10 rows, all true
```

## Seed

`npm run seed` — idempotent, clears in FK order, rebuilds.

50 customers · 150 orders · 20 incidents · 30 conversations · 40 messages ·
30 actions · 8 policies · 3 agent accounts.

The numbers the demo narrative depends on are hand-authored, not generated, and
the script asserts nine invariants and **exits non-zero** if the shape drifts:

```
PASS  affected orders = 17
PASS  HIGH-risk customers = 5
PASS  Priya Sharma = 91 HIGH
```

Delays are anchored to run time (`expected = now − delayHours`, `eta = now`), so
the data always looks current while the computed delay stays exact. Filler
records use a seeded PRNG, so repeat runs are byte-identical.
