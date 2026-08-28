-- =============================================================================
-- ResolveAI — 001_schema.sql
-- Run FIRST in the Supabase SQL Editor. Then run 002_rls.sql. Then `npm run seed`.
--
-- Naming note: `app_users` are SUPPORT AGENTS (the people who log in).
--              `profiles`  are CUSTOMERS (the people the incidents happen to).
-- These are deliberately separate. Merging them would break both auth and the
-- CX model.
--
-- Safe to re-run: every object is created IF NOT EXISTS or dropped first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared: keep updated_at honest without relying on the application layer.
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- app_users — support agents. Authentication subjects.
-- -----------------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text        not null unique,
  password_hash text        not null,
  full_name     text        not null,
  role          text        not null default 'AGENT'
                  check (role in ('AGENT', 'SUPERVISOR', 'ADMIN')),
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_app_users_email on app_users (lower(email));

drop trigger if exists trg_app_users_updated_at on app_users;
create trigger trg_app_users_updated_at
  before update on app_users
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- profiles — customers.
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null,
  email             text        not null unique,
  phone             text,
  segment           text        not null default 'STANDARD'
                      check (segment in ('PREMIUM', 'STANDARD', 'NEW')),
  lifetime_value    numeric(12, 2) not null default 0
                      check (lifetime_value >= 0),
  preferred_channel text        not null default 'EMAIL'
                      check (preferred_channel in ('EMAIL', 'SMS', 'WHATSAPP', 'PHONE')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_profiles_segment on profiles (segment);
create index if not exists idx_profiles_name    on profiles (lower(name));

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- orders
-- RESTRICT on the customer FK: an order must never be orphaned by a customer
-- delete, and losing order history would silently corrupt every risk score.
-- -----------------------------------------------------------------------------
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid        not null references profiles (id) on delete restrict,
  order_number      text        not null unique,
  product_name      text        not null,
  amount            numeric(12, 2) not null check (amount >= 0),
  status            text        not null default 'PLACED'
                      check (status in ('PLACED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT',
                                        'DELAYED', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED')),
  expected_delivery timestamptz,
  current_eta       timestamptz,
  carrier           text,
  priority          text        not null default 'STANDARD'
                      check (priority in ('STANDARD', 'EXPRESS', 'PRIORITY')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_orders_customer on orders (customer_id);
create index if not exists idx_orders_status   on orders (status);
create index if not exists idx_orders_created  on orders (created_at desc);

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- incidents — operational events. A primary CRUD entity.
-- created_by is nullable so a simulator-generated incident can exist without
-- an agent, but it is set whenever a human creates one (ownership scoping).
-- -----------------------------------------------------------------------------
create table if not exists incidents (
  id           uuid primary key default gen_random_uuid(),
  type         text        not null
                 check (type in ('DELIVERY_DELAY', 'PAYMENT_FAILURE', 'INVENTORY_SHORTAGE',
                                 'ORDER_CANCELLED', 'SUBSCRIPTION_ISSUE')),
  severity     text        not null default 'MEDIUM'
                 check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title        text        not null,
  description  text,
  status       text        not null default 'OPEN'
                 check (status in ('OPEN', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'ARCHIVED')),
  started_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  created_by   uuid        references app_users (id) on delete set null,
  is_simulated boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A resolved incident must carry a resolution time, and only a resolved one may.
  constraint chk_incident_resolved_at
    check ((status = 'RESOLVED' and resolved_at is not null)
        or (status <> 'RESOLVED' and resolved_at is null))
);

create index if not exists idx_incidents_status  on incidents (status, started_at desc);
create index if not exists idx_incidents_type    on incidents (type);
create index if not exists idx_incidents_creator on incidents (created_by);

drop trigger if exists trg_incidents_updated_at on incidents;
create trigger trg_incidents_updated_at
  before update on incidents
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- customer_incidents — which customers an incident actually hurt, plus the
-- risk snapshot and the cached AI recommendation.
--
-- The cached recommendation is what keeps Gemini usage inside the free tier:
-- re-opening a customer re-reads this row instead of calling the model again.
-- -----------------------------------------------------------------------------
create table if not exists customer_incidents (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid        not null references profiles (id)  on delete cascade,
  incident_id       uuid        not null references incidents (id) on delete cascade,
  order_id          uuid        references orders (id) on delete set null,
  risk_score        integer     not null default 0 check (risk_score between 0 and 100),
  risk_level        text        not null default 'LOW'
                      check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  risk_factors      jsonb       not null default '[]'::jsonb,
  status            text        not null default 'IDENTIFIED'
                      check (status in ('IDENTIFIED', 'ANALYZED', 'RESOLVED', 'ESCALATED')),
  ai_recommendation jsonb,
  analyzed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_customer_incident unique (customer_id, incident_id)
);

create index if not exists idx_ci_incident_risk on customer_incidents (incident_id, risk_score desc);
create index if not exists idx_ci_customer     on customer_incidents (customer_id);
create index if not exists idx_ci_level        on customer_incidents (risk_level);

drop trigger if exists trg_ci_updated_at on customer_incidents;
create trigger trg_ci_updated_at
  before update on customer_incidents
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- conversations — support threads. Source of the sentiment and complaint
-- signals that feed the risk engine.
-- -----------------------------------------------------------------------------
create table if not exists conversations (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid        not null references profiles (id) on delete cascade,
  incident_id  uuid        references incidents (id) on delete set null,
  channel      text        not null default 'EMAIL'
                 check (channel in ('EMAIL', 'SMS', 'WHATSAPP', 'PHONE', 'CHAT')),
  sentiment    text        not null default 'NEUTRAL'
                 check (sentiment in ('POSITIVE', 'NEUTRAL', 'NEGATIVE')),
  summary      text,
  is_complaint boolean     not null default false,
  status       text        not null default 'OPEN'
                 check (status in ('OPEN', 'RESOLVED', 'CLOSED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_conv_customer  on conversations (customer_id, created_at desc);
create index if not exists idx_conv_sentiment on conversations (sentiment);
create index if not exists idx_conv_complaint on conversations (customer_id) where is_complaint;

drop trigger if exists trg_conv_updated_at on conversations;
create trigger trg_conv_updated_at
  before update on conversations
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- messages — CASCADE: a message has no meaning without its thread.
-- -----------------------------------------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid        not null references conversations (id) on delete cascade,
  sender          text        not null
                    check (sender in ('CUSTOMER', 'AGENT', 'AI', 'SYSTEM')),
  content         text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_messages_conversation on messages (conversation_id, created_at);


-- -----------------------------------------------------------------------------
-- knowledge_documents — the policy knowledge base.
--
-- search_vector is a GENERATED column, so retrieval needs no embeddings and
-- therefore no Gemini quota. Title is weighted 'A', category 'B', content 'C'.
-- -----------------------------------------------------------------------------
create table if not exists knowledge_documents (
  id            uuid primary key default gen_random_uuid(),
  slug          text        not null unique,
  title         text        not null,
  category      text        not null
                  check (category in ('SHIPPING', 'PREMIUM_CUSTOMER', 'REFUND', 'CANCELLATION',
                                      'PAYMENT_FAILURE', 'COMPENSATION', 'ESCALATION', 'PRIVACY')),
  version       text        not null default 'v1',
  content       text        not null,
  metadata      jsonb       not null default '{}'::jsonb,
  is_active     boolean     not null default true,
  created_by    uuid        references app_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),    'A') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')),  'C')
  ) stored
);

create index if not exists idx_kd_search   on knowledge_documents using gin (search_vector);
create index if not exists idx_kd_category on knowledge_documents (category) where is_active;
create index if not exists idx_kd_creator  on knowledge_documents (created_by);

drop trigger if exists trg_kd_updated_at on knowledge_documents;
create trigger trg_kd_updated_at
  before update on knowledge_documents
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- actions — every AI or human decision. The heart of the audit story.
--
-- approved_by is separate from created_by so separation of duties is
-- enforceable: the proposer of an action may not approve it.
-- -----------------------------------------------------------------------------
create table if not exists actions (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid        not null references profiles (id)  on delete cascade,
  incident_id       uuid        references incidents (id) on delete set null,
  action_type       text        not null
                      check (action_type in ('PRIORITY_DELIVERY', 'ISSUE_CREDIT',
                                             'PRIORITY_DELIVERY_AND_CREDIT', 'REFUND',
                                             'REPLACEMENT', 'PAYMENT_RETRY',
                                             'PAYMENT_METHOD_UPDATE', 'ACCOUNT_ADJUSTMENT',
                                             'NOTIFICATION_ONLY', 'ESCALATE_TO_HUMAN')),
  reason            text        not null,
  amount            numeric(10, 2) not null default 0 check (amount >= 0),
  requires_approval boolean     not null default false,
  status            text        not null default 'PROPOSED'
                      check (status in ('PROPOSED', 'APPROVED', 'EXECUTED',
                                        'REJECTED', 'ESCALATED', 'FAILED')),
  policy_reference  text,
  confidence        numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  ai_generated      boolean     not null default true,
  customer_message  text,
  guardrail_result  jsonb       not null default '{}'::jsonb,
  failure_reason    text,
  created_by        uuid        references app_users (id) on delete set null,
  approved_by       uuid        references app_users (id) on delete set null,
  executed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The proposer can never be the approver.
  constraint chk_action_separation_of_duties
    check (approved_by is null or created_by is null or approved_by <> created_by),

  -- Only an executed action carries an execution time.
  constraint chk_action_executed_at
    check ((status = 'EXECUTED' and executed_at is not null)
        or (status <> 'EXECUTED' and executed_at is null))
);

create index if not exists idx_actions_status   on actions (status, created_at desc);
create index if not exists idx_actions_customer on actions (customer_id, created_at desc);
create index if not exists idx_actions_incident on actions (incident_id);
create index if not exists idx_actions_creator  on actions (created_by);
-- Supports the 24h cumulative-credit guardrail lookup.
create index if not exists idx_actions_credit_window
  on actions (customer_id, created_at desc)
  where status in ('APPROVED', 'EXECUTED') and amount > 0;

drop trigger if exists trg_actions_updated_at on actions;
create trigger trg_actions_updated_at
  before update on actions
  for each row execute function set_updated_at();


-- -----------------------------------------------------------------------------
-- audit_logs — append-only. No updated_at, no update trigger, by design.
-- -----------------------------------------------------------------------------
create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_type  text        not null default 'SYSTEM'
                check (actor_type in ('USER', 'AI', 'SYSTEM')),
  actor_id    uuid,
  action      text        not null,
  entity_type text        not null,
  entity_id   uuid,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_entity  on audit_logs (entity_type, entity_id);
create index if not exists idx_audit_created on audit_logs (created_at desc);
create index if not exists idx_audit_actor   on audit_logs (actor_type, actor_id);


-- =============================================================================
-- Done. Next: run 002_rls.sql, then `cd backend && npm run seed`.
-- =============================================================================
