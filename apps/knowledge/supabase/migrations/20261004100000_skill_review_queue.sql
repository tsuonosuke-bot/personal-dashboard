-- The knowledge-quiz chat skill reads the same review queue as the app
-- (contract quiz-engine-v2). The chat grades in conversation, so no API call is
-- made, and the question, answer, model answer and feedback are kept in
-- quiz_log like the app's batch grading.
--
-- The quiz-engine-v1 functions (direct_quiz_pick / direct_quiz_record / ...)
-- stay unchanged so an older copy of the skill keeps working until it is
-- replaced. Their questions are discarded from the queue automatically.
begin;

create or replace function public.direct_quiz_queue_health()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'database', current_database(),
    'contract_version', 'quiz-engine-v2',
    'serve_review_queue', to_regprocedure('public.serve_review_queue(integer,text[])') is not null,
    'submit_review_answer', to_regprocedure('public.submit_review_answer(bigint,text)') is not null,
    'record_review_grade', to_regprocedure('public.record_review_grade(bigint,smallint,text,text,text,text)') is not null,
    'get_recent_quiz_notes', to_regprocedure('public.get_recent_quiz_notes(uuid[],integer)') is not null
  );
$$;

create or replace function public.direct_quiz_queue_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select to_jsonb(s) from public.get_review_queue_status() s;
$$;

-- Due questions in the app's priority order, with what the chat needs to grade:
-- the expected answer, the correct choice and the knowledge it came from. These
-- are grading material and must never be shown before the learner answers.
create or replace function public.direct_quiz_queue_pick(
  p_limit integer default 15,
  p_include text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception 'p_limit must be between 1 and 30' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', s.id,
    'knowledge_id', s.knowledge_id,
    'format', s.format,
    'question', s.question,
    'choices', s.choices,
    'category', s.category,
    'pool', s.pool,
    'correct_choice', q.correct_choice,
    'expected_answer', q.expected_answer,
    'prepared_explanation', q.prepared_explanation,
    'title', k.title,
    'explanation', k.explanation,
    'tags', k.tags,
    'past_notes', coalesce((
      select jsonb_agg(jsonb_build_object('asked_on', n.asked_on, 'verdict', n.verdict, 'note', n.note) order by n.asked_on desc)
      from public.get_recent_quiz_notes(array[s.knowledge_id], 2) n
    ), '[]'::jsonb)
  ) order by s.position), '[]'::jsonb)
  into result
  from (
    select served.*, row_number() over () as position
    from public.serve_review_queue(p_limit, p_include) served
  ) s
  join public.review_queue q on q.id = s.id
  join public.knowledge k on k.id = s.knowledge_id;

  return result;
end
$$;

-- Record answers graded in the chat, all or nothing. The same deterministic
-- corrections as the app apply here so a chat mistake cannot bypass them: a
-- blank answer is q0, a correct multiple choice is q4 and a wrong one at most q1.
-- The verdict always follows from the final quality. Results are marked as
-- confirmed because the chat has already shown them. Re-sending the same batch
-- records nothing twice.
create or replace function public.direct_quiz_queue_record(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  answer record;
  item public.review_queue;
  graded record;
  v_answer text;
  v_quality smallint;
  v_verdict text;
  v_results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_answers) is distinct from 'array'
    or jsonb_array_length(p_answers) < 1
    or jsonb_array_length(p_answers) > 30 then
    raise exception 'p_answers must contain an array of 1 to 30 items' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct parsed.item_id)
    from jsonb_to_recordset(p_answers) as parsed(item_id bigint)
  ) then
    raise exception 'p_answers contains duplicate item ids' using errcode = '22023';
  end if;

  for answer in
    select *
    from jsonb_to_recordset(p_answers) as parsed(
      item_id bigint,
      answer text,
      quality integer,
      note text,
      correct_answer text,
      explanation text
    )
    order by parsed.item_id
  loop
    if answer.item_id is null or answer.answer is null
      or answer.quality is null or answer.quality < 0 or answer.quality > 5
      or answer.note is null or char_length(answer.note) > 2000
      or char_length(coalesce(answer.correct_answer, '')) > 4000
      or char_length(coalesce(answer.explanation, '')) > 8000 then
      raise exception 'invalid answer values for item %', answer.item_id using errcode = '22023';
    end if;

    select * into item from public.review_queue q where q.id = answer.item_id;
    if not found then
      raise exception 'review question % was not found', answer.item_id using errcode = 'P0002';
    end if;

    v_answer := btrim(answer.answer);
    v_quality := answer.quality;
    if v_answer = '' then
      v_quality := 0;
    elsif item.format = '四択' then
      v_quality := case when v_answer = item.correct_choice then 4 else least(v_quality, 1) end;
    end if;
    v_verdict := case when v_quality >= 3 then '正解' when v_quality = 2 then '部分正解' else '不正解' end;

    perform 1 from public.submit_review_answer(answer.item_id, v_answer);
    select * into graded from public.record_review_grade(
      answer.item_id,
      v_quality,
      v_verdict,
      btrim(answer.note),
      coalesce(nullif(btrim(answer.correct_answer), ''), item.correct_choice, item.expected_answer, ''),
      coalesce(btrim(answer.explanation), '')
    );
    if graded.quiz_log_id is not null then
      update public.quiz_log l set confirmed_at = coalesce(l.confirmed_at, now()) where l.id = graded.quiz_log_id;
    end if;

    v_results := v_results || jsonb_build_object(
      'item_id', answer.item_id,
      'knowledge_id', item.knowledge_id,
      'quality', v_quality,
      'verdict', v_verdict,
      'recorded', graded.recorded,
      'status', graded.status,
      'next_review_at', graded.next_review_at
    );
  end loop;

  return v_results;
end
$$;

-- Withdraw broken questions the learner reported in the chat (e.g. the answer is
-- visible). Nothing is recorded and the next batch regenerates them.
create or replace function public.direct_quiz_queue_discard(p_item_ids bigint[])
returns integer
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  with discarded as (
    update public.review_queue q
    set status = 'discarded', discarded_reason = 'reported'
    where q.id = any(p_item_ids) and q.status = 'ready'
    returning 1
  )
  select count(*)::integer from discarded;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.direct_quiz_queue_health()',
    'public.direct_quiz_queue_status()',
    'public.direct_quiz_queue_pick(integer, text[])',
    'public.direct_quiz_queue_record(jsonb)',
    'public.direct_quiz_queue_discard(bigint[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
    -- The chat connector signs in as knowledge_quiz where that role exists.
    if exists (select 1 from pg_roles where rolname = 'knowledge_quiz') then
      execute format('grant execute on function %s to knowledge_quiz', fn);
    end if;
  end loop;
end
$$;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261004100000_skill_review_queue', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
