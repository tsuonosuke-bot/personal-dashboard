-- Hold back cards whose question could not be generated.
--
-- A card whose generated question keeps failing the checks (the answer is in the
-- question, the format is wrong, ...) used to be picked again by every batch,
-- calling the AI every 30 minutes without ever getting a question. The batch now
-- regenerates a failed question once on the spot; a card that still fails is
-- recorded here and left out of generation for 2 hours, then 6 hours, then
-- 24 hours per further consecutive failure. Editing the card (a new
-- content_version) makes it eligible again at once, and a successfully queued
-- question clears the record.
begin;

create table if not exists public.review_generation_holds (
  knowledge_id uuid primary key references public.knowledge(id) on delete cascade,
  content_version bigint not null,
  failure_count integer not null default 1 check (failure_count >= 1),
  last_reason text not null check (char_length(last_reason) between 1 and 500),
  last_question text check (last_question is null or char_length(last_question) <= 2000),
  last_failed_at timestamptz not null default now(),
  retry_after timestamptz not null
);

comment on table public.review_generation_holds is
  'Cards whose generated review question failed the checks even after one regeneration. Generation skips them until retry_after unless the card was edited since.';

alter table public.review_generation_holds enable row level security;
revoke all on table public.review_generation_holds from public, anon, authenticated;
grant select, insert, update, delete on table public.review_generation_holds to service_role;

-- How long a card waits after its n-th consecutive generation failure.
create or replace function public.review_generation_backoff(p_failure_count integer)
returns interval
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_failure_count, 1) <= 1 then interval '2 hours'
    when p_failure_count = 2 then interval '6 hours'
    else interval '24 hours'
  end;
$$;

-- Record cards whose question failed even after regeneration. Items whose card
-- changed (content_version) since it was picked are ignored: the edited card
-- deserves a fresh attempt. Consecutive failures on the same version count up.
create or replace function public.hold_review_generation_failures(p_items jsonb)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rows integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'p_items must be an array of at most 30 items' using errcode = '22023';
  end if;

  insert into public.review_generation_holds as h (
    knowledge_id, content_version, failure_count, last_reason, last_question, last_failed_at, retry_after
  )
  select distinct on (i.knowledge_id)
    i.knowledge_id,
    k.content_version,
    1,
    left(btrim(i.reason), 500),
    nullif(left(btrim(coalesce(i.question, '')), 2000), ''),
    now(),
    now() + public.review_generation_backoff(1)
  from jsonb_to_recordset(p_items) as i(knowledge_id uuid, content_version bigint, reason text, question text)
  join public.knowledge k on k.id = i.knowledge_id and k.content_version = i.content_version
  where nullif(btrim(coalesce(i.reason, '')), '') is not null
  order by i.knowledge_id
  on conflict (knowledge_id) do update
  set failure_count = case when h.content_version = excluded.content_version then h.failure_count + 1 else 1 end,
      content_version = excluded.content_version,
      last_reason = excluded.last_reason,
      last_question = excluded.last_question,
      last_failed_at = excluded.last_failed_at,
      retry_after = excluded.last_failed_at + public.review_generation_backoff(
        case when h.content_version = excluded.content_version then h.failure_count + 1 else 1 end
      );
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;

-- Held cards that still matter: not archived and not edited since the failure.
create or replace function public.list_review_generation_holds()
returns table(
  knowledge_id uuid,
  title text,
  category text,
  failure_count integer,
  last_reason text,
  last_question text,
  last_failed_at timestamptz,
  retry_after timestamptz
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select h.knowledge_id, k.title, k.category, h.failure_count, h.last_reason, h.last_question,
    h.last_failed_at, h.retry_after
  from public.review_generation_holds h
  join public.knowledge k on k.id = h.knowledge_id
  where k.archived = false and k.content_version = h.content_version
  order by h.failure_count desc, h.last_failed_at desc, h.knowledge_id
  limit 200;
$$;

-- Same as before, but cards on hold are not candidates until retry_after.
create or replace function public.pick_review_generation_candidates(
  p_limit integer default 30,
  p_relearning_only boolean default false
)
returns table(
  id uuid,
  title text,
  explanation text,
  category text,
  tags text[],
  mastery text,
  times_asked integer,
  pool text,
  stability_hours numeric,
  relearning_stage text,
  content_version bigint
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with active as (
    select q.knowledge_id
    from public.review_queue q
    where q.status in ('ready', 'answered', 'grading', 'error')
  ),
  new_in_queue as (
    select count(*)::integer as n
    from public.review_queue q
    join public.knowledge k on k.id = q.knowledge_id
    where q.status in ('ready', 'answered', 'grading', 'error') and k.times_asked = 0
  ),
  allowance as (
    select greatest(0, public.review_new_cards_remaining_today() - (select n from new_in_queue)) as new_slots
  ),
  eligible as (
    select
      k.*,
      case
        when k.relearning_stage is not null then 'R'::text
        when k.times_asked = 0 then 'B'::text
        else 'A'::text
      end as pool
    from public.knowledge k
    where k.archived = false
      and k.next_review_at <= now() + interval '30 minutes'
      and not exists (select 1 from active a where a.knowledge_id = k.id)
      and not exists (
        select 1 from public.review_generation_holds h
        where h.knowledge_id = k.id and h.content_version = k.content_version and h.retry_after > now()
      )
  ),
  new_ranked as (
    select e.id, row_number() over (
      order by
        case e.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
        e.created_at,
        e.id
    ) as rank_no
    from eligible e
    where e.pool = 'B'
  ),
  selectable as (
    select e.*
    from eligible e
    where (not p_relearning_only or e.pool = 'R')
      and (
        e.pool <> 'B'
        or e.id in (select n.id from new_ranked n cross join allowance a where n.rank_no <= a.new_slots)
      )
  )
  select
    s.id, s.title, s.explanation, s.category, s.tags, s.mastery, s.times_asked, s.pool,
    s.stability_hours, s.relearning_stage, s.content_version
  from selectable s
  order by
    case s.pool when 'R' then 0 when 'A' then 1 else 2 end,
    case when s.pool = 'R' then s.relearning_quality else 4 end asc nulls last,
    case s.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    s.next_review_at,
    s.id
  limit greatest(0, least(coalesce(p_limit, 30), public.review_generation_batch_size()));
$$;

-- Same as before, but a queued question clears the card's hold.
create or replace function public.enqueue_review_questions(p_items jsonb)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  item record;
  v_ready integer;
  v_added integer := 0;
  v_rows integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'p_items must be an array of at most 30 items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('review_queue_enqueue'));
  select count(*) into v_ready from public.review_queue where status = 'ready';

  for item in
    select * from jsonb_to_recordset(p_items) as parsed(
      knowledge_id uuid,
      content_version bigint,
      format text,
      question text,
      choices jsonb,
      correct_choice text,
      prepared_explanation text,
      expected_answer text
    )
  loop
    exit when v_ready >= public.review_queue_limit();
    insert into public.review_queue (
      knowledge_id, content_version, format, question, choices, correct_choice, prepared_explanation, expected_answer
    )
    select item.knowledge_id, item.content_version, item.format, btrim(item.question),
      case when item.format = '四択' then item.choices end,
      case when item.format = '四択' then item.correct_choice end,
      nullif(btrim(coalesce(item.prepared_explanation, '')), ''),
      nullif(btrim(coalesce(item.expected_answer, '')), '')
    from public.knowledge k
    where k.id = item.knowledge_id and k.archived = false and k.content_version = item.content_version
    on conflict (knowledge_id) where status in ('ready', 'answered', 'grading', 'error') do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      delete from public.review_generation_holds h where h.knowledge_id = item.knowledge_id;
    end if;
    v_added := v_added + v_rows;
    v_ready := v_ready + v_rows;
  end loop;
  return v_added;
end
$$;

-- The status gains generation_held (cards on hold that still matter), so the
-- function is recreated. direct_quiz_queue_status (knowledge-quiz skill) reads
-- it with select *, so an added column does not break it.
drop function if exists public.get_review_queue_status();
create function public.get_review_queue_status()
returns table(
  ready_total integer,
  ready_due integer,
  waiting_grading integer,
  grading_errors integer,
  unconfirmed_results integer,
  queue_limit integer,
  queue_full boolean,
  last_generate_at timestamptz,
  last_generate_status text,
  last_generate_added integer,
  last_generate_note text,
  last_grade_at timestamptz,
  last_grade_status text,
  generation_held integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with counts as (
    select
      count(*) filter (where q.status = 'ready')::integer as ready_total,
      count(*) filter (where q.status = 'ready' and k.next_review_at <= now() and not k.archived
        and k.content_version = q.content_version)::integer as ready_due,
      count(*) filter (where q.status in ('answered', 'grading'))::integer as waiting_grading,
      count(*) filter (where q.status = 'error')::integer as grading_errors
    from public.review_queue q
    join public.knowledge k on k.id = q.knowledge_id
    where q.status in ('ready', 'answered', 'grading', 'error')
  ),
  last_generate as (
    select r.* from public.review_batch_runs r where r.kind = 'generate'
    order by r.started_at desc limit 1
  ),
  last_grade as (
    select r.* from public.review_batch_runs r where r.kind = 'grade'
    order by r.started_at desc limit 1
  )
  select
    c.ready_total,
    c.ready_due,
    c.waiting_grading,
    c.grading_errors,
    (select count(*)::integer from public.quiz_log l where l.review_queue_id is not null and l.confirmed_at is null),
    public.review_queue_limit(),
    c.ready_total >= public.review_queue_limit(),
    (select g.started_at from last_generate g),
    (select g.status from last_generate g),
    (select g.succeeded from last_generate g),
    (select g.note from last_generate g),
    (select g.started_at from last_grade g),
    (select g.status from last_grade g),
    (select count(*)::integer
      from public.review_generation_holds h
      join public.knowledge k on k.id = h.knowledge_id
      where k.archived = false and k.content_version = h.content_version)
  from counts c;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.review_generation_backoff(integer)',
    'public.hold_review_generation_failures(jsonb)',
    'public.list_review_generation_holds()',
    'public.pick_review_generation_candidates(integer, boolean)',
    'public.enqueue_review_questions(jsonb)',
    'public.get_review_queue_status()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261004120000_review_generation_holds', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
