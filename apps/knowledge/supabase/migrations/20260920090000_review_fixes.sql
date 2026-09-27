-- 2026-09-20 full review fixes.
-- Apply to the knowledge-db project before deploying the matching Pages build.
begin;

-- Optimistic concurrency for user-visible knowledge fields and review state.
alter table public.knowledge
  add column if not exists content_version bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge'::regclass
      and conname = 'knowledge_content_version_positive'
  ) then
    alter table public.knowledge
      add constraint knowledge_content_version_positive check (content_version >= 1);
  end if;
end
$$;

create or replace function public.bump_knowledge_content_version()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.content_version := old.content_version + 1;
  return new;
end
$$;

drop trigger if exists knowledge_content_version_trigger on public.knowledge;
create trigger knowledge_content_version_trigger
before update of title, explanation, source_note, category, mastery, tags, next_review_on, archived
on public.knowledge
for each row execute function public.bump_knowledge_content_version();

-- Fetch exactly the latest N useful notes for every selected knowledge item.
create or replace function public.get_recent_quiz_notes(
  p_knowledge_ids uuid[],
  p_per_item integer default 2
)
returns table(
  knowledge_id uuid,
  quality smallint,
  verdict text,
  note text,
  asked_on date
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with ranked as (
    select
      q.knowledge_id,
      q.quality,
      q.verdict,
      q.note,
      q.asked_on,
      row_number() over (
        partition by q.knowledge_id
        order by q.asked_on desc, q.id desc
      ) as position
    from public.quiz_log q
    where q.knowledge_id = any(p_knowledge_ids)
      and q.note is not null
      and btrim(q.note) <> ''
  )
  select r.knowledge_id, r.quality, r.verdict, r.note, r.asked_on
  from ranked r
  where r.position <= greatest(1, least(coalesce(p_per_item, 2), 10))
  order by r.knowledge_id, r.asked_on desc;
$$;

-- Serialize each knowledge row and decide "already recorded today" inside the
-- same transaction that performs the SM-2 update. Sorted locking avoids a
-- deadlock when two batches contain the same IDs in a different order.
create or replace function public.record_answers_batch_once(p_answers jsonb)
returns table(id uuid, next_review_on date, recorded boolean)
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  answer record;
  current_knowledge public.knowledge;
  today date := public.jst_today();
begin
  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'p_answers must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_answers) < 1
    or jsonb_array_length(p_answers) > 30 then
    raise exception 'p_answers must contain 1 to 30 items' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct parsed.id)
    from jsonb_to_recordset(p_answers) as parsed(id uuid)
  ) then
    raise exception 'p_answers contains duplicate ids' using errcode = '22023';
  end if;

  for answer in
    select parsed.id, parsed.quality, parsed.verdict, parsed.note, parsed.format
    from jsonb_to_recordset(p_answers) as parsed(
      id uuid,
      quality smallint,
      verdict text,
      note text,
      format text
    )
    order by parsed.id
  loop
    if answer.id is null
      or answer.quality is null or answer.quality < 0 or answer.quality > 5
      or answer.verdict is null or answer.verdict not in ('正解', '部分正解', '不正解')
      or answer.format is null or answer.format not in ('一問一答', '四択', '記述説明', '産出') then
      raise exception 'invalid answer values' using errcode = '22023';
    end if;

    select k.*
    into current_knowledge
    from public.knowledge k
    where k.id = answer.id and k.archived = false
    for update;

    if not found then
      raise exception 'active knowledge % was not found', answer.id using errcode = 'P0002';
    end if;

    if exists (
      select 1 from public.quiz_log q
      where q.knowledge_id = answer.id and q.asked_on = today
    ) then
      id := current_knowledge.id;
      next_review_on := current_knowledge.next_review_on;
      recorded := false;
      return next;
    else
      current_knowledge := public.record_answer(
        answer.id,
        answer.quality,
        answer.verdict,
        answer.note,
        answer.format
      );
      id := current_knowledge.id;
      next_review_on := current_knowledge.next_review_on;
      recorded := true;
      return next;
    end if;
  end loop;
end
$$;

-- One-time exchange store for cross-site SSO handoff tokens.
create table if not exists public.dashboard_handoff_nonce (
  nonce text primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint dashboard_handoff_nonce_length check (length(nonce) between 20 and 128)
);

alter table public.dashboard_handoff_nonce enable row level security;
revoke all privileges on table public.dashboard_handoff_nonce from public, anon, authenticated;
grant select, insert, delete on table public.dashboard_handoff_nonce to service_role;

create or replace function public.consume_dashboard_handoff_nonce(
  p_nonce text,
  p_expires_at bigint
)
returns boolean
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  inserted_count integer;
begin
  if p_nonce !~ '^[A-Za-z0-9_-]{20,128}$'
    or p_expires_at < extract(epoch from now())::bigint - 5
    or p_expires_at > extract(epoch from now())::bigint + 120 then
    return false;
  end if;

  delete from public.dashboard_handoff_nonce
  where expires_at < now() - interval '1 day';

  insert into public.dashboard_handoff_nonce(nonce, expires_at)
  values (p_nonce, to_timestamp(p_expires_at))
  on conflict (nonce) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end
$$;

revoke all on function public.consume_dashboard_handoff_nonce(text, bigint) from public, anon, authenticated;
grant execute on function public.consume_dashboard_handoff_nonce(text, bigint) to service_role;
revoke all on function public.record_answers_batch_once(jsonb) from public, anon, authenticated;
grant execute on function public.record_answers_batch_once(jsonb) to service_role;
revoke all on function public.get_recent_quiz_notes(uuid[], integer) from public, anon, authenticated;
grant execute on function public.get_recent_quiz_notes(uuid[], integer) to service_role;

commit;
