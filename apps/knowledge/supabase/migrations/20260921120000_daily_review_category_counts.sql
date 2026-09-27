-- Add active-category counts to the same snapshot used by the daily-review remaining total.
begin;

drop function if exists public.get_daily_review_status(integer);
create function public.get_daily_review_status(p_limit integer default 15)
returns table(
  review_on date,
  queue_limit integer,
  queue_total integer,
  completed integer,
  completed_unique integer,
  remaining integer,
  due_total integer,
  overdue_total integer,
  retry_ready integer,
  retry_waiting integer,
  next_retry_at timestamptz,
  remaining_by_category jsonb
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with bounds as (
    select
      public.jst_today() as today,
      public.jst_today()::timestamp at time zone 'Asia/Tokyo' as today_start,
      (public.jst_today() + 1)::timestamp at time zone 'Asia/Tokyo' as tomorrow_start
  ),
  category_counts as (
    select
      k.category,
      count(*) filter (where k.next_review_at <= now())::integer as remaining
    from public.knowledge k
    where k.archived = false
    group by k.category
  ),
  counts as (
    select
      (select count(*)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed,
      (select count(distinct q.knowledge_id)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed_unique,
      (select coalesce(sum(c.remaining), 0)::integer from category_counts c) as remaining,
      (select count(*)::integer from public.knowledge k, bounds b
        where k.archived = false and k.times_asked > 0 and k.next_review_at < b.today_start) as overdue_total,
      (select count(*)::integer from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at <= now()) as retry_ready,
      (select count(*)::integer from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at > now()) as retry_waiting,
      (select min(k.next_review_at) from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at > now()) as next_retry_at
  ),
  category_summary as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('category', c.category, 'count', c.remaining)
        order by c.remaining desc, c.category
      ),
      '[]'::jsonb
    ) as remaining_by_category
    from category_counts c
  )
  select
    b.today,
    greatest(1, least(coalesce(p_limit, 15), 30))::integer,
    c.completed + c.remaining,
    c.completed,
    c.completed_unique,
    c.remaining,
    c.remaining,
    c.overdue_total,
    c.retry_ready,
    c.retry_waiting,
    c.next_retry_at,
    s.remaining_by_category
  from bounds b cross join counts c cross join category_summary s;
$$;

revoke all on function public.get_daily_review_status(integer) from public, anon, authenticated;
grant execute on function public.get_daily_review_status(integer) to service_role;

commit;
