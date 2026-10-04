-- Definitions of the knowledge-quiz skill's quiz-engine-v1 functions as they
-- were in production on 2026-10-04, kept for reference after
-- migrations/20261004130000_drop_quiz_engine_v1.sql removed them. They were
-- created outside this repository. direct_quiz_count is versioned in
-- migrations/20260928110000_direct_quiz_count_new_cap.sql.
--
-- Do not apply this file as is: it depends on pick_daily_review_queue,
-- pick_quiz and record_answers_batch_once, and the current skill uses the
-- quiz-engine-v2 functions in migrations/20261004100000_skill_review_queue.sql.

CREATE OR REPLACE FUNCTION public.direct_quiz_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'database', current_database(),
    'contract_version', 'quiz-engine-v1',
    'active_knowledge', (select count(*) from public.knowledge where archived = false),
    'pick_daily_review_queue', to_regprocedure('public.pick_daily_review_queue(integer)') is not null,
    'pick_quiz', to_regprocedure('public.pick_quiz(text[],text[],integer,boolean)') is not null,
    'record_answers_batch_once', to_regprocedure('public.record_answers_batch_once(jsonb)') is not null,
    'get_recent_quiz_notes', to_regprocedure('public.get_recent_quiz_notes(uuid[],integer)') is not null
  );
$function$;

CREATE OR REPLACE FUNCTION public.direct_quiz_pick(p_mode text DEFAULT 'daily'::text, p_include text[] DEFAULT NULL::text[], p_exclude text[] DEFAULT NULL::text[], p_limit integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
begin
  if p_mode not in ('daily', 'custom')
    or p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception 'invalid direct quiz pick request' using errcode = '22023';
  end if;
  if p_mode = 'daily' and (p_include is not null or p_exclude is not null) then
    raise exception 'daily mode does not accept category filters' using errcode = '22023';
  end if;

  if p_mode = 'daily' then
    select coalesce(jsonb_agg(to_jsonb(candidate) - 'selection_order' order by candidate.selection_order), '[]'::jsonb)
    into result
    from (
      select
        picked.*,
        k.tags,
        k.content_version,
        coalesce((
          select jsonb_agg(to_jsonb(note_row) order by note_row.asked_on desc)
          from public.get_recent_quiz_notes(array[picked.id], 2) note_row
        ), '[]'::jsonb) as past_notes,
        row_number() over () as selection_order
      from public.pick_daily_review_queue(p_limit) picked
      join public.knowledge k on k.id = picked.id
    ) candidate;
  else
    select coalesce(jsonb_agg(to_jsonb(candidate) - 'selection_order' order by candidate.selection_order), '[]'::jsonb)
    into result
    from (
      select
        picked.*,
        k.tags,
        k.content_version,
        coalesce((
          select jsonb_agg(to_jsonb(note_row) order by note_row.asked_on desc)
          from public.get_recent_quiz_notes(array[picked.id], 2) note_row
        ), '[]'::jsonb) as past_notes,
        row_number() over () as selection_order
      from public.pick_quiz(p_include, p_exclude, p_limit, false) picked
      join public.knowledge k on k.id = picked.id
    ) candidate;
  end if;

  return result;
end
$function$;

CREATE OR REPLACE FUNCTION public.direct_quiz_record(p_answers jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recorded as (
    select * from public.record_answers_batch_once(p_answers)
  )
  select coalesce(jsonb_agg(to_jsonb(result_row)), '[]'::jsonb)
  from (
    select
      r.id,
      k.title,
      k.category,
      k.priority,
      k.content_version,
      r.next_review_on,
      r.next_review_at,
      r.stability_hours,
      r.relearning_stage,
      r.recorded,
      r.schedule_updated
    from recorded r
    join public.knowledge k on k.id = r.id
  ) result_row;
$function$;
