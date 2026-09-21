-- Adaptive, continuous review scheduling.
-- The database is authoritative for selection, scheduling and mastery changes.
-- The dashboard limit is a batch size, never a daily ceiling.
begin;

alter table public.knowledge
  add column if not exists next_review_at timestamptz,
  add column if not exists stability_hours numeric(10, 2) not null default 0,
  add column if not exists relearning_stage text,
  add column if not exists relearning_quality smallint,
  add column if not exists relearning_penalized boolean not null default false,
  add column if not exists last_reviewed_at timestamptz;

alter table public.quiz_log
  add column if not exists attempt_id text,
  add column if not exists was_early boolean not null default false,
  add column if not exists schedule_updated boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge'::regclass
      and conname = 'knowledge_stability_hours_range'
  ) then
    alter table public.knowledge
      add constraint knowledge_stability_hours_range
      check (stability_hours between 0 and 8760);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge'::regclass
      and conname = 'knowledge_relearning_state_consistent'
  ) then
    alter table public.knowledge
      add constraint knowledge_relearning_state_consistent check (
        (relearning_stage is null and relearning_quality is null and relearning_penalized = false)
        or (
          relearning_stage in ('recognition', 'recall')
          and (relearning_quality is null or relearning_quality between 0 and 3)
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_log'::regclass
      and conname = 'quiz_log_attempt_id_format'
  ) then
    alter table public.quiz_log
      add constraint quiz_log_attempt_id_format check (
        attempt_id is null or attempt_id ~ '^[A-Za-z0-9_-]{20,64}$'
      );
  end if;
end
$$;

create unique index if not exists quiz_log_attempt_id_unique
  on public.quiz_log(attempt_id)
  where attempt_id is not null;

-- Preserve the strongest signal available in the legacy day-based columns.
update public.knowledge
set stability_hours = least(
  8760,
  case
    when stability_hours > 0 then stability_hours
    when mastery = '定着' then greatest(coalesce(base_interval_days, 0), coalesce(interval_days, 0), 90) * 24
    when mastery = '習得中' then greatest(coalesce(base_interval_days, 0), coalesce(interval_days, 0), 14) * 24
    when times_asked > 0 then greatest(coalesce(base_interval_days, 0), coalesce(interval_days, 0), 1) * 24
    else 0
  end
);

-- Convert legacy JST dates to exact timestamps. Previously settled cards had no
-- next date, so bring them back on a conservative 90-day cadence.
update public.knowledge
set next_review_at = case
  when next_review_at is not null then next_review_at
  when next_review_on is not null then next_review_on::timestamp at time zone 'Asia/Tokyo'
  when mastery = '定着' and last_asked_on is not null
    then (last_asked_on + 90)::timestamp at time zone 'Asia/Tokyo'
  when times_asked = 0
    then coalesce(learned_on, public.jst_today())::timestamp at time zone 'Asia/Tokyo'
  else now()
end;

update public.knowledge
set
  next_review_on = (next_review_at at time zone 'Asia/Tokyo')::date,
  last_reviewed_at = coalesce(
    last_reviewed_at,
    case when last_asked_on is null then null
      else last_asked_on::timestamp at time zone 'Asia/Tokyo'
    end
  );

alter table public.knowledge
  alter column next_review_at set default now(),
  alter column next_review_at set not null;

-- Priority changes selection order only. They no longer rewrite a due date.
drop trigger if exists knowledge_priority_schedule_trigger on public.knowledge;

create or replace function public.sync_knowledge_review_timestamp()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    if new.next_review_on is not null then
      new.next_review_at := new.next_review_on::timestamp at time zone 'Asia/Tokyo';
    elsif new.next_review_at is null then
      new.next_review_at := now();
    end if;
  elsif new.next_review_on is distinct from old.next_review_on
    and new.next_review_at is not distinct from old.next_review_at then
    new.next_review_at := case
      when new.next_review_on is null then now()
      else new.next_review_on::timestamp at time zone 'Asia/Tokyo'
    end;
  end if;

  new.next_review_on := (new.next_review_at at time zone 'Asia/Tokyo')::date;
  return new;
end
$$;

drop trigger if exists knowledge_review_timestamp_trigger on public.knowledge;
create trigger knowledge_review_timestamp_trigger
before insert or update of next_review_on, next_review_at on public.knowledge
for each row execute function public.sync_knowledge_review_timestamp();

-- Legacy helper remains callable, but timing is no longer modified by priority.
create or replace function public.reschedule_knowledge_for_priority()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  return new;
end
$$;

drop function if exists public.pick_quiz(text[], text[], integer, boolean);
create function public.pick_quiz(
  p_include text[] default null,
  p_exclude text[] default null,
  p_limit integer default 5,
  p_include_mastered boolean default false
)
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
  with base as (
    select
      k.*,
      greatest(0, floor(extract(epoch from (now() - k.next_review_at)) / 86400))::integer as overdue_days,
      case
        when k.next_review_at > now() then 'F'::text
        when k.relearning_stage is not null then 'R'::text
        when k.times_asked = 0 then 'B'::text
        else 'A'::text
      end as pool
    from public.knowledge k
    where k.archived = false
      and (p_include is null or k.category = any(p_include))
      and (p_exclude is null or not (k.category = any(p_exclude)))
      and (
        k.category is distinct from '気づき'
        or (p_include is not null and '気づき' = any(p_include))
      )
      -- Settled cards remain eligible when due. The legacy flag controls only
      -- whether a future settled card may be used to fill a custom quiz.
      and (p_include_mastered or k.mastery <> '定着' or k.next_review_at <= now())
  )
  select
    base.id,
    base.title,
    base.explanation,
    base.category,
    base.mastery,
    base.mastery_streak,
    base.ef,
    base.reps,
    base.interval_days,
    base.times_asked,
    base.next_review_on,
    base.next_review_at,
    base.stability_hours,
    base.relearning_stage,
    base.overdue_days,
    base.pool
  from base
  order by
    case base.pool when 'R' then 0 when 'A' then 1 when 'B' then 2 else 3 end,
    case when base.pool = 'R' then base.relearning_quality else 4 end asc nulls last,
    case base.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    case when base.pool in ('R', 'A') then base.next_review_at end asc nulls last,
    base.accuracy asc nulls first,
    base.times_asked,
    base.id
  limit greatest(1, least(coalesce(p_limit, 5), 30));
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
      v_due_hours := v_stability;
      v_stage := null;
      v_relearning_quality := null;
      v_relearning_penalized := false;
    else
      -- Strong, due, free-response recall grows long-term stability.
      v_stability := least(8760, case p_quality
        when 4 then greatest(24, case when v_stability <= 0 then 24 else v_stability * 1.40 end)
        else greatest(72, case when v_stability <= 0 then 72 else v_stability * 1.80 end)
      end);
      v_due_hours := v_stability;
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

drop function if exists public.record_answers_batch_once(jsonb);
create function public.record_answers_batch_once(p_answers jsonb)
returns table(
  id uuid,
  next_review_on date,
  next_review_at timestamptz,
  stability_hours numeric,
  relearning_stage text,
  recorded boolean,
  schedule_updated boolean
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  answer record;
  current_knowledge public.knowledge;
  latest_log_id bigint;
  latest_schedule_updated boolean;
begin
  if jsonb_typeof(p_answers) is distinct from 'array'
    or jsonb_array_length(p_answers) < 1
    or jsonb_array_length(p_answers) > 30 then
    raise exception 'p_answers must contain an array of 1 to 30 items' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct parsed.id)
    from jsonb_to_recordset(p_answers) as parsed(id uuid)
  ) then
    raise exception 'p_answers contains duplicate ids' using errcode = '22023';
  end if;

  for answer in
    select parsed.id, parsed.quality, parsed.verdict, parsed.note, parsed.format, parsed.attempt_id
    from jsonb_to_recordset(p_answers) as parsed(
      id uuid,
      quality smallint,
      verdict text,
      note text,
      format text,
      attempt_id text
    )
    order by parsed.id
  loop
    if answer.id is null
      or answer.quality is null or answer.quality < 0 or answer.quality > 5
      or answer.verdict is null or answer.verdict not in ('正解', '部分正解', '不正解')
      or answer.format is null or answer.format not in ('一問一答', '四択', '記述説明', '産出')
      or (answer.attempt_id is not null and answer.attempt_id !~ '^[A-Za-z0-9_-]{20,64}$') then
      raise exception 'invalid answer values' using errcode = '22023';
    end if;

    select k.* into current_knowledge
    from public.knowledge k
    where k.id = answer.id and k.archived = false
    for update;

    if not found then
      raise exception 'active knowledge % was not found', answer.id using errcode = 'P0002';
    end if;

    if answer.attempt_id is not null and exists (
      select 1 from public.quiz_log q where q.attempt_id = answer.attempt_id
    ) then
      select q.schedule_updated into latest_schedule_updated
      from public.quiz_log q where q.attempt_id = answer.attempt_id;
      id := current_knowledge.id;
      next_review_on := current_knowledge.next_review_on;
      next_review_at := current_knowledge.next_review_at;
      stability_hours := current_knowledge.stability_hours;
      relearning_stage := current_knowledge.relearning_stage;
      recorded := false;
      schedule_updated := latest_schedule_updated;
      return next;
      continue;
    end if;

    current_knowledge := public.record_answer(
      answer.id, answer.quality, answer.verdict, answer.note, answer.format
    );

    select q.id, q.schedule_updated
    into strict latest_log_id, latest_schedule_updated
    from public.quiz_log q
    where q.knowledge_id = answer.id
    order by q.id desc
    limit 1;

    if answer.attempt_id is not null then
      update public.quiz_log q
      set attempt_id = answer.attempt_id
      where q.id = latest_log_id;
    end if;

    id := current_knowledge.id;
    next_review_on := current_knowledge.next_review_on;
    next_review_at := current_knowledge.next_review_at;
    stability_hours := current_knowledge.stability_hours;
    relearning_stage := current_knowledge.relearning_stage;
    recorded := true;
    schedule_updated := latest_schedule_updated;
    return next;
  end loop;
end
$$;

create or replace function public.record_answers_batch(p_answers jsonb)
returns setof public.knowledge
language sql
set search_path to 'public', 'pg_temp'
as $$
  select recorded.*
  from jsonb_to_recordset(p_answers) as answer(
    id uuid,
    quality smallint,
    verdict text,
    note text,
    format text
  )
  cross join lateral public.record_answer(
    answer.id, answer.quality, answer.verdict, answer.note, answer.format
  ) as recorded;
$$;

drop function if exists public.pick_daily_review_queue(integer);
create function public.pick_daily_review_queue(p_limit integer default 15)
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
  next_retry_at timestamptz
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
  counts as (
    select
      (select count(*)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed,
      (select count(distinct q.knowledge_id)::integer from public.quiz_log q, bounds b
        where q.created_at >= b.today_start and q.created_at < b.tomorrow_start) as completed_unique,
      (select count(*)::integer from public.knowledge k
        where k.archived = false and k.next_review_at <= now()) as remaining,
      (select count(*)::integer from public.knowledge k, bounds b
        where k.archived = false and k.times_asked > 0 and k.next_review_at < b.today_start) as overdue_total,
      (select count(*)::integer from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at <= now()) as retry_ready,
      (select count(*)::integer from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at > now()) as retry_waiting,
      (select min(k.next_review_at) from public.knowledge k
        where k.archived = false and k.relearning_stage is not null and k.next_review_at > now()) as next_retry_at
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
    c.next_retry_at
  from bounds b cross join counts c;
$$;

-- The old fixed-queue creator is retained as a harmless compatibility no-op.
create or replace function public.ensure_daily_review_queue(p_limit integer default 15)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_limit < 1 or p_limit > 30 then
    raise exception 'daily review limit must be between 1 and 30';
  end if;
end
$$;

revoke all on function public.sync_knowledge_review_timestamp() from public, anon, authenticated;
revoke all on function public.reschedule_knowledge_for_priority() from public, anon, authenticated;
revoke all on function public.pick_quiz(text[], text[], integer, boolean) from public, anon, authenticated;
revoke all on function public.record_answer(uuid, smallint, text, text, text) from public, anon, authenticated;
revoke all on function public.record_answers_batch_once(jsonb) from public, anon, authenticated;
revoke all on function public.record_answers_batch(jsonb) from public, anon, authenticated;
revoke all on function public.pick_daily_review_queue(integer) from public, anon, authenticated;
revoke all on function public.get_daily_review_status(integer) from public, anon, authenticated;
revoke all on function public.ensure_daily_review_queue(integer) from public, anon, authenticated;

grant execute on function public.sync_knowledge_review_timestamp() to service_role;
grant execute on function public.reschedule_knowledge_for_priority() to service_role;
grant execute on function public.pick_quiz(text[], text[], integer, boolean) to service_role;
grant execute on function public.record_answer(uuid, smallint, text, text, text) to service_role;
grant execute on function public.record_answers_batch_once(jsonb) to service_role;
grant execute on function public.record_answers_batch(jsonb) to service_role;
grant execute on function public.pick_daily_review_queue(integer) to service_role;
grant execute on function public.get_daily_review_status(integer) to service_role;
grant execute on function public.ensure_daily_review_queue(integer) to service_role;

commit;
