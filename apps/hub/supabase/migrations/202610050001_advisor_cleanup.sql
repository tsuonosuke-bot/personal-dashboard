-- Clears the Supabase Advisors findings from issue #60 that are safe to fix.
-- Not touched on purpose: "RLS enabled, no policy" (browsers never connect to
-- the database; only the server-side secret key does) and unused indexes.
-- Applies to the shared knowledge-db project; each statement is idempotent.
begin;

-- 1. Pin search_path on the three trigger/helper functions. Their bodies already
--    qualify every table as public.*; everything else comes from pg_catalog.
alter function public.complete_want_after_route() set search_path = '';
alter function public.ensure_scheduled_action_after_calendar_route() set search_path = '';
alter function public.next_recurring_date(date, text, integer, integer) set search_path = '';

-- 2. Extensions out of public. postgres_fdw has no foreign server or table;
--    pg_trgm has no index, column or function depending on it.
drop extension if exists postgres_fdw;
alter extension pg_trgm set schema extensions;

-- 3. Cover the foreign keys that lacked an index (quiz_log first: one row is
--    added per answer). daily_review_queue_items is left out because
--    20261004150000_drop_daily_review_queue.sql removes the table.
create index if not exists quiz_log_knowledge_id_idx on public.quiz_log (knowledge_id);
create index if not exists expenses_category_idx on public.expenses (category);
create index if not exists focus_items_source_want_id_idx on public.focus_items (source_want_id);
create index if not exists habits_source_want_id_idx on public.habits (source_want_id);
create index if not exists project_actions_project_item_id_idx on public.project_actions (project_item_id);
create index if not exists recurring_expenses_category_idx on public.recurring_expenses (category);
create index if not exists recurring_expenses_template_rule_id_idx on public.recurring_expenses (template_rule_id);
create index if not exists writing_topics_source_want_id_idx on public.writing_topics (source_want_id);

commit;
