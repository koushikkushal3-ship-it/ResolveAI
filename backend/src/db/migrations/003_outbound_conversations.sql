-- =============================================================================
-- ResolveAI — 003_outbound_conversations.sql
-- Run AFTER 001 and 002. Safe to re-run.
--
-- Why this exists:
--
-- Executing an action sends the customer a proactive message, which is stored
-- as a conversation so it appears in their timeline. But conversations are also
-- the source of the `latest sentiment` signal feeding the risk engine — and an
-- outbound message is written with sentiment NEUTRAL.
--
-- The result: resolving a HIGH-risk customer silently LOWERED their risk score,
-- because our own outreach became their most recent sentiment. Priya Sharma
-- dropped from 91 to 81 the moment she was helped.
--
-- A message the business sends is not evidence of how the customer feels, so
-- outbound conversations are now marked and excluded from the sentiment signal.
-- =============================================================================

alter table conversations
  add column if not exists is_outbound boolean not null default false;

-- Sentiment lookups read the newest inbound thread per customer.
create index if not exists idx_conv_inbound_recent
  on conversations (customer_id, created_at desc)
  where not is_outbound;

-- Backfill any outreach rows written before this column existed.
update conversations
   set is_outbound = true
 where is_outbound = false
   and summary like 'Proactive outreach:%';

-- Verify: should return only rows whose summary is proactive outreach.
--   select id, summary, sentiment from conversations where is_outbound;
-- =============================================================================
