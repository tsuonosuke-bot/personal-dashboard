-- Related items for one knowledge card (issue #97), shown on the review answer screen.
-- Uses the card's own embedding in semantic_embeddings, so no embedding API call is needed.
-- Returns the nearest other knowledge, insights written on other knowledge, and questions
-- whose guiding question is close to the card (unless the card was removed from that question).
-- Read-only: it never touches quiz_log, mastery or the review schedule.
begin;

create or replace function public.related_knowledge(
  p_knowledge_id uuid,
  p_model text,
  p_per_kind integer default 4,
  p_min_similarity double precision default 0.45
)
returns table (
  kind text,
  item_id text,
  title text,
  body text,
  knowledge_id uuid,
  similarity double precision
)
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_per_kind is null or p_per_kind < 1 or p_per_kind > 20 then
    raise exception 'per_kind must be between 1 and 20' using errcode = '22023';
  end if;

  return query
  with card as (
    select e.embedding
      from public.semantic_embeddings e
     where e.source_type = 'knowledge' and e.source_id = p_knowledge_id::text and e.model = p_model
  ), items as (
    select case s.source_type when 'knowledge' then 'knowledge' else 'insight' end as kind,
           s.source_id as item_id, s.title, s.body, s.knowledge_id,
           1 - (e.embedding <=> card.embedding) as similarity
      from card
      cross join public.semantic_embeddings e
      join public.semantic_sources() s on s.source_type = e.source_type and s.source_id = e.source_id
     where e.model = p_model
       and s.source_type in ('knowledge', 'insight')
       and not s.archived
       and s.knowledge_id <> p_knowledge_id
    union all
    select 'question', g.id::text, g.title, g.guiding_question, null::uuid,
           1 - (q.embedding <=> card.embedding)
      from card
      cross join public.question_embeddings q
      join public.insight_groups g on g.id = q.group_id
     where q.model = p_model
       and not exists (
         select 1 from public.question_material_exclusions x
          where x.group_id = g.id and x.source_type = 'knowledge' and x.source_id = p_knowledge_id::text
       )
  ), ranked as (
    select i.*, row_number() over (partition by i.kind order by i.similarity desc) as rank
      from items i
     where i.similarity >= p_min_similarity
  )
  select r.kind, r.item_id, r.title, r.body, r.knowledge_id, r.similarity
    from ranked r
   where r.rank <= p_per_kind
   order by array_position(array['knowledge', 'insight', 'question'], r.kind), r.similarity desc;
end
$$;

revoke all on function public.related_knowledge(uuid, text, integer, double precision) from public, anon, authenticated;
grant execute on function public.related_knowledge(uuid, text, integer, double precision) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261007100000_related_knowledge', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
