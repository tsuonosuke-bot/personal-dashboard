-- Questions collect their own materials (issues #94 / #95). A question (insight_groups) is
-- written by the learner; the knowledge app embeds its guiding_question with the same model
-- as semantic_embeddings (#45) and lists the nearest knowledge, insights and journal entries.
-- Nothing is confirmed by hand: the learner only removes what does not fit, and a removed item
-- never comes back for that question. Insights added by hand (insight_group_members) stay and
-- are left out of the automatic list so they are not shown twice.
begin;

create table if not exists public.question_embeddings (
  group_id bigint primary key references public.insight_groups(id) on delete cascade,
  -- sha256 of the guiding_question that was embedded; a different hash means the question changed.
  input_hash text not null,
  model text not null,
  embedding extensions.vector(1024) not null,
  embedded_at timestamptz not null default now()
);

create table if not exists public.question_material_exclusions (
  group_id bigint not null references public.insight_groups(id) on delete cascade,
  source_type text not null check (source_type in ('knowledge', 'insight', 'journal')),
  source_id text not null,
  excluded_at timestamptz not null default now(),
  primary key (group_id, source_type, source_id)
);

alter table public.question_embeddings enable row level security;
alter table public.question_material_exclusions enable row level security;
revoke all on table public.question_embeddings, public.question_material_exclusions from public, anon, authenticated;
grant select, insert, update, delete on table public.question_embeddings, public.question_material_exclusions to service_role;

comment on table public.question_embeddings is
  'Embedding of each question''s guiding_question (same model as semantic_embeddings), used to list its materials.';
comment on table public.question_material_exclusions is
  'Materials the learner removed from a question. They are never listed for that question again.';

-- The question text, its current hash and whether its embedding must be (re)made.
create or replace function public.question_material_state(p_group_id bigint, p_model text)
returns table (group_id bigint, guiding_question text, input_hash text, needs_embedding boolean)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select g.id,
         g.guiding_question,
         encode(sha256(convert_to(g.guiding_question, 'UTF8')), 'hex'),
         q.group_id is null
           or q.model <> p_model
           or q.input_hash <> encode(sha256(convert_to(g.guiding_question, 'UTF8')), 'hex')
    from public.insight_groups g
    left join public.question_embeddings q on q.group_id = g.id
   where g.id = p_group_id;
$$;

-- Saves the embedding only if the question has not changed since it was read.
create or replace function public.save_question_embedding(
  p_group_id bigint, p_input_hash text, p_model text, p_embedding text
)
returns boolean
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (
    select 1 from public.insight_groups g
     where g.id = p_group_id
       and encode(sha256(convert_to(g.guiding_question, 'UTF8')), 'hex') = p_input_hash
  ) then
    return false;
  end if;
  insert into public.question_embeddings (group_id, input_hash, model, embedding, embedded_at)
  values (p_group_id, p_input_hash, p_model, p_embedding::extensions.vector(1024), now())
  on conflict (group_id) do update
    set input_hash = excluded.input_hash,
        model = excluded.model,
        embedding = excluded.embedding,
        embedded_at = excluded.embedded_at;
  return true;
end
$$;

-- The nearest materials of each type for a question, best first. Archived knowledge (and its
-- insights), removed items and insights already added by hand are left out. Returns no rows
-- while the question has no current embedding.
create or replace function public.list_question_materials(p_group_id bigint, p_model text, p_per_type integer default 8)
returns table (
  source_type text,
  source_id text,
  title text,
  body text,
  meta text,
  knowledge_id uuid,
  entry_date date,
  similarity double precision
)
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_per_type is null or p_per_type < 1 or p_per_type > 30 then
    raise exception 'per_type must be between 1 and 30' using errcode = '22023';
  end if;

  return query
  with question as (
    select q.embedding
      from public.question_embeddings q
      join public.insight_groups g on g.id = q.group_id
     where q.group_id = p_group_id
       and q.model = p_model
       and q.input_hash = encode(sha256(convert_to(g.guiding_question, 'UTF8')), 'hex')
  ), ranked as (
    select s.source_type, s.source_id, s.title, s.body, s.meta, s.knowledge_id, s.entry_date,
           1 - (e.embedding <=> question.embedding) as similarity,
           row_number() over (partition by s.source_type order by e.embedding <=> question.embedding) as rank
      from question
      cross join public.semantic_embeddings e
      join public.semantic_sources() s on s.source_type = e.source_type and s.source_id = e.source_id
     where e.model = p_model
       and not s.archived
       and not exists (
         select 1 from public.question_material_exclusions x
          where x.group_id = p_group_id and x.source_type = s.source_type and x.source_id = s.source_id
       )
       and not (s.source_type = 'insight' and exists (
         select 1 from public.insight_group_members m
          where m.group_id = p_group_id and m.insight_id::text = s.source_id
       ))
  )
  select r.source_type, r.source_id, r.title, r.body, r.meta, r.knowledge_id, r.entry_date, r.similarity
    from ranked r
   where r.rank <= p_per_type
   order by array_position(array['insight', 'knowledge', 'journal'], r.source_type), r.similarity desc;
end
$$;

-- What the learner removed from a question, newest first, with what to show.
create or replace function public.list_question_exclusions(p_group_id bigint)
returns table (source_type text, source_id text, title text, body text, excluded_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select x.source_type, x.source_id, coalesce(s.title, '（削除済み）'), coalesce(s.body, ''), x.excluded_at
    from public.question_material_exclusions x
    left join public.semantic_sources() s on s.source_type = x.source_type and s.source_id = x.source_id
   where x.group_id = p_group_id
   order by x.excluded_at desc;
$$;

revoke all on function public.question_material_state(bigint, text) from public, anon, authenticated;
revoke all on function public.save_question_embedding(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.list_question_materials(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.list_question_exclusions(bigint) from public, anon, authenticated;
grant execute on function public.question_material_state(bigint, text) to service_role;
grant execute on function public.save_question_embedding(bigint, text, text, text) to service_role;
grant execute on function public.list_question_materials(bigint, text, integer) to service_role;
grant execute on function public.list_question_exclusions(bigint) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261006100000_question_materials', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
