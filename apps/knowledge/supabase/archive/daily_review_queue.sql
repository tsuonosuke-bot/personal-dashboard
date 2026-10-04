-- The fixed per-day review queue as it was in production on 2026-10-04, kept
-- for reference after migrations/20261004150000_drop_daily_review_queue.sql
-- removed it. The tables were created by
-- migrations/20260920120000_daily_review_queue.sql; the functions are their
-- last definitions (ensure_daily_review_queue had become a no-op check, and
-- pick_daily_review_queue no longer read the tables).
--
-- Do not apply this file as is: nothing uses these objects any more. The review
-- screen serves from review_queue (serve_review_queue), which keeps the same
-- batch order and the five slots for normal due cards.

create table public.daily_review_queues (
  review_on date not null primary key,
  queue_limit integer not null check (queue_limit >= 1 and queue_limit <= 30),
  created_at timestamp with time zone not null default now()
);

create table public.daily_review_queue_items (
  review_on date not null,
  knowledge_id uuid not null references public.knowledge(id) on delete cascade,
  queue_position integer not null check (queue_position > 0),
  created_at timestamp with time zone not null default now(),
  primary key (review_on, knowledge_id),
  unique (review_on, queue_position)
);

CREATE OR REPLACE FUNCTION public.ensure_daily_review_queue(p_limit integer DEFAULT 15)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_limit < 1 or p_limit > 30 then
    raise exception 'daily review limit must be between 1 and 30';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.pick_daily_review_queue(p_limit integer DEFAULT 15)
 RETURNS TABLE(id uuid, title text, explanation text, category text, mastery text, mastery_streak smallint, ef numeric, reps integer, interval_days integer, times_asked integer, next_review_on date, next_review_at timestamp with time zone, stability_hours numeric, relearning_stage text, overdue_days integer, pool text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with params as (
    select greatest(1, least(coalesce(p_limit, 15), 30))::integer as batch_limit
  ),
  allowed_new as (
    select n.id from public.daily_review_new_card_ids() n
  ),
  eligible as (
    select
      k.*,
      greatest(0, floor(extract(epoch from (now() - k.next_review_at)) / 86400))::integer as overdue_days,
      case
        when k.relearning_stage is not null then 'R'::text
        when k.times_asked = 0 then 'B'::text
        else 'A'::text
      end as pool
    from public.knowledge k
    where k.archived = false and k.next_review_at <= now()
      and (
        k.times_asked > 0
        or k.relearning_stage is not null
        or k.id in (select a.id from allowed_new a)
      )
  ),
  counts as (
    select count(*) filter (where pool <> 'R')::integer as normal_count
    from eligible
  ),
  retry_ranked as (
    select e.*, row_number() over (
      order by
        e.relearning_quality asc nulls last,
        case e.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
        e.accuracy asc nulls first,
        e.next_review_at,
        e.id
    ) as rank_no
    from eligible e
    where e.pool = 'R'
  ),
  retry_selected as (
    select r.*
    from retry_ranked r cross join counts c cross join params p
    where r.rank_no <= p.batch_limit - least(5, c.normal_count, p.batch_limit)
  ),
  normal_ranked as (
    select e.*, row_number() over (
      order by
        case e.pool when 'A' then 0 else 1 end,
        case e.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
        e.next_review_at,
        e.accuracy asc nulls first,
        e.times_asked,
        e.id
    ) as rank_no
    from eligible e
    where e.pool <> 'R'
  ),
  normal_selected as (
    select n.*
    from normal_ranked n cross join params p
    where n.rank_no <= p.batch_limit - (select count(*) from retry_selected)
  ),
  selected as (
    select * from retry_selected
    union all
    select * from normal_selected
  )
  select
    s.id,
    s.title,
    s.explanation,
    s.category,
    s.mastery,
    s.mastery_streak,
    s.ef,
    s.reps,
    s.interval_days,
    s.times_asked,
    s.next_review_on,
    s.next_review_at,
    s.stability_hours,
    s.relearning_stage,
    s.overdue_days,
    s.pool
  from selected s
  order by
    case s.pool when 'R' then 0 when 'A' then 1 else 2 end,
    case when s.pool = 'R' then s.relearning_quality else 4 end asc nulls last,
    case s.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    s.next_review_at,
    s.id;
$function$;
