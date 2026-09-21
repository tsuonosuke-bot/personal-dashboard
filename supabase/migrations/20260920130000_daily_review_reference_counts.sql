-- Align daily-review reference totals and recovery with the dashboard's canonical date rules.
begin;

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
      where k.archived = false and k.next_review_on <= v_today
    ),
    (
      select count(*)::integer from public.knowledge k
      where k.archived = false and k.next_review_on < v_today
    )
  from public.daily_review_queues q
  left join public.daily_review_queue_items d on d.review_on = q.review_on
  where q.review_on = v_today
  group by q.queue_limit;
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

commit;
