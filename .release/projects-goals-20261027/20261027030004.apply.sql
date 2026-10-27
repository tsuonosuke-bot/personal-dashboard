begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(304308);
do $projects_release_guard$ begin
    if exists(select 1 from supabase_migrations.schema_migrations where version='20261027030004') then raise exception 'PROJECTS_MIGRATION_ALREADY_RECORDED'; end if;
    
  end; $projects_release_guard$;
-- Supporting habits are canonical in Habits. Membership and semantic changes
-- invalidate a previously observed review; no Project/activity timestamps move.
create or replace function public.project_habit_review_fingerprint(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation',to_jsonb(r),
    'habit',case when r.linked then to_jsonb(h) else null end,
    'logs',case when r.linked then coalesce((select jsonb_agg(to_jsonb(l) order by l.id)
      from public.habit_logs l where l.habit_id=r.habit_id),'[]'::jsonb) else null end
  ) order by r.habit_id),'[]'::jsonb)
  from public.project_habits r left join public.habits h on h.id=r.habit_id
  where r.project_id=p_project_id;
$$;
revoke all on function public.project_habit_review_fingerprint(bigint) from public,anon,authenticated;
grant execute on function public.project_habit_review_fingerprint(bigint) to service_role;
insert into public.dashboard_schema_versions(app_id,migration,updated_at)
values('hub','20261027030004_project_review_habit_snapshot',now())
on conflict(app_id) do update set migration=excluded.migration,updated_at=excluded.updated_at;

insert into supabase_migrations.schema_migrations(version,name,statements)
  values('20261027030004','project_review_habit_snapshot',array[$projects_source_20261027030004$-- Supporting habits are canonical in Habits. Membership and semantic changes
-- invalidate a previously observed review; no Project/activity timestamps move.
create or replace function public.project_habit_review_fingerprint(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation',to_jsonb(r),
    'habit',case when r.linked then to_jsonb(h) else null end,
    'logs',case when r.linked then coalesce((select jsonb_agg(to_jsonb(l) order by l.id)
      from public.habit_logs l where l.habit_id=r.habit_id),'[]'::jsonb) else null end
  ) order by r.habit_id),'[]'::jsonb)
  from public.project_habits r left join public.habits h on h.id=r.habit_id
  where r.project_id=p_project_id;
$$;
revoke all on function public.project_habit_review_fingerprint(bigint) from public,anon,authenticated;
grant execute on function public.project_habit_review_fingerprint(bigint) to service_role;
insert into public.dashboard_schema_versions(app_id,migration,updated_at)
values('hub','20261027030004_project_review_habit_snapshot',now())
on conflict(app_id) do update set migration=excluded.migration,updated_at=excluded.updated_at;
$projects_source_20261027030004$]::text[]);
notify pgrst,'reload schema';
commit;
