-- Remove the knowledge-quiz skill's quiz-engine-v1 functions. Apply this only
-- after the skill uploaded to claude.ai is the quiz-engine-v2 copy in
-- skills/knowledge-quiz/ (its health check returns 'quiz-engine-v2'); an older
-- copy of the skill stops working once these are gone. Their last definitions
-- are kept in supabase/archive/quiz_engine_v1.sql.
--
-- direct_quiz_categories stays because the v2 skill uses it. It was created
-- outside this repository, so its current definition is versioned here.
begin;

create or replace function public.direct_quiz_categories()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_agg(to_jsonb(category_row) order by category_row.count desc, category_row.category), '[]'::jsonb)
  from (
    select k.category, count(*) as count
    from public.knowledge k
    where k.archived = false
    group by k.category
  ) category_row;
$$;

revoke all on function public.direct_quiz_categories() from public, anon, authenticated;
grant execute on function public.direct_quiz_categories() to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'knowledge_quiz') then
    grant execute on function public.direct_quiz_categories() to knowledge_quiz;
  end if;
end
$$;

drop function if exists public.direct_quiz_health();
drop function if exists public.direct_quiz_pick(text, text[], text[], integer);
drop function if exists public.direct_quiz_count(text, text[], text[]);
drop function if exists public.direct_quiz_record(jsonb);

notify pgrst, 'reload schema';

commit;
