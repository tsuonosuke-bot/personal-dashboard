-- review_new_cards_remaining_today() computed today's start inside a CTE that PostgreSQL inlined,
-- so jst_today() (a SQL function with SET search_path, which cannot itself be inlined) ran once
-- per quiz_log row, twice per call. With ~2,700 rows that cost ~17 ms per call, and the function
-- runs inside get_daily_review_status (via daily_review_new_card_ids) and the queue refill.
-- MATERIALIZED evaluates the bounds once. The result is unchanged.
begin;

create or replace function public.review_new_cards_remaining_today()
 returns integer
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with bounds as materialized (
    select public.jst_today()::timestamp at time zone 'Asia/Tokyo' as today_start
  )
  select greatest(0, public.review_new_cards_per_day() - count(distinct q.knowledge_id))::integer
  from public.quiz_log q, bounds b
  where q.created_at >= b.today_start
    and not exists (
      select 1 from public.quiz_log earlier
      where earlier.knowledge_id = q.knowledge_id and earlier.created_at < b.today_start
    );
$function$;

commit;
