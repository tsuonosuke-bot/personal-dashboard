-- Priority now stretches every interval, not only the q4/q5 ones. The fixed relearning steps
-- (q0=10分・q1=30分・q2=6時間・q3=12時間) and the 24h free-recall check after a correct 四択 are
-- multiplied by review_priority_factor too (最高0.5・高1・中1.5・低2・最低3倍). Stability itself is still
-- never multiplied. A priority-only edit now also reschedules a card that is in relearning.
begin;

-- The base hours of a relearning step. null is the free-recall check after a correct 四択.
create or replace function public.review_relearning_step_hours(p_quality smallint)
returns numeric
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_quality
    when 0 then 10.0 / 60
    when 1 then 30.0 / 60
    when 2 then 6
    when 3 then 12
    else 24
  end::numeric;
$$;

create or replace function public.record_answer(
  p_knowledge_id uuid,
  p_quality smallint,
  p_verdict text,
  p_note text default null,
  p_format text default '一問一答',
  p_answered_at timestamptz default null
)
returns public.knowledge
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  k public.knowledge;
  -- 採点を後から行う回答は、回答した時刻を予定の起点にする。未来の時刻は受け付けない。
  v_now timestamptz := least(coalesce(p_answered_at, clock_timestamp()), clock_timestamp());
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

      -- Relearning steps are short and fixed, then stretched by priority like every other interval.
      v_stage := case when p_quality <= 2 then 'recognition' else 'recall' end;
      v_relearning_quality := p_quality;
      v_due_hours := public.review_relearning_step_hours(p_quality)
        * public.review_priority_factor(k.priority);
    elsif p_format = '四択' then
      -- Recognition alone never grows stability or mastery. Confirm it later
      -- with a free-response recall.
      v_stage := 'recall';
      v_relearning_quality := null;
      v_due_hours := public.review_relearning_step_hours(null)
        * public.review_priority_factor(k.priority);
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
    knowledge_id, asked_on, quality, verdict, format, note, was_early, schedule_updated, created_at
  ) values (
    p_knowledge_id, v_today, p_quality, p_verdict, p_format, p_note,
    v_was_early, v_schedule_updated, v_now
  );

  return k;
end
$$;

-- A priority-only edit reschedules the card from the moment its current schedule was computed.
-- Cards in relearning use the step for their last relearning answer.
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
    and new.times_asked > 0
    and new.scheduled_from_at is not null
    and (new.relearning_stage is not null or new.stability_hours > 0) then
    v_due_hours := least(8760, case
      when new.relearning_stage is not null
        then public.review_relearning_step_hours(new.relearning_quality)
      else new.stability_hours
    end * public.review_priority_factor(new.priority));
    new.next_review_at := new.scheduled_from_at
      + make_interval(secs => (v_due_hours * 3600)::double precision);
    new.next_review_on := (new.next_review_at at time zone 'Asia/Tokyo')::date;
    new.interval_days := greatest(1, ceil(v_due_hours / 24)::integer);
  end if;
  return new;
end
$$;

-- Cards already waiting in relearning move to the new rule. Cards that are already due stay due.
update public.knowledge k
set next_review_at = s.recomputed,
    next_review_on = (s.recomputed at time zone 'Asia/Tokyo')::date
from (
  select
    id,
    scheduled_from_at + make_interval(secs => (
      public.review_relearning_step_hours(relearning_quality)
        * public.review_priority_factor(priority) * 3600
    )::double precision) as recomputed
  from public.knowledge
  where archived = false
    and relearning_stage is not null
    and scheduled_from_at is not null
    and next_review_at > now()
) s
where k.id = s.id
  and k.next_review_at is distinct from s.recomputed;

revoke all on function public.review_relearning_step_hours(smallint) from public, anon, authenticated;
grant execute on function public.review_relearning_step_hours(smallint) to service_role;
revoke all on function public.record_answer(uuid, smallint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_answer(uuid, smallint, text, text, text, timestamptz) to service_role;
revoke all on function public.reschedule_knowledge_for_priority() from public, anon, authenticated;
grant execute on function public.reschedule_knowledge_for_priority() to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261007120000_priority_relearning_steps', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
