-- Semantic search across knowledge, knowledge insights and daily journal entries (issue #45).
-- Embeddings for all three sources live in one table so they can be searched together and
-- later collected under questions and themes (#95). The text sent to the embedding model is
-- built here, in semantic_sources(), so the batch and the stale check always agree on it.
-- The embedding model (Voyage AI) is called from the knowledge app's Pages Functions; pg_cron
-- only starts that batch. daily_journal.embedding / embedding_input / embedded_at stay unused:
-- the journal-daily skill still resets embedded_at, so the columns are kept.
begin;

create table if not exists public.semantic_embeddings (
  source_type text not null check (source_type in ('knowledge', 'insight', 'journal')),
  -- knowledge.id (uuid), knowledge_insights.id (bigint) or daily_journal.entry_date (YYYY-MM-DD), as text.
  source_id text not null,
  -- md5 of semantic_sources().input_text at the time it was embedded; a different hash means stale.
  input_hash text not null,
  model text not null,
  embedding extensions.vector(1024) not null,
  embedded_at timestamptz not null default now(),
  primary key (source_type, source_id)
);

-- No ANN index: at under a few thousand rows an exact scan is fast, and an HNSW index would
-- drop rows when the type/archived filters are applied after the nearest-neighbour search.

alter table public.semantic_embeddings enable row level security;
revoke all on table public.semantic_embeddings from public, anon, authenticated;
grant select, insert, update, delete on table public.semantic_embeddings to service_role;

comment on table public.semantic_embeddings is
  'Embeddings of knowledge, knowledge_insights and daily_journal for semantic search. Written by the knowledge app''s embedding batch; input text comes from semantic_sources().';

-- Every searchable item with the text that is embedded for it and what to show in results.
create or replace function public.semantic_sources()
returns table (
  source_type text,
  source_id text,
  title text,
  body text,
  meta text,
  knowledge_id uuid,
  entry_date date,
  archived boolean,
  input_text text,
  input_hash text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with rows as (
    select 'knowledge'::text as source_type,
           k.id::text as source_id,
           k.title,
           coalesce(k.explanation, '') as body,
           k.category as meta,
           k.id as knowledge_id,
           null::date as entry_date,
           k.archived,
           concat_ws(E'\n', k.title, nullif(btrim(k.explanation), ''), 'カテゴリ: ' || nullif(k.category, '')) as input_text
      from public.knowledge k
    union all
    select 'insight',
           i.id::text,
           k.title,
           i.body,
           '示唆',
           k.id,
           null::date,
           k.archived,
           concat_ws(E'\n', i.body, '元のナレッジ: ' || k.title)
      from public.knowledge_insights i
      join public.knowledge k on k.id = i.knowledge_id
    union all
    select 'journal',
           to_char(j.entry_date, 'YYYY-MM-DD'),
           to_char(j.entry_date, 'YYYY-MM-DD') || 'の日記',
           coalesce(j.summary, ''),
           nullif(array_to_string(j.themes, '・'), ''),
           null::uuid,
           j.entry_date,
           false,
           concat_ws(E'\n',
             nullif(btrim(j.summary), ''),
             nullif(btrim(j.emotion_summary), ''),
             'テーマ: ' || nullif(array_to_string(j.themes, '、'), ''),
             '登場: ' || nullif(array_to_string(j.entities, '、'), ''))
      from public.daily_journal j
  )
  select r.source_type, r.source_id, r.title, r.body, r.meta, r.knowledge_id, r.entry_date, r.archived,
         r.input_text, md5(r.input_text)
    from rows r
   where btrim(r.input_text) <> '';
$$;

-- Items whose embedding is missing, stale (text changed) or from another model, missing ones first.
-- Embeddings whose source was deleted are removed here, so the batch needs no separate cleanup.
create or replace function public.pick_semantic_embedding_targets(p_model text, p_limit integer)
returns table (source_type text, source_id text, input_text text, input_hash text)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_model is null or btrim(p_model) = '' then
    raise exception 'model is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit must be between 1 and 1000' using errcode = '22023';
  end if;

  delete from public.semantic_embeddings e
   where not exists (
     select 1 from public.semantic_sources() s
      where s.source_type = e.source_type and s.source_id = e.source_id
   );

  return query
  select s.source_type, s.source_id, s.input_text, s.input_hash
    from public.semantic_sources() s
    left join public.semantic_embeddings e
      on e.source_type = s.source_type and e.source_id = s.source_id
   where e.source_id is null or e.input_hash <> s.input_hash or e.model <> p_model
   order by (e.source_id is null) desc, s.source_type, s.source_id
   limit p_limit;
end
$$;

-- Saves embeddings from the batch. An item whose text changed after it was picked is skipped
-- (the next run picks it again), so a slow batch never stores a vector for outdated text.
-- p_items: [{source_type, source_id, input_hash, embedding: [1024 numbers]}]
create or replace function public.save_semantic_embeddings(p_model text, p_items jsonb)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_saved integer;
begin
  if p_model is null or btrim(p_model) = '' then
    raise exception 'model is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  with items as (
    select x.source_type, x.source_id, x.input_hash,
           (x.embedding::text)::extensions.vector(1024) as embedding
      from jsonb_to_recordset(p_items) as x(source_type text, source_id text, input_hash text, embedding jsonb)
  ), fresh as (
    select i.*
      from items i
      join public.semantic_sources() s
        on s.source_type = i.source_type and s.source_id = i.source_id and s.input_hash = i.input_hash
  ), saved as (
    insert into public.semantic_embeddings (source_type, source_id, input_hash, model, embedding, embedded_at)
    select f.source_type, f.source_id, f.input_hash, p_model, f.embedding, now()
      from fresh f
    on conflict (source_type, source_id) do update
      set input_hash = excluded.input_hash,
          model = excluded.model,
          embedding = excluded.embedding,
          embedded_at = excluded.embedded_at
    returning 1
  )
  select count(*)::integer into v_saved from saved;

  return v_saved;
end
$$;

-- Nearest items to a query embedding (cosine). Archived knowledge and its insights are left out,
-- and only embeddings from the given model are compared.
create or replace function public.search_semantic(
  p_embedding text,
  p_model text,
  p_types text[] default array['knowledge', 'insight', 'journal'],
  p_limit integer default 20
)
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
declare
  v_query extensions.vector(1024);
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;
  v_query := p_embedding::extensions.vector(1024);

  return query
  select s.source_type, s.source_id, s.title, s.body, s.meta, s.knowledge_id, s.entry_date,
         1 - (e.embedding <=> v_query) as similarity
    from public.semantic_embeddings e
    join public.semantic_sources() s
      on s.source_type = e.source_type and s.source_id = e.source_id
   where e.model = p_model
     and not s.archived
     and e.source_type = any(coalesce(p_types, array['knowledge', 'insight', 'journal']))
   order by e.embedding <=> v_query
   limit p_limit;
end
$$;

-- How much of each source type is embedded with the current text and model.
create or replace function public.get_semantic_index_status(p_model text)
returns table (source_type text, total integer, embedded integer, last_embedded_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select t.source_type,
         count(s.source_id)::integer,
         count(e.source_id) filter (where e.input_hash = s.input_hash and e.model = p_model)::integer,
         max(e.embedded_at)
    from unnest(array['knowledge', 'insight', 'journal']) as t(source_type)
    left join public.semantic_sources() s on s.source_type = t.source_type and not s.archived
    left join public.semantic_embeddings e on e.source_type = s.source_type and e.source_id = s.source_id
   group by t.source_type
   order by array_position(array['knowledge', 'insight', 'journal'], t.source_type);
$$;

-- pg_cron entry point. Uses the same Vault secret as the review batches.
create or replace function public.trigger_embedding_batch()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token text;
begin
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'review_batch_token';
  if v_token is null or char_length(v_token) < 32 then
    raise warning 'review_batch_token is not configured in Vault';
    return null;
  end if;
  return net.http_post(
    url := 'https://knowledge-50b.pages.dev/api/embedding-batch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Review-Batch-Token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end
$$;

revoke all on function public.semantic_sources() from public, anon, authenticated;
revoke all on function public.pick_semantic_embedding_targets(text, integer) from public, anon, authenticated;
revoke all on function public.save_semantic_embeddings(text, jsonb) from public, anon, authenticated;
revoke all on function public.search_semantic(text, text, text[], integer) from public, anon, authenticated;
revoke all on function public.get_semantic_index_status(text) from public, anon, authenticated;
revoke all on function public.trigger_embedding_batch() from public, anon, authenticated;
grant execute on function public.semantic_sources() to service_role;
grant execute on function public.pick_semantic_embedding_targets(text, integer) to service_role;
grant execute on function public.save_semantic_embeddings(text, jsonb) to service_role;
grant execute on function public.search_semantic(text, text, text[], integer) to service_role;
grant execute on function public.get_semantic_index_status(text) to service_role;
grant execute on function public.trigger_embedding_batch() to service_role;

comment on column public.daily_journal.embedding is
  '未使用。意味検索の埋め込みは semantic_embeddings（source_type = ''journal''）に置く（#45）。';
comment on column public.daily_journal.embedding_input is
  '未使用。埋め込む文は semantic_sources() が summary・emotion_summary・themes・entities から作る（#45）。';
comment on column public.daily_journal.embedded_at is
  '未使用。journal-dailyスキルが再処理時にNULLへ戻すため列は残す。埋め込みの鮮度は semantic_embeddings.input_hash で判定する（#45）。';

-- Every hour at :40, between the review generation runs. Without VOYAGE_API_KEY the app
-- answers "skipped", so no cost is spent until the key is set.
select cron.schedule('semantic-embeddings', '40 * * * *', $job$select public.trigger_embedding_batch()$job$);

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261005130000_semantic_embeddings', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
