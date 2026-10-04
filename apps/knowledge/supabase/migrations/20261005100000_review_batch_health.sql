-- Batch health for the generation / grading batches (issue #61).
-- A run counts as a whole-batch failure when review_batch_runs.status = 'failed'
-- (AI call, database or aborted run). A run that succeeded but could not handle
-- some cards (failed > 0) is a partial failure and does not count against the
-- batch itself. 'skipped' (nothing to do) counts as healthy.
-- Read-only; it also reports the pg_cron jobs that start the batches.
begin;

create or replace function public.get_review_batch_health()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'cron', 'pg_temp'
as $$
  select jsonb_build_object(
    'generate', public.review_batch_kind_health('generate'),
    'grade', public.review_batch_kind_health('grade'),
    'cron', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobname', j.jobname,
        'schedule', j.schedule,
        'active', j.active,
        'last_run_at', last.start_time,
        'last_status', last.status,
        'failed_24h', coalesce(f.failed, 0),
        'last_failure_message', left(lf.return_message, 300)
      ) order by j.jobname)
      from cron.job j
      left join lateral (
        select d.start_time, d.status from cron.job_run_details d
        where d.jobid = j.jobid order by d.start_time desc limit 1
      ) last on true
      left join lateral (
        select count(*) as failed from cron.job_run_details d
        where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'
      ) f on true
      left join lateral (
        select d.return_message from cron.job_run_details d
        where d.jobid = j.jobid and d.status = 'failed' order by d.start_time desc limit 1
      ) lf on true
      where j.jobname in ('review-generate-questions', 'review-grade-answers')
    ), '[]'::jsonb)
  );
$$;

create or replace function public.review_batch_kind_health(p_kind text)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with finished as (
    select * from public.review_batch_runs where kind = p_kind and status <> 'running'
  ),
  last_ok as (
    select max(started_at) as at from finished where status in ('succeeded', 'skipped')
  ),
  last_run as (
    select started_at, status from finished order by started_at desc limit 1
  ),
  last_failure as (
    select started_at, note from finished where status = 'failed' order by started_at desc limit 1
  )
  select jsonb_build_object(
    'last_ok_at', (select at from last_ok),
    'last_run_at', (select started_at from last_run),
    'last_run_status', (select status from last_run),
    'consecutive_failures', (
      select count(*) from finished f
      where f.status = 'failed' and f.started_at > coalesce((select at from last_ok), '-infinity'::timestamptz)
    ),
    'failed_24h', (select count(*) from finished where status = 'failed' and started_at > now() - interval '24 hours'),
    'partial_24h', (select count(*) from finished where status = 'succeeded' and failed > 0 and started_at > now() - interval '24 hours'),
    'last_failure_at', (select started_at from last_failure),
    'last_failure_note', (select left(note, 300) from last_failure)
  );
$$;

revoke all on function public.get_review_batch_health() from public, anon, authenticated;
revoke all on function public.review_batch_kind_health(text) from public, anon, authenticated;
grant execute on function public.get_review_batch_health() to service_role;
grant execute on function public.review_batch_kind_health(text) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261005100000_review_batch_health', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
