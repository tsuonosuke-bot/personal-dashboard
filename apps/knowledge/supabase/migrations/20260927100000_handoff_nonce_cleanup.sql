-- consume_dashboard_handoff_nonce only prunes old rows when someone signs in,
-- so expired nonces pile up while nobody uses the handoff. Prune them daily.
-- A nonce is rejected once its expires_at is more than 5 seconds in the past,
-- so rows expired for over a day are no longer needed for replay detection.

create or replace function public.prune_dashboard_handoff_nonce()
returns integer
language sql
security invoker
set search_path to 'public', 'pg_temp'
as $$
  with deleted as (
    delete from public.dashboard_handoff_nonce
    where expires_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.prune_dashboard_handoff_nonce() from public, anon, authenticated;
grant execute on function public.prune_dashboard_handoff_nonce() to service_role;

comment on function public.prune_dashboard_handoff_nonce() is
  'Deletes SSO handoff nonces that expired more than a day ago. Run daily by pg_cron.';

create extension if not exists pg_cron with schema extensions;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'prune-dashboard-handoff-nonce') then
    perform cron.schedule(
      'prune-dashboard-handoff-nonce',
      '20 18 * * *',
      'select public.prune_dashboard_handoff_nonce();'
    );
  end if;
end $$;
