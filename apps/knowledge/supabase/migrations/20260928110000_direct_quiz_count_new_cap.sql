-- The knowledge-quiz skill reads direct_quiz_count before picking. Its daily
-- count must match what the daily queue can actually serve, so it now reuses
-- get_daily_review_status: never-asked cards beyond the daily new-card cap are
-- held back and not counted. Custom mode keeps its category-filtered count.
-- The response shape ({ "count": n }) and grants are unchanged.
begin;

create or replace function public.direct_quiz_count(
  p_mode text default 'daily',
  p_include text[] default null,
  p_exclude text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  result jsonb;
begin
  if p_mode not in ('daily', 'custom') then
    raise exception 'invalid direct quiz count request' using errcode = '22023';
  end if;
  if p_mode = 'daily' and (p_include is not null or p_exclude is not null) then
    raise exception 'daily mode does not accept category filters' using errcode = '22023';
  end if;

  if p_mode = 'daily' then
    select jsonb_build_object('count', s.remaining)
    into result
    from public.get_daily_review_status(15) s;
    return result;
  end if;

  select jsonb_build_object('count', count(*))
  into result
  from public.knowledge k
  where k.archived = false
    and (p_include is null or k.category = any(p_include))
    and (p_exclude is null or not (k.category = any(p_exclude)))
    and (
      k.category is distinct from '気づき'
      or (p_include is not null and '気づき' = any(p_include))
    );
  return result;
end
$$;

commit;
