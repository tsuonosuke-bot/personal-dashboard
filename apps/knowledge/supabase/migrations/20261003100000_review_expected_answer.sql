-- Review flow improvements:
-- * Each generated question carries the expected answer. It is checked against
--   the question text on generation (answer leak) and shown to the learner
--   right after answering, before the AI grading arrives.
-- * A learner can report a broken question (e.g. the answer is visible). It is
--   discarded without recording anything and regenerated in a later batch.
begin;

alter table public.review_queue
  add column if not exists expected_answer text
    check (expected_answer is null or char_length(expected_answer) <= 2000);

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
    v_added := v_added + v_rows;
    v_ready := v_ready + v_rows;
  end loop;
  return v_added;
end
$$;

-- The return type gains expected_answer, so the function must be recreated.
drop function if exists public.submit_review_answer(bigint, text);
create function public.submit_review_answer(p_item_id bigint, p_answer text)
returns table(
  id bigint,
  knowledge_id uuid,
  format text,
  question text,
  choices jsonb,
  correct_choice text,
  prepared_explanation text,
  expected_answer text,
  answer_text text,
  answered_at timestamptz,
  status text,
  accepted boolean
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  item public.review_queue;
  k public.knowledge;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_accepted boolean := false;
begin
  if char_length(v_answer) > 2000 then
    raise exception 'answer is too long' using errcode = '22023';
  end if;

  select * into item from public.review_queue q where q.id = p_item_id for update;
  if not found then
    raise exception 'review question % was not found', p_item_id using errcode = 'P0002';
  end if;

  if item.status = 'ready' then
    select * into k from public.knowledge kk where kk.id = item.knowledge_id;
    if k.archived or k.content_version <> item.content_version
      or (k.last_reviewed_at is not null and k.last_reviewed_at > item.generated_at) then
      update public.review_queue q set status = 'discarded', discarded_reason = 'stale_on_answer'
      where q.id = item.id;
      raise exception 'review question % is no longer valid', p_item_id using errcode = 'P0001';
    end if;
    if item.format = '四択' and v_answer <> '' and not (item.choices ? v_answer) then
      raise exception 'answer is not one of the choices' using errcode = '22023';
    end if;
    update public.review_queue q
    set status = 'answered', answer_text = v_answer, answered_at = now()
    where q.id = item.id
    returning * into item;
    v_accepted := true;
  elsif item.status in ('answered', 'grading', 'graded', 'error') then
    if item.answer_text is distinct from v_answer then
      raise exception 'review question % was already answered', p_item_id using errcode = 'P0001';
    end if;
  else
    raise exception 'review question % is no longer valid', p_item_id using errcode = 'P0001';
  end if;

  return query select item.id, item.knowledge_id, item.format, item.question, item.choices,
    item.correct_choice, item.prepared_explanation, item.expected_answer, item.answer_text, item.answered_at,
    item.status, v_accepted;
end
$$;

-- Discard a ready question the learner reported as broken. Nothing is recorded,
-- the card keeps its schedule, and the next batch can generate a new question.
create or replace function public.discard_review_question(p_item_id bigint)
returns text
language sql
set search_path to 'public', 'pg_temp'
as $$
  update public.review_queue q
  set status = 'discarded', discarded_reason = 'reported'
  where q.id = p_item_id and q.status = 'ready'
  returning q.status;
$$;

revoke all on function public.enqueue_review_questions(jsonb) from public, anon, authenticated;
revoke all on function public.submit_review_answer(bigint, text) from public, anon, authenticated;
revoke all on function public.discard_review_question(bigint) from public, anon, authenticated;
grant execute on function public.enqueue_review_questions(jsonb) to service_role;
grant execute on function public.submit_review_answer(bigint, text) to service_role;
grant execute on function public.discard_review_question(bigint) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261003100000_review_expected_answer', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
