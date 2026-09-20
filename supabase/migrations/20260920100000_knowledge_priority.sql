-- Per-knowledge review priority and priority-aware spaced repetition.
-- Existing knowledge keeps the current cadence, which is classified as high.
begin;

alter table public.knowledge
  add column if not exists priority text not null default '高',
  add column if not exists base_interval_days integer not null default 0;

update public.knowledge
set base_interval_days = greatest(coalesce(interval_days, 0), 0)
where base_interval_days = 0 and coalesce(interval_days, 0) > 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge'::regclass
      and conname = 'knowledge_priority_allowed'
  ) then
    alter table public.knowledge
      add constraint knowledge_priority_allowed check (priority in ('最高', '高', '中', '低', '最低'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge'::regclass
      and conname = 'knowledge_base_interval_nonnegative'
  ) then
    alter table public.knowledge
      add constraint knowledge_base_interval_nonnegative check (base_interval_days >= 0);
  end if;
end
$$;

create or replace function public.review_interval_for_priority(
  p_base_interval integer,
  p_priority text
)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_base_interval, 0) <= 0 then 0
    else least(
      365,
      greatest(
        1,
        round(
          p_base_interval * case p_priority
            when '最高' then 0.5
            when '高' then 1.0
            when '中' then 1.5
            when '低' then 2.0
            when '最低' then 3.0
            else 1.0
          end
        )::integer
      )
    )
  end;
$$;

-- A priority-only edit immediately recalculates an already scheduled review.
-- If the caller also changes next_review_on, that explicit date wins.
create or replace function public.reschedule_knowledge_for_priority()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.priority is distinct from old.priority
    and new.next_review_on is not distinct from old.next_review_on
    and new.last_asked_on is not null
    and new.next_review_on is not null
    and new.base_interval_days > 0 then
    new.interval_days := public.review_interval_for_priority(new.base_interval_days, new.priority);
    new.next_review_on := new.last_asked_on + new.interval_days;
  end if;
  return new;
end
$$;

drop trigger if exists knowledge_priority_schedule_trigger on public.knowledge;
create trigger knowledge_priority_schedule_trigger
before update of priority on public.knowledge
for each row execute function public.reschedule_knowledge_for_priority();

-- Priority is user-visible content and participates in optimistic concurrency.
drop trigger if exists knowledge_content_version_trigger on public.knowledge;
create trigger knowledge_content_version_trigger
before update of title, explanation, source_note, category, mastery, priority, tags, next_review_on, archived
on public.knowledge
for each row execute function public.bump_knowledge_content_version();

create or replace function public.pick_quiz(
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
      (public.jst_today() - coalesce(k.next_review_on, public.jst_today()))::int as overdue_days
    from public.knowledge k
    where k.archived = false
      and (p_include is null or k.category = any(p_include))
      and (p_exclude is null or not (k.category = any(p_exclude)))
      and (
        k.category is distinct from '気づき'
        or (p_include is not null and '気づき' = any(p_include))
      )
      and (p_include_mastered or k.mastery <> '定着')
      and not exists (
        select 1 from public.quiz_log q
        where q.knowledge_id = k.id and q.asked_on = public.jst_today()
      )
  ),
  b as (
    select base.*, 'B'::text as pool
    from base
    where base.times_asked = 0
    order by
      case base.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
      base.learned_on,
      base.title
    limit 2
  ),
  a as (
    select base.*, 'A'::text as pool
    from base
    where base.times_asked > 0
      and (base.next_review_on is null or base.next_review_on <= public.jst_today())
    order by
      case base.mastery when '学習中' then 0 when '習得中' then 1 else 2 end,
      case when base.mastery = '学習中' then -base.overdue_days else base.overdue_days end,
      case base.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
      base.times_asked
    limit p_limit
  ),
  f as (
    select base.*, 'F'::text as pool
    from base
    where base.times_asked > 0 and base.next_review_on > public.jst_today()
    order by
      base.next_review_on,
      case base.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end
    limit p_limit
  ),
  merged as (
    select * from b
    union all select * from a
    union all select * from f
  ),
  uniq as (
    select distinct on (merged.id) merged.*
    from merged
    order by merged.id, case merged.pool when 'B' then 1 when 'A' then 2 else 3 end
  )
  select
    uniq.id,
    uniq.title,
    uniq.explanation,
    uniq.category,
    uniq.mastery,
    uniq.mastery_streak,
    uniq.ef,
    uniq.reps,
    uniq.interval_days,
    uniq.times_asked,
    uniq.next_review_on,
    uniq.overdue_days,
    uniq.pool
  from uniq
  order by
    case uniq.pool when 'B' then 1 when 'A' then 2 else 3 end,
    case uniq.mastery when '学習中' then 0 when '習得中' then 1 else 2 end,
    case when uniq.mastery = '学習中' then -uniq.overdue_days else uniq.overdue_days end,
    case uniq.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    uniq.times_asked
  limit p_limit;
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
  v_ef numeric(4,2);
  v_reps integer;
  v_base_interval integer;
  v_interval integer;
  v_next date;
  v_today date := public.jst_today();
  v_elapsed integer;
  v_overdue boolean;
  v_mastery text;
  v_streak smallint;
  v_recent_ok boolean;
  ladder constant integer[] := array[14,30,90];
begin
  select * into strict k
  from public.knowledge
  where id = p_knowledge_id
  for update;

  v_mastery := k.mastery;
  v_streak := k.mastery_streak;
  v_elapsed := least(
    coalesce(v_today - k.last_asked_on, k.interval_days),
    greatest(k.interval_days, 1) * 3
  );
  v_overdue := k.next_review_on is not null
    and (v_today - k.next_review_on) > greatest(k.interval_days, 1);

  if p_quality < 3 and v_overdue then
    v_ef := k.ef;
  else
    v_ef := greatest(
      1.30,
      round(k.ef + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02)), 2)
    );
  end if;

  if p_quality < 3 then
    v_reps := 0;
    v_base_interval := 1;
  else
    v_reps := k.reps + 1;
    if v_reps = 1 then
      v_base_interval := 1;
    elsif v_reps = 2 then
      v_base_interval := 6;
    else
      v_base_interval := least(
        365,
        greatest(
          1,
          round(
            (
              coalesce(nullif(k.base_interval_days, 0), greatest(k.interval_days, 1))
              + greatest(0, v_elapsed - k.interval_days) * 0.5
            ) * v_ef
          )::int
        )
      );
    end if;
  end if;
  v_interval := public.review_interval_for_priority(v_base_interval, k.priority);
  v_next := v_today + v_interval;

  if v_mastery in ('未学習', '学習中') then
    v_mastery := '学習中';
    v_streak := 0;
    if p_quality >= 4 then
      select count(*) = 3 into v_recent_ok
      from (
        select q.quality
        from public.quiz_log q
        where q.knowledge_id = p_knowledge_id
        order by q.asked_on desc, q.id desc
        limit 3
      ) recent
      where recent.quality >= 4;
      if v_recent_ok then
        v_mastery := '習得中';
        v_base_interval := ladder[1];
        v_interval := public.review_interval_for_priority(v_base_interval, k.priority);
        v_next := v_today + v_interval;
      end if;
    end if;
  elsif v_mastery = '習得中' then
    if p_quality <= 2 and not v_overdue then
      v_mastery := '学習中';
      v_streak := 0;
      v_reps := 0;
      v_base_interval := 1;
    elsif p_quality <= 2 then
      v_streak := 0;
      v_base_interval := ladder[1];
    elsif p_quality = 3 then
      v_base_interval := ladder[least(v_streak, 2) + 1];
    else
      v_streak := v_streak + 1;
      if v_streak >= 3 then
        v_mastery := '定着';
        v_base_interval := 0;
        v_interval := 0;
        v_next := null;
      else
        v_base_interval := ladder[v_streak + 1];
      end if;
    end if;
    if v_mastery <> '定着' then
      v_interval := public.review_interval_for_priority(v_base_interval, k.priority);
      v_next := v_today + v_interval;
    end if;
  elsif v_mastery = '定着' then
    if p_quality <= 3 then
      v_mastery := '学習中';
      v_streak := 0;
      v_reps := 0;
      v_base_interval := 1;
      v_interval := public.review_interval_for_priority(v_base_interval, k.priority);
      v_next := v_today + v_interval;
    else
      v_base_interval := 0;
      v_interval := 0;
      v_next := null;
    end if;
  end if;

  update public.knowledge
  set
    ef = v_ef,
    reps = v_reps,
    base_interval_days = v_base_interval,
    interval_days = v_interval,
    mastery = v_mastery,
    mastery_streak = v_streak,
    times_asked = times_asked + 1,
    times_correct = times_correct + (case when p_quality >= 3 then 1 else 0 end),
    last_asked_on = v_today,
    next_review_on = v_next
  where id = p_knowledge_id
  returning * into k;

  insert into public.quiz_log(knowledge_id, asked_on, quality, verdict, format, note)
  values (p_knowledge_id, v_today, p_quality, p_verdict, p_format, p_note);
  return k;
end
$$;

revoke all on function public.review_interval_for_priority(integer, text) from public, anon, authenticated;
grant execute on function public.review_interval_for_priority(integer, text) to service_role;
revoke all on function public.reschedule_knowledge_for_priority() from public, anon, authenticated;
grant execute on function public.reschedule_knowledge_for_priority() to service_role;
revoke all on function public.pick_quiz(text[], text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.pick_quiz(text[], text[], integer, boolean) to service_role;
revoke all on function public.record_answer(uuid, smallint, text, text, text) from public, anon, authenticated;
grant execute on function public.record_answer(uuid, smallint, text, text, text) to service_role;

commit;
