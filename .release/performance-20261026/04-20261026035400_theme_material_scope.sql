-- One-theme reads filter the vocabulary before cross joins, distances and ranking.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(275300);
do $performance_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026035400') then
    raise exception 'PERFORMANCE_MIGRATION_ALREADY_RECORDED: 20261026035400';
  end if;
end;
$performance_guard$;

create or replace function public.theme_material_keys_for_tag(
  p_model text,
  p_per_type integer default 8,
  p_min_similarity double precision default 0.65,
  p_tag text default null
)
returns table (tag text, source_type text, source_id text, similarity double precision, origin text)
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_per_type is null or p_per_type < 1 or p_per_type > 30 then
    raise exception 'per_type must be between 1 and 30' using errcode = '22023';
  end if;
  if p_min_similarity is null or p_min_similarity < 0 or p_min_similarity > 1 then
    raise exception 'min_similarity must be between 0 and 1' using errcode = '22023';
  end if;

  return query
  with theme as (
    select v.tag, v.centroid
      from public.knowledge_tag_vocabulary v
     where v.model = p_model and (p_tag is null or v.tag = p_tag)
  ), tagged as (
    select t.tag, k.id as knowledge_id,
           case when t.tag = any(coalesce(k.tags, array[]::text[])) then 'own_tag' else 'auto_tag' end as origin,
           a.similarity
      from theme t
      join public.knowledge k on not k.archived
      left join public.knowledge_auto_tags a
        on a.knowledge_id = k.id and a.tag = t.tag and a.removed_at is null
     where t.tag = any(coalesce(k.tags, array[]::text[])) or a.knowledge_id is not null
  ), tagged_insights as (
    select tk.tag, i.id::text as source_id,
           case when e.embedding is null then null else 1 - (e.embedding <=> t.centroid) end as similarity
      from tagged tk
      join theme t on t.tag = tk.tag
      join public.knowledge_insights i on i.knowledge_id = tk.knowledge_id
      left join public.semantic_embeddings e
        on e.source_type = 'insight' and e.source_id = i.id::text and e.model = p_model
     where not exists (
       select 1 from public.theme_material_exclusions x
        where x.tag = tk.tag and x.source_type = 'insight' and x.source_id = i.id::text
     )
  ), nearby as (
    select t.tag, e.source_type, e.source_id,
           1 - (e.embedding <=> t.centroid) as similarity,
           row_number() over (partition by t.tag, e.source_type order by e.embedding <=> t.centroid) as rank
      from theme t
      cross join public.semantic_embeddings e
      left join public.knowledge_insights i on e.source_type = 'insight' and i.id::text = e.source_id
      left join public.knowledge k on k.id = i.knowledge_id
     where e.model = p_model
       and (e.source_type = 'journal' or (e.source_type = 'insight' and k.id is not null and not k.archived))
       and not exists (
         select 1 from public.theme_material_exclusions x
          where x.tag = t.tag and x.source_type = e.source_type and x.source_id = e.source_id
       )
       and not exists (
         select 1 from tagged_insights ti where ti.tag = t.tag and e.source_type = 'insight' and ti.source_id = e.source_id
       )
  )
  select tk.tag, 'knowledge'::text, tk.knowledge_id::text, tk.similarity, tk.origin from tagged tk
  union all
  select ti.tag, 'insight'::text, ti.source_id, ti.similarity, 'tagged_knowledge'::text from tagged_insights ti
  union all
  select n.tag, n.source_type, n.source_id, n.similarity, 'nearby'::text
    from nearby n
   where n.rank <= p_per_type and n.similarity >= p_min_similarity;
end
$$;

-- One theme's note with what to show, best first within each type. Empty for a tag that is not
-- in the vocabulary.
create or replace function public.list_theme_materials(
  p_tag text,
  p_model text,
  p_per_type integer default 8,
  p_min_similarity double precision default 0.65
)
returns table (
  source_type text,
  source_id text,
  title text,
  body text,
  meta text,
  knowledge_id uuid,
  entry_date date,
  similarity double precision,
  origin text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.source_type, m.source_id, s.title, s.body, s.meta, s.knowledge_id, s.entry_date, m.similarity, m.origin
    from public.theme_material_keys_for_tag(p_model, p_per_type, p_min_similarity, p_tag) m
    join public.semantic_sources() s on s.source_type = m.source_type and s.source_id = m.source_id
   where m.tag = p_tag
   order by array_position(array['insight', 'knowledge', 'journal'], m.source_type),
            array_position(array['own_tag', 'tagged_knowledge', 'auto_tag', 'nearby'], m.origin),
            m.similarity desc nulls last,
            s.title;
$$;

create or replace function public.theme_material_keys(
  p_model text, p_per_type integer default 8, p_min_similarity double precision default 0.65
)
returns table(tag text, source_type text, source_id text, similarity double precision, origin text)
language sql stable set search_path = public, pg_temp as $$
  select * from public.theme_material_keys_for_tag(p_model, p_per_type, p_min_similarity, null);
$$;
revoke all on function public.theme_material_keys_for_tag(text, integer, double precision, text) from public, anon, authenticated;
grant execute on function public.theme_material_keys_for_tag(text, integer, double precision, text) to service_role;
notify pgrst, 'reload schema';
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20261026035400','theme_material_scope',array[$performance_source_20261026035400$-- One-theme reads filter the vocabulary before cross joins, distances and ranking.
begin;
create or replace function public.theme_material_keys_for_tag(
  p_model text,
  p_per_type integer default 8,
  p_min_similarity double precision default 0.65,
  p_tag text default null
)
returns table (tag text, source_type text, source_id text, similarity double precision, origin text)
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_per_type is null or p_per_type < 1 or p_per_type > 30 then
    raise exception 'per_type must be between 1 and 30' using errcode = '22023';
  end if;
  if p_min_similarity is null or p_min_similarity < 0 or p_min_similarity > 1 then
    raise exception 'min_similarity must be between 0 and 1' using errcode = '22023';
  end if;

  return query
  with theme as (
    select v.tag, v.centroid
      from public.knowledge_tag_vocabulary v
     where v.model = p_model and (p_tag is null or v.tag = p_tag)
  ), tagged as (
    select t.tag, k.id as knowledge_id,
           case when t.tag = any(coalesce(k.tags, array[]::text[])) then 'own_tag' else 'auto_tag' end as origin,
           a.similarity
      from theme t
      join public.knowledge k on not k.archived
      left join public.knowledge_auto_tags a
        on a.knowledge_id = k.id and a.tag = t.tag and a.removed_at is null
     where t.tag = any(coalesce(k.tags, array[]::text[])) or a.knowledge_id is not null
  ), tagged_insights as (
    select tk.tag, i.id::text as source_id,
           case when e.embedding is null then null else 1 - (e.embedding <=> t.centroid) end as similarity
      from tagged tk
      join theme t on t.tag = tk.tag
      join public.knowledge_insights i on i.knowledge_id = tk.knowledge_id
      left join public.semantic_embeddings e
        on e.source_type = 'insight' and e.source_id = i.id::text and e.model = p_model
     where not exists (
       select 1 from public.theme_material_exclusions x
        where x.tag = tk.tag and x.source_type = 'insight' and x.source_id = i.id::text
     )
  ), nearby as (
    select t.tag, e.source_type, e.source_id,
           1 - (e.embedding <=> t.centroid) as similarity,
           row_number() over (partition by t.tag, e.source_type order by e.embedding <=> t.centroid) as rank
      from theme t
      cross join public.semantic_embeddings e
      left join public.knowledge_insights i on e.source_type = 'insight' and i.id::text = e.source_id
      left join public.knowledge k on k.id = i.knowledge_id
     where e.model = p_model
       and (e.source_type = 'journal' or (e.source_type = 'insight' and k.id is not null and not k.archived))
       and not exists (
         select 1 from public.theme_material_exclusions x
          where x.tag = t.tag and x.source_type = e.source_type and x.source_id = e.source_id
       )
       and not exists (
         select 1 from tagged_insights ti where ti.tag = t.tag and e.source_type = 'insight' and ti.source_id = e.source_id
       )
  )
  select tk.tag, 'knowledge'::text, tk.knowledge_id::text, tk.similarity, tk.origin from tagged tk
  union all
  select ti.tag, 'insight'::text, ti.source_id, ti.similarity, 'tagged_knowledge'::text from tagged_insights ti
  union all
  select n.tag, n.source_type, n.source_id, n.similarity, 'nearby'::text
    from nearby n
   where n.rank <= p_per_type and n.similarity >= p_min_similarity;
end
$$;

-- One theme's note with what to show, best first within each type. Empty for a tag that is not
-- in the vocabulary.
create or replace function public.list_theme_materials(
  p_tag text,
  p_model text,
  p_per_type integer default 8,
  p_min_similarity double precision default 0.65
)
returns table (
  source_type text,
  source_id text,
  title text,
  body text,
  meta text,
  knowledge_id uuid,
  entry_date date,
  similarity double precision,
  origin text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.source_type, m.source_id, s.title, s.body, s.meta, s.knowledge_id, s.entry_date, m.similarity, m.origin
    from public.theme_material_keys_for_tag(p_model, p_per_type, p_min_similarity, p_tag) m
    join public.semantic_sources() s on s.source_type = m.source_type and s.source_id = m.source_id
   where m.tag = p_tag
   order by array_position(array['insight', 'knowledge', 'journal'], m.source_type),
            array_position(array['own_tag', 'tagged_knowledge', 'auto_tag', 'nearby'], m.origin),
            m.similarity desc nulls last,
            s.title;
$$;

create or replace function public.theme_material_keys(
  p_model text, p_per_type integer default 8, p_min_similarity double precision default 0.65
)
returns table(tag text, source_type text, source_id text, similarity double precision, origin text)
language sql stable set search_path = public, pg_temp as $$
  select * from public.theme_material_keys_for_tag(p_model, p_per_type, p_min_similarity, null);
$$;
revoke all on function public.theme_material_keys_for_tag(text, integer, double precision, text) from public, anon, authenticated;
grant execute on function public.theme_material_keys_for_tag(text, integer, double precision, text) to service_role;
notify pgrst, 'reload schema';
commit;
$performance_source_20261026035400$]::text[]);
notify pgrst, 'reload schema';

commit;
