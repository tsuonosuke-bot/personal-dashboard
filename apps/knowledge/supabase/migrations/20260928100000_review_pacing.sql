-- Review pacing: faster interval growth, priority-scaled intervals and a daily
-- cap on introducing never-asked cards.
--
-- * Strong due recalls grow stability faster (q4: 2 days / x2.0, q5: 4 days / x2.8).
-- * Priority scales the scheduled interval, never the stored stability, so a
--   later priority change can be recomputed without distorting learning state.
-- * At most review_new_cards_per_day() never-asked cards enter the daily queue
--   per JST day. Held-back new cards are not counted as remaining work.
begin;

-- Keep the pre-migration schedule so the one-time priority backfill below can
-- be reverted. Drop this table once the new pacing is confirmed.
create table if not exists public.knowledge_schedule_backup_20260928 as
select id, next_review_at, next_review_on, interval_days
from public.knowledge;
alter table public.knowledge_schedule_backup_20260928 enable row level security;
revoke all on table public.knowledge_schedule_backup_20260928 from public, anon, authenticated;

alter table public.knowledge
  add column if not exists scheduled_from_at timestamptz;

comment on column public.knowledge.scheduled_from_at is
  'When next_review_at was last computed by record_answer. Priority changes reschedule from here.';

-- Early successes update last_reviewed_at without moving the schedule, so use
-- the latest schedule-updating answer when one exists.
update public.knowledge k
set scheduled_from_at = coalesce(
  (select max(q.created_at) from public.quiz_log q
    where q.knowledge_id = k.id and q.schedule_updated),
  k.last_reviewed_at
)
where k.scheduled_from_at is null and k.times_asked > 0;

create or replace function public.review_priority_factor(p_priority text)
returns numeric
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_priority
    when '最高' then 0.5
    when '高' then 1.0
    when '中' then 1.5
    when '低' then 2.0
    when '最低' then 3.0
    else 1.0
  end::numeric;
$$;

create or replace function public.review_new_cards_per_day()
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$ select 10 $$;

-- A card counts as introduced today when its first-ever answer was today (JST),
-- whether it came from the daily queue or a custom quiz.
create or replace function public.review_new_cards_remaining_today()
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with bounds as (
    select public.jst_today()::timestamp at time zone 'Asia/Tokyo' as today_start
  )
  select greatest(0, public.review_new_cards_per_day() - count(distinct q.knowledge_id))::integer
  from public.quiz_log q, bounds b
  where q.created_at >= b.today_start
    and not exists (
      select 1 from public.quiz_log earlier
      where earlier.knowledge_id = q.knowledge_id and earlier.created_at < b.today_start
    );
$$;

-- The never-asked cards allowed into today's queue: higher priority first, then
-- the oldest registration.
create or replace function public.daily_review_new_card_ids()
returns table(id uuid)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select k.id
  from public.knowledge k
  where k.archived = false
    and k.times_asked = 0
    and k.relearning_stage is null
    and k.next_review_at <= now()
  order by
    case k.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    k.created_at,
    k.id
  limit public.review_new_cards_remaining_today();
$$;

create or replace function public.record_answer(
  p_knowledge_id uuid,
  p_quality smallint,
  p_verdict text,
  p_note text default null,
  p_format text default '一問一答'
)
returns public.knowledge
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  k public.knowledge;
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Tokyo')::date;
  v_mastery text;
  v_streak smallint;
  v_stability numeric;
  v_due_hours numeric;
  v_next_at timestamptz;
  v_stage text;
  v_relearning_quality smallint;
  v_relearning_penalized boolean;
  v_in_relearning boolean;
  v_was_early boolean;
  v_schedule_updated boolean := true;
  v_ef numeric(4, 2);
  v_reps integer;
begin
  if p_quality is null or p_quality < 0 or p_quality > 5
    or p_verdict not in ('正解', '部分正解', '不正解')
    or p_format not in ('一問一答', '四択', '記述説明', '産出') then
    raise exception 'invalid answer values' using errcode = '22023';
  end if;

  select * into strict k
  from public.knowledge
  where id = p_knowledge_id and archived = false
  for update;

  v_mastery := case when k.mastery = '未学習' then '学習中' else k.mastery end;
  v_streak := k.mastery_streak;
  v_stability := k.stability_hours;
  v_stage := k.relearning_stage;
  v_relearning_quality := k.relearning_quality;
  v_relearning_penalized := k.relearning_penalized;
  v_in_relearning := k.relearning_stage is not null;
  v_was_early := k.next_review_at > v_now;
  v_ef := k.ef;
  v_reps := k.reps;

  -- A successful early/custom review is evidence, but must not move the
  -- scheduled date, grow stability or promote mastery.
  if v_was_early and p_quality >= 4 then
    v_schedule_updated := false;
  else
    v_ef := greatest(
      1.30,
      round(k.ef + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02)), 2)
    );
    v_reps := case when p_quality < 3 then 0 else k.reps + 1 end;

    if p_quality <= 3 then
      -- Apply stability loss and mastery demotion only once per lapse episode.
      if not v_relearning_penalized then
        v_stability := least(8760, greatest(0, v_stability * case p_quality
          when 0 then 0.40
          when 1 then 0.55
          when 2 then 0.70
          else 0.85
        end));
        v_streak := 0;
        if p_quality <= 2 then
          v_mastery := case v_mastery
            when '定着' then '習得中'
            when '習得中' then '学習中'
            else '学習中'
          end;
        end if;
        v_relearning_penalized := true;
      end if;

      -- Relearning steps are short and fixed; priority does not stretch them.
      v_stage := case when p_quality <= 2 then 'recognition' else 'recall' end;
      v_relearning_quality := p_quality;
      v_due_hours := case p_quality
        when 0 then 10.0 / 60
        when 1 then 30.0 / 60
        when 2 then 6
        else 12
      end;
    elsif p_format = '四択' then
      -- Recognition alone never grows stability or mastery. Confirm it later
      -- with a free-response recall.
      v_stage := 'recall';
      v_relearning_quality := null;
      v_due_hours := 24;
    elsif v_in_relearning then
      -- The first successful free recall restores the retained interval without
      -- applying another growth multiplier.
      v_stability := least(8760, greatest(
        v_stability,
        case p_quality when 4 then 24 else 72 end
      ));
      v_due_hours := least(8760, v_stability * public.review_priority_factor(k.priority));
      v_stage := null;
      v_relearning_quality := null;
      v_relearning_penalized := false;
    else
      -- Strong, due, free-response recall grows long-term stability.
      v_stability := least(8760, case p_quality
        when 4 then greatest(48, case when v_stability <= 0 then 48 else v_stability * 2.00 end)
        else greatest(96, case when v_stability <= 0 then 96 else v_stability * 2.80 end)
      end);
      v_due_hours := least(8760, v_stability * public.review_priority_factor(k.priority));
      v_streak := least(3, v_streak + 1);

      if v_mastery = '学習中' and v_streak >= 3 and v_stability >= 72 then
        v_mastery := '習得中';
        v_streak := 0;
      elsif v_mastery = '習得中' and v_streak >= 3 and v_stability >= 720 then
        v_mastery := '定着';
        v_streak := 0;
      end if;
    end if;

    v_next_at := v_now + make_interval(secs => (v_due_hours * 3600)::double precision);
  end if;

  update public.knowledge
  set
    ef = v_ef,
    reps = v_reps,
    base_interval_days = greatest(0, ceil(v_stability / 24)::integer),
    interval_days = case when v_schedule_updated
      then greatest(1, ceil(v_due_hours / 24)::integer)
      else interval_days
    end,
    mastery = v_mastery,
    mastery_streak = v_streak,
    times_asked = times_asked + 1,
    times_correct = times_correct + case when p_quality >= 3 then 1 else 0 end,
    last_asked_on = v_today,
    last_reviewed_at = v_now,
    scheduled_from_at = case when v_schedule_updated then v_now else scheduled_from_at end,
    next_review_at = case when v_schedule_updated then v_next_at else next_review_at end,
    next_review_on = case when v_schedule_updated
      then (v_next_at at time zone 'Asia/Tokyo')::date
      else next_review_on
    end,
    stability_hours = v_stability,
    relearning_stage = v_stage,
    relearning_quality = v_relearning_quality,
    relearning_penalized = v_relearning_penalized
  where id = p_knowledge_id
  returning * into k;

  insert into public.quiz_log(
    knowledge_id, asked_on, quality, verdict, format, note, was_early, schedule_updated
  ) values (
    p_knowledge_id, v_today, p_quality, p_verdict, p_format, p_note,
    v_was_early, v_schedule_updated
  );

  return k;
end
$$;

-- A priority-only edit reschedules a normally scheduled card from the moment
-- its current schedule was computed. An explicit date in the same edit wins,
-- and relearning steps keep their fixed short times.
create or replace function public.reschedule_knowledge_for_priority()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_due_hours numeric;
begin
  if new.priority is distinct from old.priority
    and new.next_review_at is not distinct from old.next_review_at
    and new.next_review_on is not distinct from old.next_review_on
    and new.relearning_stage is null
    and new.times_asked > 0
    and new.stability_hours > 0
    and new.scheduled_from_at is not null then
    v_due_hours := least(8760, new.stability_hours * public.review_priority_factor(new.priority));
    new.next_review_at := new.scheduled_from_at
      + make_interval(secs => (v_due_hours * 3600)::double precision);
    new.next_review_on := (new.next_review_at at time zone 'Asia/Tokyo')::date;
    new.interval_days := greatest(1, ceil(v_due_hours / 24)::integer);
  end if;
  return new;
end
$$;

drop trigger if exists knowledge_priority_schedule_trigger on public.knowledge;
create trigger knowledge_priority_schedule_trigger
before update of priority on public.knowledge
for each row execute function public.reschedule_knowledge_for_priority();

-- Apply priority to cards already scheduled under the old rule. Only move each
-- card in its priority's direction so legacy dates are never pulled in by a
-- lower priority or pushed out by a higher one.
update public.knowledge k
set next_review_at = case
  when public.review_priority_factor(k.priority) > 1 then greatest(k.next_review_at, s.recomputed)
  else least(k.next_review_at, s.recomputed)
end
from (
  select
    id,
    scheduled_from_at + make_interval(secs => (
      least(8760, stability_hours * public.review_priority_factor(priority)) * 3600
    )::double precision) as recomputed
  from public.knowledge
  where archived = false
    and priority <> '高'
    and relearning_stage is null
    and times_asked > 0
    and stability_hours > 0
    and scheduled_from_at is not null
) s
where k.id = s.id;

create or replace function public.pick_daily_review_queue(p_limit integer default 15)
returns table(
  id uuid,
  title text,
  explanation text,
  category text,
  mastery text,
  mastery_streak smallint,
  ef numeric,
  reps integer,
  interval_days integer,
  times_asked integer,
  next_review_on date,
  next_review_at timestamptz,
  stability_hours numeric,
  relearning_stage text,
  overdue_days integer,
  pool text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
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
$$;

-- The return type gains new_limit/new_held, so the function must be recreated.
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
  remaining_by_category jsonb,
  new_limit integer,
  new_held integer
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
  allowed_new as (
    select n.id from public.daily_review_new_card_ids() n
  ),
  classified as (
    select
      k.category,
      k.next_review_at <= now() as is_due,
      k.times_asked = 0 and k.relearning_stage is null
        and k.id not in (select a.id from allowed_new a) as is_held_new
    from public.knowledge k
    where k.archived = false
  ),
  category_counts as (
    select
      c.category,
      count(*) filter (where c.is_due and not c.is_held_new)::integer as remaining
    from classified c
    group by c.category
  ),
  counts as (
    select
      (select count(*)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed,
      (select count(distinct q.knowledge_id)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed_unique,
      (select coalesce(sum(c.remaining), 0)::integer from category_counts c) as remaining,
      (select count(*)::integer from classified c where c.is_due and c.is_held_new) as new_held,
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
    s.remaining_by_category,
    public.review_new_cards_per_day(),
    c.new_held
  from bounds b cross join counts c cross join category_summary s;
$$;

revoke all on function public.review_priority_factor(text) from public, anon, authenticated;
revoke all on function public.review_new_cards_per_day() from public, anon, authenticated;
revoke all on function public.review_new_cards_remaining_today() from public, anon, authenticated;
revoke all on function public.daily_review_new_card_ids() from public, anon, authenticated;
revoke all on function public.record_answer(uuid, smallint, text, text, text) from public, anon, authenticated;
revoke all on function public.reschedule_knowledge_for_priority() from public, anon, authenticated;
revoke all on function public.pick_daily_review_queue(integer) from public, anon, authenticated;
revoke all on function public.get_daily_review_status(integer) from public, anon, authenticated;

grant execute on function public.review_priority_factor(text) to service_role;
grant execute on function public.review_new_cards_per_day() to service_role;
grant execute on function public.review_new_cards_remaining_today() to service_role;
grant execute on function public.daily_review_new_card_ids() to service_role;
grant execute on function public.record_answer(uuid, smallint, text, text, text) to service_role;
grant execute on function public.reschedule_knowledge_for_priority() to service_role;
grant execute on function public.pick_daily_review_queue(integer) to service_role;
grant execute on function public.get_daily_review_status(integer) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20260928100000_review_pacing', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
