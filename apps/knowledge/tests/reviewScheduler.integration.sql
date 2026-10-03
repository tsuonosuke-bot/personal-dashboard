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
-- 20260921100000_continuous_review_queue.sql, 20260928100000_review_pacing.sql,
-- 20261002100000_review_queue.sql, 20261003100000_review_expected_answer.sql and
-- 20261004120000_review_generation_holds.sql, in that order, after removing each file's top-level BEGIN/COMMIT pair and
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

-- Review queue: generation candidates, enqueue limits, serving order, answers,
-- grading claims and exactly-once recording.
do $$
declare
  v_n integer;
  v_m integer;
  v_item bigint;
  v_item2 bigint;
  v_choice bigint;
  v_status text;
  v_answered timestamptz;
  v_log record;
  v_run bigint;
  v_run2 bigint;
  v_card uuid;
  v_ok boolean;
begin
  truncate review_scheduler_verify.review_queue, review_scheduler_verify.quiz_log,
    review_scheduler_verify.knowledge, review_scheduler_verify.review_batch_runs cascade;

  insert into review_scheduler_verify.knowledge(
    id, title, category, mastery, priority, times_asked, next_review_at, stability_hours, archived
  ) values
    ('00000000-0000-4000-8000-000000000101', 'due old', 'test', '学習中', '中', 3, now() - interval '1 day', 48, false),
    ('00000000-0000-4000-8000-000000000102', 'due soon', 'test', '学習中', '中', 3, now() + interval '20 minutes', 48, false),
    ('00000000-0000-4000-8000-000000000103', 'due later', 'test', '学習中', '中', 3, now() + interval '2 hours', 48, false),
    ('00000000-0000-4000-8000-000000000104', 'archived', 'test', '学習中', '中', 3, now() - interval '1 day', 48, true);
  update review_scheduler_verify.knowledge
  set relearning_stage = 'recognition', relearning_quality = 0, relearning_penalized = true
  where id = '00000000-0000-4000-8000-000000000101';
  for i in 1..12 loop
    insert into review_scheduler_verify.knowledge(title, category, mastery, priority, times_asked, next_review_at, created_at)
    values ('new-' || lpad(i::text, 2, '0'), 'test', '未学習', '中', 0, now() - interval '1 day', now() - make_interval(days => 30 - i));
  end loop;

  -- Due now and due within 30 minutes are picked; later and archived are not.
  -- Never-asked cards stay within the daily allowance of 10. Relearning comes first.
  select count(*), count(*) filter (where pool = 'B') into v_n, v_m
  from review_scheduler_verify.pick_review_generation_candidates(30, false);
  if v_n <> 12 or v_m <> 10 then
    raise exception 'generation candidates were % (new %)', v_n, v_m;
  end if;
  if (select title from review_scheduler_verify.pick_review_generation_candidates(30, false) limit 1) <> 'due old' then
    raise exception 'relearning card was not first in generation order';
  end if;
  if (select count(*) from review_scheduler_verify.pick_review_generation_candidates(30, true)) <> 1 then
    raise exception 'relearning-only generation picked other cards';
  end if;

  -- Enqueue skips a stale content version and duplicates of an active card.
  select review_scheduler_verify.enqueue_review_questions(jsonb_build_array(
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000101', 'content_version', 1,
      'format', '四択', 'question', 'Q1', 'choices', jsonb_build_array('a', 'b', 'c', 'd'),
      'correct_choice', 'b', 'prepared_explanation', 'bが正解'),
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000101', 'content_version', 1,
      'format', '一問一答', 'question', 'duplicate'),
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000102', 'content_version', 1,
      'format', '一問一答', 'question', 'Q2'),
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000103', 'content_version', 99,
      'format', '一問一答', 'question', 'stale'),
    jsonb_build_object('knowledge_id', (select id from review_scheduler_verify.knowledge where title = 'new-01'),
      'content_version', 1, 'format', '一問一答', 'question', 'Q new')
  )) into v_n;
  if v_n <> 3 then raise exception 'enqueue added % questions', v_n; end if;

  -- A never-asked card waiting in the queue uses up the daily allowance.
  if (select count(*) filter (where pool = 'B') from review_scheduler_verify.pick_review_generation_candidates(30, false)) <> 9 then
    raise exception 'queued new card did not use the daily allowance';
  end if;

  -- Only due questions are served, relearning first. The look-ahead question waits.
  select count(*) into v_n from review_scheduler_verify.serve_review_queue(15, null);
  if v_n <> 2 then raise exception 'served % questions', v_n; end if;
  select id into v_choice from review_scheduler_verify.serve_review_queue(15, null) limit 1;
  if (select knowledge_id from review_scheduler_verify.review_queue where id = v_choice)
    <> '00000000-0000-4000-8000-000000000101' then
    raise exception 'relearning question was not served first';
  end if;
  if (select count(*) from review_scheduler_verify.serve_review_queue(15, array['other'])) <> 0 then
    raise exception 'category filter was ignored';
  end if;

  -- Editing a card discards its ready question when serving.
  update review_scheduler_verify.knowledge set content_version = 2
  where title = 'new-01';
  perform * from review_scheduler_verify.serve_review_queue(15, null);
  if (select status from review_scheduler_verify.review_queue q join review_scheduler_verify.knowledge k on k.id = q.knowledge_id
      where k.title = 'new-01') <> 'discarded' then
    raise exception 'edited card question was not discarded';
  end if;

  -- Answers: a wrong choice text is rejected, the same answer twice is a no-op,
  -- and a different second answer is rejected.
  v_ok := false;
  begin
    perform * from review_scheduler_verify.submit_review_answer(v_choice, 'z');
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'invalid choice was accepted'; end if;
  if not (select accepted from review_scheduler_verify.submit_review_answer(v_choice, 'b')) then
    raise exception 'first answer was not accepted';
  end if;
  if (select accepted from review_scheduler_verify.submit_review_answer(v_choice, 'b')) then
    raise exception 'repeated answer was accepted twice';
  end if;
  v_ok := false;
  begin
    perform * from review_scheduler_verify.submit_review_answer(v_choice, 'c');
  exception when raise_exception then v_ok := true;
  end;
  if not v_ok then raise exception 'a second different answer was accepted'; end if;

  -- Grading claims move answers to grading; failures go back until the third
  -- attempt, then become errors that can be retried by hand.
  select id into v_item2 from review_scheduler_verify.review_queue q
  where q.knowledge_id = '00000000-0000-4000-8000-000000000102';
  update review_scheduler_verify.knowledge set next_review_at = now() - interval '1 minute'
  where id = '00000000-0000-4000-8000-000000000102';
  perform * from review_scheduler_verify.submit_review_answer(v_item2, '自由記述の回答');
  for i in 1..3 loop
    select count(*) into v_n from review_scheduler_verify.claim_review_answers(30);
    if v_n <> 2 and i = 1 then raise exception 'claimed % answers', v_n; end if;
    select review_scheduler_verify.release_review_answer(v_item2, 'AI failure') into v_status;
    perform review_scheduler_verify.release_review_answer(v_choice, 'AI failure');
  end loop;
  if v_status <> 'error' then raise exception 'third failure left status %', v_status; end if;
  if (select count(*) from review_scheduler_verify.claim_review_answers(30)) <> 0 then
    raise exception 'error answers were claimed again';
  end if;
  if review_scheduler_verify.retry_review_answer(v_item2) <> 'answered' then
    raise exception 'manual retry did not reopen the answer';
  end if;

  -- Recording uses the answer time, stores the history fields and is exactly-once.
  update review_scheduler_verify.review_queue set answered_at = now() - interval '10 seconds'
  where id = v_item2 returning answered_at into v_answered;
  select * into v_log from review_scheduler_verify.record_review_grade(
    v_item2, 4::smallint, '正解', 'note', '模範解答', '講評');
  if not v_log.recorded or v_log.status <> 'graded' then raise exception 'grade was not recorded'; end if;
  if not exists (
    select 1 from review_scheduler_verify.quiz_log l
    where l.id = v_log.quiz_log_id and l.review_queue_id = v_item2 and l.question = 'Q2'
      and l.user_answer = '自由記述の回答' and l.correct_answer = '模範解答' and l.explanation = '講評'
      and l.answered_at = v_answered and l.created_at = v_answered and l.confirmed_at is null
  ) then
    raise exception 'quiz_log history fields were not stored';
  end if;
  if (select scheduled_from_at from review_scheduler_verify.knowledge where id = '00000000-0000-4000-8000-000000000102')
    <> v_answered then
    raise exception 'schedule was not anchored to the answer time';
  end if;
  if (select recorded from review_scheduler_verify.record_review_grade(
      v_item2, 4::smallint, '正解', 'note', '模範解答', '講評')) then
    raise exception 'grade was recorded twice';
  end if;
  if (select count(*) from review_scheduler_verify.quiz_log where review_queue_id = v_item2) <> 1 then
    raise exception 'duplicate quiz_log rows';
  end if;

  -- An answer older than a review through another path is discarded, not recorded.
  update review_scheduler_verify.knowledge set last_reviewed_at = clock_timestamp()
  where id = '00000000-0000-4000-8000-000000000101';
  select status into v_status from review_scheduler_verify.record_review_grade(
    v_choice, 4::smallint, '正解', 'n', 'b', 'e');
  if v_status <> 'discarded' then raise exception 'out-of-order answer was %', v_status; end if;

  -- Results are counted as unconfirmed until confirmed.
  if (select unconfirmed_results from review_scheduler_verify.get_review_queue_status()) <> 1 then
    raise exception 'unconfirmed results were not counted';
  end if;
  perform review_scheduler_verify.confirm_review_results(array[v_log.quiz_log_id]);
  if (select unconfirmed_results from review_scheduler_verify.get_review_queue_status()) <> 0 then
    raise exception 'confirmed result was still counted';
  end if;

  -- The queue never grows past its limit.
  truncate review_scheduler_verify.review_queue cascade;
  insert into review_scheduler_verify.knowledge(id, title, category, mastery, times_asked, next_review_at)
  select gen_random_uuid(), 'bulk-' || g, 'bulk', '学習中', 1, now() from generate_series(1, 201) g;
  insert into review_scheduler_verify.review_queue(knowledge_id, content_version, format, question)
  select k.id, 1, '一問一答', 'q' from review_scheduler_verify.knowledge k where k.category = 'bulk'
  order by k.title limit 200;
  select id into v_card from review_scheduler_verify.knowledge k where k.category = 'bulk'
    and not exists (select 1 from review_scheduler_verify.review_queue q where q.knowledge_id = k.id);
  if review_scheduler_verify.enqueue_review_questions(jsonb_build_array(jsonb_build_object(
      'knowledge_id', v_card, 'content_version', 1, 'format', '一問一答', 'question', 'over'))) <> 0 then
    raise exception 'enqueue exceeded the queue limit';
  end if;
  if not (select queue_full from review_scheduler_verify.get_review_queue_status()) then
    raise exception 'full queue was not reported';
  end if;

  -- Only one batch of each kind runs at a time.
  v_run := review_scheduler_verify.begin_review_batch('generate', 'schedule');
  v_run2 := review_scheduler_verify.begin_review_batch('generate', 'manual');
  if v_run is null or v_run2 is not null then raise exception 'batch lock failed: % %', v_run, v_run2; end if;
  if review_scheduler_verify.begin_review_batch('grade', 'manual') is null then
    raise exception 'grading was blocked by generation';
  end if;
  perform review_scheduler_verify.finish_review_batch(v_run, 'succeeded', 3, 3, 0, null);
  if review_scheduler_verify.begin_review_batch('generate', 'schedule') is null then
    raise exception 'finished batch still blocked the next one';
  end if;
end
$$;

-- The expected answer is stored with the question, never served, and returned
-- only after an answer is accepted. A reported question is discarded unrecorded.
do $$
declare
  v_item bigint;
  v_row record;
  v_card uuid;
begin
  truncate review_scheduler_verify.review_queue, review_scheduler_verify.quiz_log,
    review_scheduler_verify.knowledge cascade;
  insert into review_scheduler_verify.knowledge(id, title, category, mastery, times_asked, next_review_at, stability_hours)
  values ('00000000-0000-4000-8000-000000000301', 'expected', 'test', '学習中', 2, now() - interval '1 day', 48),
         ('00000000-0000-4000-8000-000000000302', 'reported', 'test', '学習中', 2, now() - interval '1 day', 48);
  if review_scheduler_verify.enqueue_review_questions(jsonb_build_array(
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000301', 'content_version', 1,
      'format', '一問一答', 'question', 'Q', 'expected_answer', '  想定解  '),
    jsonb_build_object('knowledge_id', '00000000-0000-4000-8000-000000000302', 'content_version', 1,
      'format', '一問一答', 'question', 'leaky', 'expected_answer', 'x')
  )) <> 2 then
    raise exception 'expected-answer questions were not enqueued';
  end if;
  select id into v_item from review_scheduler_verify.review_queue
  where knowledge_id = '00000000-0000-4000-8000-000000000301';
  if (select expected_answer from review_scheduler_verify.review_queue where id = v_item) <> '想定解' then
    raise exception 'expected answer was not trimmed and stored';
  end if;
  select * into v_row from review_scheduler_verify.submit_review_answer(v_item, 'my answer');
  if v_row.expected_answer <> '想定解' or not v_row.accepted then
    raise exception 'expected answer was not returned after answering';
  end if;

  select id into v_item from review_scheduler_verify.review_queue
  where knowledge_id = '00000000-0000-4000-8000-000000000302';
  if review_scheduler_verify.discard_review_question(v_item) <> 'discarded' then
    raise exception 'reported question was not discarded';
  end if;
  if review_scheduler_verify.discard_review_question(v_item) is not null then
    raise exception 'a discarded question was discarded twice';
  end if;
  if exists (select 1 from review_scheduler_verify.quiz_log where knowledge_id = '00000000-0000-4000-8000-000000000302') then
    raise exception 'reported question was recorded';
  end if;
  -- The card is free for a new question in a later batch.
  if not exists (
    select 1 from review_scheduler_verify.pick_review_generation_candidates(30, false)
    where id = '00000000-0000-4000-8000-000000000302'
  ) then
    raise exception 'reported card did not become a generation candidate';
  end if;
end
$$;

-- A card whose question failed even after regeneration is held: 2 hours, then
-- 6 hours, then 24 hours. Editing the card or queueing a question releases it.
do $$
declare
  v_card constant uuid := '00000000-0000-4000-8000-000000000401';
  v_other constant uuid := '00000000-0000-4000-8000-000000000402';
  v_hold record;
  v_wait interval;
begin
  truncate review_scheduler_verify.review_queue, review_scheduler_verify.quiz_log,
    review_scheduler_verify.knowledge, review_scheduler_verify.review_generation_holds cascade;
  insert into review_scheduler_verify.knowledge(id, title, category, mastery, times_asked, next_review_at, stability_hours)
  values (v_card, 'held', 'test', '学習中', 2, now() - interval '1 day', 48),
         (v_other, 'other', 'test', '学習中', 2, now() - interval '1 day', 48);

  if review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 1, 'reason', ' leaked ', 'question', ' held? '),
    -- Picked before an edit: the edited card is not held.
    jsonb_build_object('knowledge_id', v_other, 'content_version', 0, 'reason', 'stale', 'question', null)
  )) <> 1 then
    raise exception 'hold did not record exactly the current-version card';
  end if;
  select * into v_hold from review_scheduler_verify.review_generation_holds where knowledge_id = v_card;
  v_wait := v_hold.retry_after - v_hold.last_failed_at;
  if v_hold.failure_count <> 1 or v_wait <> interval '2 hours' or v_hold.last_reason <> 'leaked' or v_hold.last_question <> 'held?' then
    raise exception 'first hold was wrong: count %, wait %, reason %, question %',
      v_hold.failure_count, v_wait, v_hold.last_reason, v_hold.last_question;
  end if;
  if exists (select 1 from review_scheduler_verify.pick_review_generation_candidates(30, false) where id = v_card) then
    raise exception 'held card was still a generation candidate';
  end if;
  if not exists (select 1 from review_scheduler_verify.pick_review_generation_candidates(30, false) where id = v_other) then
    raise exception 'unheld card was not a generation candidate';
  end if;
  if (select generation_held from review_scheduler_verify.get_review_queue_status()) <> 1 then
    raise exception 'status did not count the held card';
  end if;
  if (select count(*) from review_scheduler_verify.list_review_generation_holds()) <> 1 then
    raise exception 'held card was not listed';
  end if;

  -- Consecutive failures on the same version wait longer.
  perform review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 1, 'reason', 'again')));
  select * into v_hold from review_scheduler_verify.review_generation_holds where knowledge_id = v_card;
  if v_hold.failure_count <> 2 or v_hold.retry_after - v_hold.last_failed_at <> interval '6 hours' or v_hold.last_question is not null then
    raise exception 'second hold was wrong: count %, wait %', v_hold.failure_count, v_hold.retry_after - v_hold.last_failed_at;
  end if;
  perform review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 1, 'reason', 'again')));
  perform review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 1, 'reason', 'again')));
  select * into v_hold from review_scheduler_verify.review_generation_holds where knowledge_id = v_card;
  if v_hold.failure_count <> 4 or v_hold.retry_after - v_hold.last_failed_at <> interval '24 hours' then
    raise exception 'later holds did not wait 24 hours: count %, wait %', v_hold.failure_count, v_hold.retry_after - v_hold.last_failed_at;
  end if;

  -- Once the wait is over, the card is a candidate again.
  update review_scheduler_verify.review_generation_holds set retry_after = now() - interval '1 minute' where knowledge_id = v_card;
  if not exists (select 1 from review_scheduler_verify.pick_review_generation_candidates(30, false) where id = v_card) then
    raise exception 'card was still held after its wait';
  end if;

  -- Editing the card (a new version) releases it at once, and a failure on the
  -- new version starts counting from 1 again.
  update review_scheduler_verify.review_generation_holds set retry_after = now() + interval '1 day' where knowledge_id = v_card;
  update review_scheduler_verify.knowledge set content_version = 2 where id = v_card;
  if not exists (select 1 from review_scheduler_verify.pick_review_generation_candidates(30, false) where id = v_card) then
    raise exception 'edited card was still held';
  end if;
  if (select generation_held from review_scheduler_verify.get_review_queue_status()) <> 0
    or exists (select 1 from review_scheduler_verify.list_review_generation_holds()) then
    raise exception 'hold of an edited card was still reported';
  end if;
  perform review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 2, 'reason', 'new version')));
  select * into v_hold from review_scheduler_verify.review_generation_holds where knowledge_id = v_card;
  if v_hold.failure_count <> 1 or v_hold.content_version <> 2 or v_hold.retry_after - v_hold.last_failed_at <> interval '2 hours' then
    raise exception 'failure on a new version did not restart the count: count %', v_hold.failure_count;
  end if;

  -- Archived cards are not reported.
  update review_scheduler_verify.knowledge set archived = true where id = v_card;
  if exists (select 1 from review_scheduler_verify.list_review_generation_holds()) then
    raise exception 'archived held card was listed';
  end if;
  update review_scheduler_verify.knowledge set archived = false where id = v_card;

  -- A queued question clears the hold.
  if review_scheduler_verify.enqueue_review_questions(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_card, 'content_version', 2, 'format', '一問一答', 'question', 'Q')
  )) <> 1 then
    raise exception 'question for the held card was not enqueued';
  end if;
  if exists (select 1 from review_scheduler_verify.review_generation_holds where knowledge_id = v_card) then
    raise exception 'queued question did not clear the hold';
  end if;

  -- Deleting the card deletes its hold.
  perform review_scheduler_verify.hold_review_generation_failures(jsonb_build_array(
    jsonb_build_object('knowledge_id', v_other, 'content_version', 1, 'reason', 'leaked')));
  delete from review_scheduler_verify.knowledge where id = v_other;
  if exists (select 1 from review_scheduler_verify.review_generation_holds) then
    raise exception 'hold of a deleted card remained';
  end if;
end
$$;

select 'review scheduler integration checks passed' as result;

rollback;
