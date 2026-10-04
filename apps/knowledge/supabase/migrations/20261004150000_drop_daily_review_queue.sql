-- Drop the fixed per-day review queue from 20260920120000_daily_review_queue.sql
-- (issue #56). The continuous batches in 20260921100000 replaced it the next
-- day, and reviews now come from the question queue (review_queue). The tables
-- have not been written since 2026-09-20 (2 queues, 30 items), and only the
-- quiz-engine-v1 skill functions still read them or call
-- pick_daily_review_queue. Their last definitions are kept in
-- supabase/archive/daily_review_queue.sql.
--
-- get_daily_review_status and daily_review_new_card_ids stay: the Hub and the
-- dashboard's daily review panel still show the day's numbers from them.
--
-- Apply after 20261004130000_drop_quiz_engine_v1.sql. This permanently deletes
-- the rows of both tables. Run it yourself once you agree.
begin;

do $$
begin
  if to_regprocedure('public.direct_quiz_pick(text, text[], text[], integer)') is not null
    or to_regprocedure('public.direct_quiz_health()') is not null then
    raise exception 'Apply 20261004130000_drop_quiz_engine_v1.sql first: the quiz-engine-v1 functions still use the daily queue.';
  end if;
end
$$;

drop function if exists public.ensure_daily_review_queue(integer);
drop function if exists public.pick_daily_review_queue(integer);
drop table if exists public.daily_review_queue_items;
drop table if exists public.daily_review_queues;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261004150000_drop_daily_review_queue', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
