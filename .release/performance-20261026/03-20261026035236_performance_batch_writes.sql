-- Bound HTTP work while keeping each existing answer transaction and retry semantics.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(275300);
do $performance_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026035236') then
    raise exception 'PERFORMANCE_MIGRATION_ALREADY_RECORDED: 20261026035236';
  end if;
end;
$performance_guard$;


create or replace function public.add_insight_group_members(p_group_id bigint, p_insight_ids bigint[], p_expected_updated_at timestamptz)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_group public.insight_groups;
  v_id bigint;
  v_members jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if cardinality(p_insight_ids) is null or cardinality(p_insight_ids) not between 1 and 100 then
    raise exception 'expected 1-100 insight ids' using errcode = '22023';
  end if;
  select * into v_group from public.insight_groups g where g.id = p_group_id for update;
  if not found then return jsonb_build_object('group', null, 'members', '[]'::jsonb, 'failedIds', to_jsonb(p_insight_ids)); end if;
  if p_expected_updated_at is null or v_group.updated_at <> p_expected_updated_at then
    return jsonb_build_object('group', to_jsonb(v_group), 'conflict', true);
  end if;
  for v_id in select distinct x from unnest(p_insight_ids) x order by x loop
    begin
      if v_id is null or v_id < 1 then raise exception 'invalid insight id'; end if;
      -- The FK and row lock protect against a concurrent deletion. Duplicate inserts do
      -- not fire the membership trigger and therefore do not advance updated_at.
      insert into public.insight_group_members(group_id, insight_id) values (p_group_id, v_id)
      on conflict (group_id, insight_id) do nothing;
      v_members := v_members || jsonb_build_object('group_id', p_group_id, 'insight_id', v_id);
    exception when foreign_key_violation or check_violation or raise_exception then
      v_failed := v_failed || to_jsonb(v_id);
    end;
  end loop;
  select * into v_group from public.insight_groups g where g.id = p_group_id;
  return jsonb_build_object('group', to_jsonb(v_group), 'members', v_members, 'failedIds', v_failed);
end $$;

-- Durable follow-up work is inserted in the same savepoint as a newly saved grade.
-- A disconnected client or a lost HTTP response cannot lose the regeneration request.
create table public.review_generation_jobs (
  item_id bigint primary key references public.review_queue(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done')),
  generation_run_id bigint references public.review_batch_runs(id) on delete set null,
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.review_generation_jobs enable row level security;
revoke all on public.review_generation_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.review_generation_jobs to service_role;
create index review_generation_jobs_pending_idx on public.review_generation_jobs(next_attempt_at) where status <> 'done';

create or replace function public.record_review_grades_batch(p_grades jsonb, p_errors jsonb default '[]')
returns table(item_id bigint, recorded boolean, status text, relearning boolean, error text)
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_row record;
  v_id bigint;
  v_error text;
begin
  if jsonb_typeof(p_grades) <> 'array' or jsonb_typeof(p_errors) <> 'array'
    or jsonb_array_length(p_grades) > 200 or jsonb_array_length(p_errors) > 200 then
    raise exception 'invalid grade batch' using errcode = '22023';
  end if;
  -- Stable queue-row order avoids opposing batch lock orders. record_review_grade
  -- remains the only implementation of archive/stale/once/scheduling rules.
  for v in select x from jsonb_array_elements(p_grades) x order by (x->>'item_id')::bigint loop
    v_id := (v->>'item_id')::bigint;
    begin
      select * into strict v_row from public.record_review_grade(v_id, (v->>'quality')::smallint,
        v->>'verdict', v->>'note', v->>'correct_answer', v->>'explanation');
      if v_row.recorded and v_row.status = 'graded' and (v->>'quality')::integer <= 3 then
        insert into public.review_generation_jobs(item_id) values (v_id) on conflict do nothing;
      end if;
      return query select v_id, v_row.recorded::boolean, v_row.status::text,
        (v_row.recorded and v_row.status = 'graded' and (v->>'quality')::integer <= 3), null::text;
    exception when others then
      get stacked diagnostics v_error = message_text;
      perform public.release_review_answer(v_id, v_error);
      return query select v_id, false, 'failed'::text, false, left(v_error, 1000);
    end;
  end loop;
  for v in select x from jsonb_array_elements(p_errors) x order by (x->>'item_id')::bigint loop
    v_id := (v->>'item_id')::bigint;
    v_error := left(v->>'error', 1000);
    perform public.release_review_answer(v_id, v_error);
    return query select v_id, false, 'failed'::text, false, v_error;
  end loop;
end $$;

-- A run is reserved before work is handed to waitUntil. Existing generation locks
-- and the recorded run survive response completion; cron also claims pending work.
create or replace function public.claim_relearning_generation()
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare v_run bigint;
begin
  if not exists (select 1 from public.review_generation_jobs j left join public.review_batch_runs r
      on r.id = j.generation_run_id where j.status = 'pending' and j.next_attempt_at <= now()
      or j.status = 'running' and (r.status <> 'running' or r.id is null or r.started_at < now() - interval '15 minutes')) then
    return null;
  end if;
  v_run := public.begin_review_batch('generate', 'after_grade');
  if v_run is null then return null; end if;
  update public.review_generation_jobs j set status = 'running', generation_run_id = v_run, updated_at = now()
    where j.status = 'pending' and j.next_attempt_at <= now()
       or j.status = 'running' and not exists (select 1 from public.review_batch_runs r
            where r.id = j.generation_run_id and r.status = 'running');
  return v_run;
end $$;

create or replace function public.attach_review_generation_jobs(p_run_id bigint)
returns void language sql set search_path = public, pg_temp as $$
  update public.review_generation_jobs j set status = 'running', generation_run_id = p_run_id, updated_at = now()
   where (j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'running' and not exists
     (select 1 from public.review_batch_runs r where r.id = j.generation_run_id and r.status = 'running'));
$$;

create or replace function public.finish_review_generation_jobs(p_run_id bigint, p_succeeded boolean)
returns void language sql set search_path = public, pg_temp as $$
  update public.review_generation_jobs set status = case when p_succeeded then 'done' else 'pending' end,
    next_attempt_at = case when p_succeeded then now() else now() + interval '1 minute' end, updated_at = now()
   where generation_run_id = p_run_id and status = 'running';
  delete from public.review_generation_jobs where status = 'done' and updated_at < now() - interval '30 days';
$$;

revoke all on function public.add_insight_group_members(bigint, bigint[], timestamptz) from public, anon, authenticated;
revoke all on function public.record_review_grades_batch(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_relearning_generation() from public, anon, authenticated;
revoke all on function public.attach_review_generation_jobs(bigint) from public, anon, authenticated;
revoke all on function public.finish_review_generation_jobs(bigint, boolean) from public, anon, authenticated;
grant execute on function public.add_insight_group_members(bigint, bigint[], timestamptz) to service_role;
grant execute on function public.record_review_grades_batch(jsonb, jsonb) to service_role;
grant execute on function public.claim_relearning_generation() to service_role;
grant execute on function public.attach_review_generation_jobs(bigint) to service_role;
grant execute on function public.finish_review_generation_jobs(bigint, boolean) to service_role;
notify pgrst, 'reload schema';
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20261026035236','performance_batch_writes',array[$performance_source_20261026035236$-- Bound HTTP work while keeping each existing answer transaction and retry semantics.
begin;

create or replace function public.add_insight_group_members(p_group_id bigint, p_insight_ids bigint[], p_expected_updated_at timestamptz)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_group public.insight_groups;
  v_id bigint;
  v_members jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if cardinality(p_insight_ids) is null or cardinality(p_insight_ids) not between 1 and 100 then
    raise exception 'expected 1-100 insight ids' using errcode = '22023';
  end if;
  select * into v_group from public.insight_groups g where g.id = p_group_id for update;
  if not found then return jsonb_build_object('group', null, 'members', '[]'::jsonb, 'failedIds', to_jsonb(p_insight_ids)); end if;
  if p_expected_updated_at is null or v_group.updated_at <> p_expected_updated_at then
    return jsonb_build_object('group', to_jsonb(v_group), 'conflict', true);
  end if;
  for v_id in select distinct x from unnest(p_insight_ids) x order by x loop
    begin
      if v_id is null or v_id < 1 then raise exception 'invalid insight id'; end if;
      -- The FK and row lock protect against a concurrent deletion. Duplicate inserts do
      -- not fire the membership trigger and therefore do not advance updated_at.
      insert into public.insight_group_members(group_id, insight_id) values (p_group_id, v_id)
      on conflict (group_id, insight_id) do nothing;
      v_members := v_members || jsonb_build_object('group_id', p_group_id, 'insight_id', v_id);
    exception when foreign_key_violation or check_violation or raise_exception then
      v_failed := v_failed || to_jsonb(v_id);
    end;
  end loop;
  select * into v_group from public.insight_groups g where g.id = p_group_id;
  return jsonb_build_object('group', to_jsonb(v_group), 'members', v_members, 'failedIds', v_failed);
end $$;

-- Durable follow-up work is inserted in the same savepoint as a newly saved grade.
-- A disconnected client or a lost HTTP response cannot lose the regeneration request.
create table public.review_generation_jobs (
  item_id bigint primary key references public.review_queue(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done')),
  generation_run_id bigint references public.review_batch_runs(id) on delete set null,
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.review_generation_jobs enable row level security;
revoke all on public.review_generation_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.review_generation_jobs to service_role;
create index review_generation_jobs_pending_idx on public.review_generation_jobs(next_attempt_at) where status <> 'done';

create or replace function public.record_review_grades_batch(p_grades jsonb, p_errors jsonb default '[]')
returns table(item_id bigint, recorded boolean, status text, relearning boolean, error text)
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_row record;
  v_id bigint;
  v_error text;
begin
  if jsonb_typeof(p_grades) <> 'array' or jsonb_typeof(p_errors) <> 'array'
    or jsonb_array_length(p_grades) > 200 or jsonb_array_length(p_errors) > 200 then
    raise exception 'invalid grade batch' using errcode = '22023';
  end if;
  -- Stable queue-row order avoids opposing batch lock orders. record_review_grade
  -- remains the only implementation of archive/stale/once/scheduling rules.
  for v in select x from jsonb_array_elements(p_grades) x order by (x->>'item_id')::bigint loop
    v_id := (v->>'item_id')::bigint;
    begin
      select * into strict v_row from public.record_review_grade(v_id, (v->>'quality')::smallint,
        v->>'verdict', v->>'note', v->>'correct_answer', v->>'explanation');
      if v_row.recorded and v_row.status = 'graded' and (v->>'quality')::integer <= 3 then
        insert into public.review_generation_jobs(item_id) values (v_id) on conflict do nothing;
      end if;
      return query select v_id, v_row.recorded::boolean, v_row.status::text,
        (v_row.recorded and v_row.status = 'graded' and (v->>'quality')::integer <= 3), null::text;
    exception when others then
      get stacked diagnostics v_error = message_text;
      perform public.release_review_answer(v_id, v_error);
      return query select v_id, false, 'failed'::text, false, left(v_error, 1000);
    end;
  end loop;
  for v in select x from jsonb_array_elements(p_errors) x order by (x->>'item_id')::bigint loop
    v_id := (v->>'item_id')::bigint;
    v_error := left(v->>'error', 1000);
    perform public.release_review_answer(v_id, v_error);
    return query select v_id, false, 'failed'::text, false, v_error;
  end loop;
end $$;

-- A run is reserved before work is handed to waitUntil. Existing generation locks
-- and the recorded run survive response completion; cron also claims pending work.
create or replace function public.claim_relearning_generation()
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare v_run bigint;
begin
  if not exists (select 1 from public.review_generation_jobs j left join public.review_batch_runs r
      on r.id = j.generation_run_id where j.status = 'pending' and j.next_attempt_at <= now()
      or j.status = 'running' and (r.status <> 'running' or r.id is null or r.started_at < now() - interval '15 minutes')) then
    return null;
  end if;
  v_run := public.begin_review_batch('generate', 'after_grade');
  if v_run is null then return null; end if;
  update public.review_generation_jobs j set status = 'running', generation_run_id = v_run, updated_at = now()
    where j.status = 'pending' and j.next_attempt_at <= now()
       or j.status = 'running' and not exists (select 1 from public.review_batch_runs r
            where r.id = j.generation_run_id and r.status = 'running');
  return v_run;
end $$;

create or replace function public.attach_review_generation_jobs(p_run_id bigint)
returns void language sql set search_path = public, pg_temp as $$
  update public.review_generation_jobs j set status = 'running', generation_run_id = p_run_id, updated_at = now()
   where (j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'running' and not exists
     (select 1 from public.review_batch_runs r where r.id = j.generation_run_id and r.status = 'running'));
$$;

create or replace function public.finish_review_generation_jobs(p_run_id bigint, p_succeeded boolean)
returns void language sql set search_path = public, pg_temp as $$
  update public.review_generation_jobs set status = case when p_succeeded then 'done' else 'pending' end,
    next_attempt_at = case when p_succeeded then now() else now() + interval '1 minute' end, updated_at = now()
   where generation_run_id = p_run_id and status = 'running';
  delete from public.review_generation_jobs where status = 'done' and updated_at < now() - interval '30 days';
$$;

revoke all on function public.add_insight_group_members(bigint, bigint[], timestamptz) from public, anon, authenticated;
revoke all on function public.record_review_grades_batch(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_relearning_generation() from public, anon, authenticated;
revoke all on function public.attach_review_generation_jobs(bigint) from public, anon, authenticated;
revoke all on function public.finish_review_generation_jobs(bigint, boolean) from public, anon, authenticated;
grant execute on function public.add_insight_group_members(bigint, bigint[], timestamptz) to service_role;
grant execute on function public.record_review_grades_batch(jsonb, jsonb) to service_role;
grant execute on function public.claim_relearning_generation() to service_role;
grant execute on function public.attach_review_generation_jobs(bigint) to service_role;
grant execute on function public.finish_review_generation_jobs(bigint, boolean) to service_role;
notify pgrst, 'reload schema';
commit;
$performance_source_20261026035236$]::text[]);
notify pgrst, 'reload schema';

commit;
