-- Notes by question and theme (issue #96). A note gathers knowledge, insights and journal entries
-- for one question (insight_groups, materials from #95) or one theme. A theme is a tag of the
-- automatic-tag vocabulary (#93); its name is the tag, so no name is generated. A theme collects
--   * knowledge: active cards with the tag, set by the owner (knowledge.tags) or automatically
--     (knowledge_auto_tags, not removed). Removing an automatic tag takes the card out of the note.
--   * insights: every insight on those cards, plus other insights close to the tag's centroid.
--   * journals: entries close to the tag's centroid.
-- Nothing is confirmed by hand. Insights and journals the owner removes from a theme are kept in
-- theme_material_exclusions and never come back for that theme.
--
-- The review can also be limited to the knowledge of one note: serve_review_queue_filtered takes
-- the knowledge ids, and serve_review_queue(integer, text[]) stays as it was (the knowledge-quiz
-- skill checks that signature) by calling it without ids.
begin;

create table if not exists public.theme_material_exclusions (
  tag text not null references public.knowledge_tag_vocabulary(tag) on delete cascade on update cascade,
  source_type text not null check (source_type in ('insight', 'journal')),
  source_id text not null,
  excluded_at timestamptz not null default now(),
  primary key (tag, source_type, source_id)
);

alter table public.theme_material_exclusions enable row level security;
revoke all on table public.theme_material_exclusions from public, anon, authenticated;
grant select, insert, update, delete on table public.theme_material_exclusions to service_role;

comment on table public.theme_material_exclusions is
  'Insights and journal entries the owner removed from a theme note (#96). They are never listed for that theme again.';

-- What every theme collects, as keys. One place decides membership so that the list of notes
-- (counts) and a single note always agree. origin is own_tag / auto_tag for knowledge,
-- tagged_knowledge for insights on that knowledge, and nearby for items close to the centroid.
create or replace function public.theme_material_keys(
  p_model text,
  p_per_type integer default 8,
  p_min_similarity double precision default 0.65
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
     where v.model = p_model
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
    from public.theme_material_keys(p_model, p_per_type, p_min_similarity) m
    join public.semantic_sources() s on s.source_type = m.source_type and s.source_id = m.source_id
   where m.tag = p_tag
   order by array_position(array['insight', 'knowledge', 'journal'], m.source_type),
            array_position(array['own_tag', 'tagged_knowledge', 'auto_tag', 'nearby'], m.origin),
            m.similarity desc nulls last,
            s.title;
$$;

-- What the owner removed from a theme, newest first, with what to show. Knowledge is removed by
-- removing its automatic tag, so removed automatic tags of active knowledge are listed too.
create or replace function public.list_theme_exclusions(p_tag text)
returns table (source_type text, source_id text, title text, body text, excluded_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select r.source_type, r.source_id, r.title, r.body, r.excluded_at
    from (
      select x.source_type, x.source_id, coalesce(s.title, '（削除済み）') as title, coalesce(s.body, '') as body, x.excluded_at
        from public.theme_material_exclusions x
        left join public.semantic_sources() s on s.source_type = x.source_type and s.source_id = x.source_id
       where x.tag = p_tag
      union all
      select 'knowledge', k.id::text, k.title, coalesce(k.explanation, ''), a.removed_at
        from public.knowledge_auto_tags a
        join public.knowledge k on k.id = a.knowledge_id
       where a.tag = p_tag and a.removed_at is not null and not k.archived
    ) r
   order by r.excluded_at desc;
$$;

-- The list of notes with counts: every question and every theme. A question's counts include the
-- insights added by hand; materials_ready is false while its question text has no current
-- embedding (the counts then hold only the hand-added insights until the note is opened).
create or replace function public.list_note_topics(
  p_model text,
  p_question_per_type integer default 8,
  p_question_min_similarity double precision default 0.45,
  p_theme_per_type integer default 8,
  p_theme_min_similarity double precision default 0.65
)
returns table (
  kind text,
  key text,
  title text,
  guiding_question text,
  knowledge_count integer,
  insight_count integer,
  journal_count integer,
  materials_ready boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with question_counts as (
    select g.id, g.title, g.guiding_question,
           exists (
             select 1 from public.question_embeddings q
              where q.group_id = g.id and q.model = p_model
                and q.input_hash = encode(sha256(convert_to(g.guiding_question, 'UTF8')), 'hex')
           ) as ready,
           count(*) filter (where m.source_type = 'knowledge') as knowledge_count,
           count(*) filter (where m.source_type = 'insight')
             + (select count(*) from public.insight_group_members gm where gm.group_id = g.id) as insight_count,
           count(*) filter (where m.source_type = 'journal') as journal_count
      from public.insight_groups g
      left join lateral public.list_question_materials(g.id, p_model, p_question_per_type) m
        on m.similarity >= p_question_min_similarity
     group by g.id
  ), theme_counts as (
    select m.tag,
           count(*) filter (where m.source_type = 'knowledge') as knowledge_count,
           count(*) filter (where m.source_type = 'insight') as insight_count,
           count(*) filter (where m.source_type = 'journal') as journal_count
      from public.theme_material_keys(p_model, p_theme_per_type, p_theme_min_similarity) m
     group by m.tag
  )
  select 'question'::text, q.id::text, q.title, q.guiding_question,
         q.knowledge_count::integer, q.insight_count::integer, q.journal_count::integer, q.ready
    from question_counts q
  union all
  select 'theme'::text, v.tag, v.tag, null::text,
         coalesce(c.knowledge_count, 0)::integer, coalesce(c.insight_count, 0)::integer,
         coalesce(c.journal_count, 0)::integer, true
    from public.knowledge_tag_vocabulary v
    left join theme_counts c on c.tag = v.tag
   where v.model = p_model;
$$;

-- serve_review_queue with an optional set of knowledge ids (a note's review). Same order and rules.
create or replace function public.serve_review_queue_filtered(
  p_limit integer default 15,
  p_categories text[] default null,
  p_knowledge_ids uuid[] default null
)
returns table(
  id bigint,
  knowledge_id uuid,
  format text,
  question text,
  choices jsonb,
  category text,
  pool text
)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.discard_stale_review_questions();
  return query
  with params as (
    select greatest(1, least(coalesce(p_limit, 15), 30))::integer as batch_limit
  ),
  eligible as (
    select
      q.id as item_id, q.knowledge_id as card_id, q.format as item_format, q.question as item_question,
      q.choices as item_choices, k.category as card_category, k.relearning_quality, k.priority,
      k.next_review_at, k.accuracy, k.times_asked,
      case
        when k.relearning_stage is not null then 'R'::text
        when k.times_asked = 0 then 'B'::text
        else 'A'::text
      end as card_pool
    from public.review_queue q
    join public.knowledge k on k.id = q.knowledge_id
    where q.status = 'ready'
      and k.archived = false
      and k.next_review_at <= now()
      and (p_categories is null or k.category = any(p_categories))
      and (p_knowledge_ids is null or k.id = any(p_knowledge_ids))
  ),
  counts as (
    select count(*) filter (where card_pool <> 'R')::integer as normal_count from eligible
  ),
  retry_ranked as (
    select e.*, row_number() over (
      order by
        e.relearning_quality asc nulls last,
        case e.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
        e.accuracy asc nulls first,
        e.next_review_at,
        e.item_id
    ) as rank_no
    from eligible e where e.card_pool = 'R'
  ),
  retry_selected as (
    select r.* from retry_ranked r cross join counts c cross join params p
    where r.rank_no <= p.batch_limit - least(5, c.normal_count, p.batch_limit)
  ),
  normal_ranked as (
    select e.*, row_number() over (
      order by
        case e.card_pool when 'A' then 0 else 1 end,
        case e.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
        e.next_review_at,
        e.accuracy asc nulls first,
        e.times_asked,
        e.item_id
    ) as rank_no
    from eligible e where e.card_pool <> 'R'
  ),
  normal_selected as (
    select n.* from normal_ranked n cross join params p
    where n.rank_no <= p.batch_limit - (select count(*) from retry_selected)
  ),
  selected as (
    select * from retry_selected
    union all
    select * from normal_selected
  )
  select s.item_id, s.card_id, s.item_format, s.item_question, s.item_choices, s.card_category, s.card_pool
  from selected s
  order by
    case s.card_pool when 'R' then 0 when 'A' then 1 else 2 end,
    case when s.card_pool = 'R' then s.relearning_quality else 4 end asc nulls last,
    case s.priority when '最高' then 0 when '高' then 1 when '中' then 2 when '低' then 3 else 4 end,
    s.next_review_at,
    s.item_id;
end
$$;

create or replace function public.serve_review_queue(
  p_limit integer default 15,
  p_categories text[] default null
)
returns table(
  id bigint,
  knowledge_id uuid,
  format text,
  question text,
  choices jsonb,
  category text,
  pool text
)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query select * from public.serve_review_queue_filtered(p_limit, p_categories, null);
end
$$;

revoke all on function public.theme_material_keys(text, integer, double precision) from public, anon, authenticated;
revoke all on function public.list_theme_materials(text, text, integer, double precision) from public, anon, authenticated;
revoke all on function public.list_theme_exclusions(text) from public, anon, authenticated;
revoke all on function public.list_note_topics(text, integer, double precision, integer, double precision) from public, anon, authenticated;
revoke all on function public.serve_review_queue_filtered(integer, text[], uuid[]) from public, anon, authenticated;
revoke all on function public.serve_review_queue(integer, text[]) from public, anon, authenticated;
grant execute on function public.theme_material_keys(text, integer, double precision) to service_role;
grant execute on function public.list_theme_materials(text, text, integer, double precision) to service_role;
grant execute on function public.list_theme_exclusions(text) to service_role;
grant execute on function public.list_note_topics(text, integer, double precision, integer, double precision) to service_role;
grant execute on function public.serve_review_queue_filtered(integer, text[], uuid[]) to service_role;
grant execute on function public.serve_review_queue(integer, text[]) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261008100000_theme_notes', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
