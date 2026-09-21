-- Stable daily review queue and preview-first overdue recovery.
begin;

create table if not exists public.daily_review_queues (
  review_on date primary key,
  queue_limit integer not null check (queue_limit between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_review_queue_items (
  review_on date not null,
  knowledge_id uuid not null references public.knowledge(id) on delete cascade,
  queue_position integer not null check (queue_position > 0),
  created_at timestamptz not null default now(),
  primary key (review_on, knowledge_id),
  unique (review_on, queue_position)
);

alter table public.daily_review_queue_items enable row level security;
alter table public.daily_review_queues enable row level security;
revoke all on table public.daily_review_queues from public, anon, authenticated;
revoke all on table public.daily_review_queue_items from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_review_queues to service_role;
grant select, insert, update, delete on table public.daily_review_queue_items to service_role;

create or replace function public.ensure_daily_review_queue(p_limit integer default 15)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := public.jst_today();
begin
  if p_limit < 1 or p_limit > 30 then
    raise exception 'daily review limit must be between 1 and 30';
  end if;

  -- One creator per JST day. Once created, the queue stays stable for progress tracking.
  perform pg_advisory_xact_lock(hashtext('daily-review-queue:' || v_today::text));
  if exists (select 1 from public.daily_review_queues where review_on = v_today) then
    return;
  end if;

  insert into public.daily_review_queues (review_on, queue_limit) values (v_today, p_limit);

  insert into public.daily_review_queue_items (review_on, knowledge_id, queue_position)
  select v_today, ranked.id, ranked.queue_position
  from (
    select
      k.id,
      row_number() over (
        order by
          case
            when exists (
              select 1 from public.quiz_log q
              where q.knowledge_id = k.id and q.asked_on = v_today
            ) then 0
            when k.times_asked > 0 and (k.next_review_on is null or k.next_review_on <= v_today) then 1
            when k.times_asked = 0 then 2
            else 3
          end,
          case k.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
          greatest(v_today - coalesce(k.next_review_on, v_today), 0) desc,
          k.accuracy asc nulls first,
          k.times_asked asc,
          k.id
      )::integer as queue_position
    from public.knowledge k
    where k.archived = false
      and (
        k.mastery <> '定着'
        or exists (
          select 1 from public.quiz_log q
          where q.knowledge_id = k.id and q.asked_on = v_today
        )
      )
  ) ranked
  where ranked.queue_position <= p_limit;
end
$$;

create or replace function public.get_daily_review_status(p_limit integer default 15)
returns table(
  review_on date,
  queue_limit integer,
  queue_total integer,
  completed integer,
  remaining integer,
  due_total integer,
  overdue_total integer
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := public.jst_today();
begin
  perform public.ensure_daily_review_queue(p_limit);
  return query
  select
    v_today,
    q.queue_limit,
    count(d.knowledge_id)::integer,
    count(d.knowledge_id) filter (
      where d.knowledge_id is not null and exists (
        select 1 from public.quiz_log q
        where q.knowledge_id = d.knowledge_id and q.asked_on = v_today
      )
    )::integer,
    count(d.knowledge_id) filter (
      where d.knowledge_id is not null and not exists (
        select 1 from public.quiz_log q
        where q.knowledge_id = d.knowledge_id and q.asked_on = v_today
      )
    )::integer,
    (
      select count(*)::integer from public.knowledge k
      where k.archived = false
        and k.mastery <> '定着'
        and (k.times_asked = 0 or k.next_review_on is null or k.next_review_on <= v_today)
    ),
    (
      select count(*)::integer from public.knowledge k
      where k.archived = false
        and k.mastery <> '定着'
        and k.times_asked > 0
        and k.next_review_on < v_today
    )
  from public.daily_review_queues q
  left join public.daily_review_queue_items d on d.review_on = q.review_on
  where q.review_on = v_today
  group by q.queue_limit;
end
$$;

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
  overdue_days integer,
  pool text
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := public.jst_today();
begin
  perform public.ensure_daily_review_queue(p_limit);
  return query
  select
    k.id,
    k.title,
    k.explanation,
    k.category,
    k.mastery,
    k.mastery_streak,
    k.ef,
    k.reps,
    k.interval_days,
    k.times_asked,
    k.next_review_on,
    (v_today - coalesce(k.next_review_on, v_today))::integer,
    case
      when k.times_asked = 0 then 'B'::text
      when k.next_review_on is null or k.next_review_on <= v_today then 'A'::text
      else 'F'::text
    end
  from public.daily_review_queue_items d
  join public.knowledge k on k.id = d.knowledge_id
  where d.review_on = v_today
    and k.archived = false
    and not exists (
      select 1 from public.quiz_log q
      where q.knowledge_id = k.id and q.asked_on = v_today
    )
  order by d.queue_position;
end
$$;

create or replace function public.preview_review_recovery(p_daily_limit integer default 15)
returns table(
  knowledge_id uuid,
  title text,
  priority text,
  accuracy numeric,
  overdue_days integer,
  current_next_review_on date,
  scheduled_on date,
  queue_position integer
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := public.jst_today();
begin
  if p_daily_limit < 1 or p_daily_limit > 30 then
    raise exception 'daily review limit must be between 1 and 30';
  end if;
  perform public.ensure_daily_review_queue(p_daily_limit);

  return query
  with ranked as (
    select
      k.id,
      k.title,
      k.priority,
      k.accuracy,
      (v_today - k.next_review_on)::integer as overdue_days,
      k.next_review_on,
      row_number() over (
        order by
          case k.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
          (v_today - k.next_review_on) desc,
          k.accuracy asc nulls first,
          k.id
      )::integer as queue_position
    from public.knowledge k
    where k.archived = false
      and k.mastery <> '定着'
      and k.times_asked > 0
      and k.next_review_on < v_today
      and not exists (
        select 1 from public.daily_review_queue_items d
        where d.review_on = v_today and d.knowledge_id = k.id
      )
      and not exists (
        select 1 from public.quiz_log q
        where q.knowledge_id = k.id and q.asked_on = v_today
      )
  )
  select
    ranked.id,
    ranked.title,
    ranked.priority,
    ranked.accuracy,
    ranked.overdue_days,
    ranked.next_review_on,
    v_today + 1 + ((ranked.queue_position - 1) / p_daily_limit),
    ranked.queue_position
  from ranked
  order by ranked.queue_position;
end
$$;

create or replace function public.apply_review_recovery(p_assignments jsonb)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_expected integer;
  v_valid integer;
  v_updated integer;
  v_today date := public.jst_today();
begin
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'assignments must be an array';
  end if;
  v_expected := jsonb_array_length(p_assignments);
  if v_expected < 1 or v_expected > 5000 then
    raise exception 'assignment count must be between 1 and 5000';
  end if;

  -- Lock every target in a stable order before validating the complete preview.
  perform 1
  from public.knowledge k
  join jsonb_to_recordset(p_assignments) as a(
    knowledge_id uuid,
    current_next_review_on date,
    scheduled_on date
  ) on a.knowledge_id = k.id
  order by k.id
  for update;

  select count(*)::integer into v_valid
  from public.knowledge k
  join jsonb_to_recordset(p_assignments) as a(
    knowledge_id uuid,
    current_next_review_on date,
    scheduled_on date
  ) on a.knowledge_id = k.id
  where k.archived = false
    and k.mastery <> '定着'
    and k.next_review_on = a.current_next_review_on
    and k.next_review_on < v_today
    and a.scheduled_on > v_today;

  if v_valid <> v_expected then
    raise exception 'recovery preview is stale';
  end if;

  update public.knowledge k
  set next_review_on = a.scheduled_on
  from jsonb_to_recordset(p_assignments) as a(
    knowledge_id uuid,
    current_next_review_on date,
    scheduled_on date
  )
  where k.id = a.knowledge_id;
  get diagnostics v_updated = row_count;
  return v_updated;
end
$$;

revoke all on function public.ensure_daily_review_queue(integer) from public, anon, authenticated;
revoke all on function public.get_daily_review_status(integer) from public, anon, authenticated;
revoke all on function public.pick_daily_review_queue(integer) from public, anon, authenticated;
revoke all on function public.preview_review_recovery(integer) from public, anon, authenticated;
revoke all on function public.apply_review_recovery(jsonb) from public, anon, authenticated;
grant execute on function public.ensure_daily_review_queue(integer) to service_role;
grant execute on function public.get_daily_review_status(integer) to service_role;
grant execute on function public.pick_daily_review_queue(integer) to service_role;
grant execute on function public.preview_review_recovery(integer) to service_role;
grant execute on function public.apply_review_recovery(jsonb) to service_role;

commit;
