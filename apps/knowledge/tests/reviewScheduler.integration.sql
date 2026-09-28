\set ON_ERROR_STOP on

begin;

create schema review_scheduler_verify;

create function review_scheduler_verify.jst_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Tokyo')::date $$;

create table review_scheduler_verify.knowledge (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  title text not null,
  explanation text,
  source_note text,
  category text not null,
  mastery text not null default '未学習'
    check (mastery in ('未学習', '学習中', '習得中', '定着')),
  ef numeric not null default 2.50 check (ef >= 1.30),
  reps integer not null default 0,
  interval_days integer not null default 0,
  times_asked integer not null default 0,
  times_correct integer not null default 0,
  learned_on date not null default review_scheduler_verify.jst_today(),
  last_asked_on date,
  next_review_on date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  accuracy numeric,
  tags text[] not null default '{}',
  mastery_streak smallint not null default 0,
  content_version bigint not null default 1 check (content_version >= 1),
  priority text not null default '中'
    check (priority in ('最高', '高', '中', '低', '最低')),
  base_interval_days integer not null default 0 check (base_interval_days >= 0)
);

create table review_scheduler_verify.quiz_log (
  id bigserial primary key,
  knowledge_id uuid not null references review_scheduler_verify.knowledge(id) on delete cascade,
  asked_on date not null default review_scheduler_verify.jst_today(),
  quality smallint not null check (quality between 0 and 5),
  verdict text not null check (verdict in ('正解', '部分正解', '不正解')),
  format text not null default '一問一答'
    check (format in ('一問一答', '四択', 'ソクラテス式', '記述説明', '産出')),
  note text,
  created_at timestamptz not null default now(),
  sync_event_id uuid
);

-- The runner must replace the marker below with the bodies of
-- 20260921100000_continuous_review_queue.sql and 20260928100000_review_pacing.sql,
-- in that order, after removing each file's top-level BEGIN/COMMIT pair and
-- pointing `public.` at this schema. This outer transaction must remain the sole
-- transaction so the test schema is always rolled back.
-- __MIGRATION__

do $$
declare
  v_minutes numeric;
  v_stability numeric;
  v_stage text;
  v_mastery text;
  v_streak smallint;
  v_due timestamptz;
  v_due_after timestamptz;
  v_r integer;
  v_n integer;
  v_first boolean;
  v_second boolean;
  v_attempts integer;
begin
  -- Q0-Q3 use exact short intervals and retain a quality-specific share of
  -- prior stability.
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, times_asked, interval_days, base_interval_days,
    next_review_on, stability_hours, next_review_at
  ) values
    ('00000000-0000-4000-8000-000000000000', 'q0', 'test', '習得中', 4, 10, 10, current_date - 1, 240, now() - interval '1 day'),
    ('00000000-0000-4000-8000-000000000001', 'q1', 'test', '習得中', 4, 10, 10, current_date - 1, 240, now() - interval '1 day'),
    ('00000000-0000-4000-8000-000000000002', 'q2', 'test', '習得中', 4, 10, 10, current_date - 1, 240, now() - interval '1 day'),
    ('00000000-0000-4000-8000-000000000003', 'q3', 'test', '習得中', 4, 10, 10, current_date - 1, 240, now() - interval '1 day');

  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000000', 0::smallint, '不正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000001', 1::smallint, '不正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000002', 2::smallint, '部分正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000003', 3::smallint, '正解', null, '一問一答');

  select extract(epoch from (next_review_at - last_reviewed_at)) / 60
  into v_minutes from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000000';
  if abs(v_minutes - 10) > 0.01 then raise exception 'q0 interval was % minutes', v_minutes; end if;
  select extract(epoch from (next_review_at - last_reviewed_at)) / 60
  into v_minutes from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000001';
  if abs(v_minutes - 30) > 0.01 then raise exception 'q1 interval was % minutes', v_minutes; end if;
  select extract(epoch from (next_review_at - last_reviewed_at)) / 60
  into v_minutes from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000002';
  if abs(v_minutes - 360) > 0.01 then raise exception 'q2 interval was % minutes', v_minutes; end if;
  select extract(epoch from (next_review_at - last_reviewed_at)) / 60, relearning_stage
  into v_minutes, v_stage from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000003';
  if abs(v_minutes - 720) > 0.01 or v_stage <> 'recall' then
    raise exception 'q3 interval/stage was % / %', v_minutes, v_stage;
  end if;

  -- A lapse demotes and applies its stability penalty only once per episode.
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, mastery_streak, times_asked, next_review_at,
    next_review_on, stability_hours
  ) values (
    '00000000-0000-4000-8000-000000000010', 'penalty once', 'test', '定着', 2, 20,
    now() - interval '1 day', current_date - 1, 2400
  );
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000010', 0::smallint, '不正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000010', 1::smallint, '不正解', null, '一問一答');
  select stability_hours, mastery, mastery_streak
  into v_stability, v_mastery, v_streak
  from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000010';
  if v_stability <> 960 or v_mastery <> '習得中' or v_streak <> 0 then
    raise exception 'lapse penalty repeated: stability %, mastery %, streak %', v_stability, v_mastery, v_streak;
  end if;

  -- Correct recognition advances to recall without stability growth. The first
  -- later free recall exits recovery at retained strength, also without growth.
  update review_scheduler_verify.knowledge
  set next_review_at = now() - interval '1 second'
  where id = '00000000-0000-4000-8000-000000000010';
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000010', 4::smallint, '正解', null, '四択');
  select stability_hours, relearning_stage,
    extract(epoch from (next_review_at - last_reviewed_at)) / 3600
  into v_stability, v_stage, v_minutes
  from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000010';
  if v_stability <> 960 or v_stage <> 'recall' or abs(v_minutes - 24) > 0.01 then
    raise exception 'recognition transition failed: stability %, stage %, hours %', v_stability, v_stage, v_minutes;
  end if;
  update review_scheduler_verify.knowledge
  set next_review_at = now() - interval '1 second'
  where id = '00000000-0000-4000-8000-000000000010';
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000010', 5::smallint, '正解', null, '一問一答');
  select stability_hours, relearning_stage
  into v_stability, v_stage
  from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000010';
  if v_stability <> 960 or v_stage is not null then
    raise exception 'recall recovery grew or stayed active: stability %, stage %', v_stability, v_stage;
  end if;

  -- A recall step created by a correct choice is not yet a lapse. If that
  -- later recall fails, the one-time penalty and demotion must still happen.
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, mastery_streak, times_asked, next_review_at,
    next_review_on, stability_hours
  ) values (
    '00000000-0000-4000-8000-000000000011', 'choice then lapse', 'test', '定着', 2, 20,
    now() - interval '1 day', current_date - 1, 2400
  );
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000011', 4::smallint, '正解', null, '四択');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000011', 0::smallint, '不正解', null, '一問一答');
  select stability_hours, mastery into v_stability, v_mastery
  from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000011';
  if v_stability <> 960 or v_mastery <> '習得中' then
    raise exception 'choice-created recall suppressed lapse penalty: stability %, mastery %', v_stability, v_mastery;
  end if;

  -- Three due free recalls plus the threshold promote each mastery stage. A
  -- settled card remains scheduled instead of disappearing from review.
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, times_asked, next_review_at, next_review_on, stability_hours
  ) values (
    '00000000-0000-4000-8000-000000000020', 'promotion', 'test', '学習中', 3,
    now() - interval '1 day', current_date - 1, 72
  );
  for i in 1..3 loop
    update review_scheduler_verify.knowledge set next_review_at = now() - interval '1 second'
    where id = '00000000-0000-4000-8000-000000000020';
    perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000020', 5::smallint, '正解', null, '一問一答');
  end loop;
  select mastery, mastery_streak into v_mastery, v_streak
  from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000020';
  if v_mastery <> '習得中' or v_streak <> 0 then
    raise exception 'learning promotion failed: mastery %, streak %', v_mastery, v_streak;
  end if;
  for i in 1..3 loop
    update review_scheduler_verify.knowledge set next_review_at = now() - interval '1 second'
    where id = '00000000-0000-4000-8000-000000000020';
    perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000020', 5::smallint, '正解', null, '一問一答');
  end loop;
  select mastery, next_review_at into v_mastery, v_due
  from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000020';
  if v_mastery <> '定着' or v_due <= now() then
    raise exception 'settled promotion/schedule failed: mastery %, due %', v_mastery, v_due;
  end if;

  -- A strong answer before the due time is logged but leaves schedule,
  -- stability and promotion progress untouched.
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, mastery_streak, times_asked, next_review_at,
    next_review_on, stability_hours
  ) values (
    '00000000-0000-4000-8000-000000000030', 'early', 'test', '習得中', 2, 8,
    now() + interval '10 days', current_date + 10, 720
  );
  select next_review_at into v_due from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000030';
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000030', 5::smallint, '正解', null, '一問一答');
  select next_review_at, stability_hours, mastery_streak
  into v_due_after, v_stability, v_streak
  from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000030';
  if v_due_after <> v_due or v_stability <> 720 or v_streak <> 2 then
    raise exception 'early success changed scheduler state';
  end if;
  if (select schedule_updated from review_scheduler_verify.quiz_log
      where knowledge_id = '00000000-0000-4000-8000-000000000030' order by id desc limit 1) then
    raise exception 'early success was marked schedule_updated';
  end if;

  -- A 15-card batch reserves five slots for normal due cards when available.
  truncate review_scheduler_verify.quiz_log, review_scheduler_verify.knowledge cascade;
  for i in 1..12 loop
    insert into review_scheduler_verify.knowledge(
      title, category, mastery, times_asked, next_review_at, stability_hours,
      relearning_stage, relearning_quality
    ) values ('retry-' || i, 'test', '学習中', 2, now() - interval '1 minute', 24, 'recognition', i % 3);
  end loop;
  for i in 1..10 loop
    insert into review_scheduler_verify.knowledge(
      title, category, mastery, times_asked, next_review_at, stability_hours
    ) values ('normal-' || i, 'test', '学習中', 2, now() - interval '1 day', 24);
  end loop;
  select count(*) filter (where pool = 'R'), count(*) filter (where pool <> 'R')
  into v_r, v_n from review_scheduler_verify.pick_daily_review_queue(15);
  if v_r <> 10 or v_n <> 5 then
    raise exception 'batch quota was retry %, normal %', v_r, v_n;
  end if;

  -- Strong due recalls grow faster: q4 starts at 2 days and doubles, q5 starts
  -- at 4 days and grows 2.8x. At 高 the due interval equals stability.
  truncate review_scheduler_verify.quiz_log, review_scheduler_verify.knowledge cascade;
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, priority, times_asked, next_review_at, stability_hours
  ) values
    ('00000000-0000-4000-8000-000000000050', 'q4 growth', 'test', '学習中', '高', 2, now() - interval '1 day', 30),
    ('00000000-0000-4000-8000-000000000051', 'q5 growth', 'test', '学習中', '高', 2, now() - interval '1 day', 100),
    ('00000000-0000-4000-8000-000000000052', 'q4 first', 'test', '未学習', '高', 0, now() - interval '1 day', 0),
    ('00000000-0000-4000-8000-000000000053', 'q5 first', 'test', '未学習', '高', 0, now() - interval '1 day', 0);
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000050', 4::smallint, '正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000051', 5::smallint, '正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000052', 4::smallint, '正解', null, '一問一答');
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000053', 5::smallint, '正解', null, '一問一答');
  if (select string_agg(stability_hours::numeric(10, 2)::text || '/' ||
        round(extract(epoch from (next_review_at - scheduled_from_at)) / 3600, 2)::text, ',' order by id)
      from review_scheduler_verify.knowledge) <> '60.00/60.00,280.00/280.00,48.00/48.00,96.00/96.00' then
    raise exception 'growth schedule was %', (
      select string_agg(stability_hours::text || '/' ||
        (extract(epoch from (next_review_at - scheduled_from_at)) / 3600)::text, ',' order by id)
      from review_scheduler_verify.knowledge);
  end if;

  -- Priority scales the due interval but never the stored stability. A later
  -- priority-only edit reschedules from the same anchor; relearning steps keep
  -- their fixed time, and an explicit date in the same edit wins.
  truncate review_scheduler_verify.quiz_log, review_scheduler_verify.knowledge cascade;
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, priority, times_asked, next_review_at, stability_hours
  ) values
    ('00000000-0000-4000-8000-000000000060', 'low priority', 'test', '学習中', '低', 2, now() - interval '1 day', 24),
    ('00000000-0000-4000-8000-000000000061', 'relearning priority', 'test', '学習中', '中', 2, now() - interval '1 day', 240);
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000060', 4::smallint, '正解', null, '一問一答');
  select stability_hours, extract(epoch from (next_review_at - scheduled_from_at)) / 3600
  into v_stability, v_minutes
  from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000060';
  if v_stability <> 48 or abs(v_minutes - 96) > 0.01 then
    raise exception 'low priority schedule was stability %, due hours %', v_stability, v_minutes;
  end if;
  update review_scheduler_verify.knowledge set priority = '最高'
  where id = '00000000-0000-4000-8000-000000000060';
  select stability_hours, extract(epoch from (next_review_at - scheduled_from_at)) / 3600
  into v_stability, v_minutes
  from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000060';
  if v_stability <> 48 or abs(v_minutes - 24) > 0.01
    or (select next_review_on <> (next_review_at at time zone 'Asia/Tokyo')::date
        from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000060') then
    raise exception 'priority edit reschedule was stability %, due hours %', v_stability, v_minutes;
  end if;
  update review_scheduler_verify.knowledge
  set priority = '最低', next_review_on = current_date + 40
  where id = '00000000-0000-4000-8000-000000000060';
  if (select next_review_on from review_scheduler_verify.knowledge
      where id = '00000000-0000-4000-8000-000000000060') <> current_date + 40 then
    raise exception 'explicit date lost to a priority edit';
  end if;
  perform review_scheduler_verify.record_answer('00000000-0000-4000-8000-000000000061', 2::smallint, '部分正解', null, '一問一答');
  select next_review_at into v_due from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000061';
  update review_scheduler_verify.knowledge set priority = '最低'
  where id = '00000000-0000-4000-8000-000000000061';
  if (select next_review_at from review_scheduler_verify.knowledge
      where id = '00000000-0000-4000-8000-000000000061') <> v_due then
    raise exception 'priority edit moved a relearning step';
  end if;

  -- At most 10 never-asked cards enter the daily queue per JST day. Cards
  -- already introduced today use up the allowance, and held-back cards are not
  -- counted as remaining work.
  truncate review_scheduler_verify.quiz_log, review_scheduler_verify.knowledge cascade;
  for i in 1..15 loop
    insert into review_scheduler_verify.knowledge(
      title, category, mastery, priority, times_asked, next_review_at, created_at
    ) values (
      'new-' || lpad(i::text, 2, '0'), 'test', '未学習',
      case when i = 15 then '最高' else '中' end, 0,
      now() - interval '1 day', now() - make_interval(days => 30 - i)
    );
  end loop;
  insert into review_scheduler_verify.knowledge(
    title, category, mastery, times_asked, next_review_at, stability_hours
  ) values ('old due', 'test', '学習中', 3, now() - interval '1 day', 24);
  select count(*) filter (where pool = 'B'), count(*) filter (where pool = 'A')
  into v_n, v_r from review_scheduler_verify.pick_daily_review_queue(30);
  if v_n <> 10 or v_r <> 1 then
    raise exception 'new-card cap picked new %, due %', v_n, v_r;
  end if;
  if not exists (
    select 1 from review_scheduler_verify.pick_daily_review_queue(30) p where p.title = 'new-15'
  ) or exists (
    select 1 from review_scheduler_verify.pick_daily_review_queue(30) p where p.title = 'new-11'
  ) then
    raise exception 'new-card cap did not prefer priority, then oldest registration';
  end if;
  perform review_scheduler_verify.record_answer(k.id, 5::smallint, '正解', null, '一問一答')
  from review_scheduler_verify.knowledge k where k.title in ('new-01', 'new-02', 'new-03');
  if review_scheduler_verify.review_new_cards_remaining_today() <> 7 then
    raise exception 'remaining new allowance was %', review_scheduler_verify.review_new_cards_remaining_today();
  end if;
  select remaining, new_held, new_limit into v_r, v_n, v_attempts
  from review_scheduler_verify.get_daily_review_status(15);
  if v_r <> 8 or v_n <> 5 or v_attempts <> 10 then
    raise exception 'status with new-card cap was remaining %, held %, limit %', v_r, v_n, v_attempts;
  end if;

  -- The signed attempt id makes recording exactly-once even when the client
  -- repeats the same request.
  truncate review_scheduler_verify.quiz_log, review_scheduler_verify.knowledge cascade;
  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, times_asked, next_review_at, stability_hours
  ) values (
    '00000000-0000-4000-8000-000000000040', 'idempotent', 'test', '学習中', 1,
    now() - interval '1 day', 24
  );
  select recorded into v_first from review_scheduler_verify.record_answers_batch_once(
    '[{"id":"00000000-0000-4000-8000-000000000040","quality":4,"verdict":"正解","note":null,"format":"一問一答","attempt_id":"attempt_123456789012345"}]'::jsonb
  );
  select recorded into v_second from review_scheduler_verify.record_answers_batch_once(
    '[{"id":"00000000-0000-4000-8000-000000000040","quality":4,"verdict":"正解","note":null,"format":"一問一答","attempt_id":"attempt_123456789012345"}]'::jsonb
  );
  select times_asked into v_attempts from review_scheduler_verify.knowledge
  where id = '00000000-0000-4000-8000-000000000040';
  if not v_first or v_second or v_attempts <> 2 then
    raise exception 'idempotency failed: first %, second %, attempts %', v_first, v_second, v_attempts;
  end if;
end
$$;

select 'review scheduler integration checks passed' as result;

rollback;
