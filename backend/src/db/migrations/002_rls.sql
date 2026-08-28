-- =============================================================================
-- ResolveAI — 002_rls.sql
-- Run SECOND, after 001_schema.sql.
--
-- READ THIS BEFORE ASSUMING RLS SECURES THE API:
--
-- The backend connects with SUPABASE_SERVICE_ROLE_KEY, which BYPASSES Row
-- Level Security by design. Nothing in this file constrains the API.
--
-- The enforced authorization is Express middleware plus the service layer:
--   - authenticate()   verifies the JWT on every protected route
--   - requireRole()    gates approve/reject and knowledge writes to SUPERVISOR+
--   - service checks   enforce created_by ownership and separation of duties
--
-- This file is DEFENCE IN DEPTH for one specific scenario: the Supabase `anon`
-- key becoming public. The frontend never uses it, but keys leak, and a leaked
-- anon key against a table with RLS disabled reads the entire database.
--
-- The posture is therefore DENY BY DEFAULT: RLS on, direct grants revoked, and
-- no permissive policy for `anon` or `authenticated`. Every table below is
-- unreachable except through the service role, which is to say through our API.
-- =============================================================================

alter table app_users           enable row level security;
alter table profiles            enable row level security;
alter table orders              enable row level security;
alter table incidents           enable row level security;
alter table customer_incidents  enable row level security;
alter table conversations       enable row level security;
alter table messages            enable row level security;
alter table knowledge_documents enable row level security;
alter table actions             enable row level security;
alter table audit_logs          enable row level security;

-- Force RLS even for the table owner, so a future non-service-role connection
-- cannot quietly sidestep it.
alter table app_users           force row level security;
alter table profiles            force row level security;
alter table orders              force row level security;
alter table incidents           force row level security;
alter table customer_incidents  force row level security;
alter table conversations       force row level security;
alter table messages            force row level security;
alter table knowledge_documents force row level security;
alter table actions             force row level security;
alter table audit_logs          force row level security;


-- -----------------------------------------------------------------------------
-- Remove the default PostgREST grants. RLS with no policy already denies, but
-- revoking the grant means a leaked key fails at the permission check, before
-- any row is considered.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_users', 'profiles', 'orders', 'incidents', 'customer_incidents',
    'conversations', 'messages', 'knowledge_documents', 'actions', 'audit_logs'
  ]
  loop
    execute format('revoke all on table public.%I from anon, authenticated;', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- Explicit deny policies.
--
-- RLS with zero policies is already a deny. These exist so the intent is
-- visible in the Supabase dashboard: a reviewer sees a stated rule rather than
-- an empty policy list they might mistake for a misconfiguration.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_users', 'profiles', 'orders', 'incidents', 'customer_incidents',
    'conversations', 'messages', 'knowledge_documents', 'actions', 'audit_logs'
  ]
  loop
    execute format('drop policy if exists deny_all_anon_%s on public.%I;', t, t);
    execute format(
      'create policy deny_all_anon_%s on public.%I
         as restrictive
         for all
         to anon, authenticated
         using (false)
         with check (false);', t, t);
  end loop;
end;
$$;


-- =============================================================================
-- Verify: this should list 10 rows, every one with rowsecurity = true.
--
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--   order by tablename;
--
-- Next: cd backend && npm run seed
-- =============================================================================
