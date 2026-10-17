-- Every Google Calendar event (primary, today .. +90 days) is mirrored into
-- scheduled_actions by POST /api/calendar-sync. Events created from the
-- Dashboard keep their want_routes link; mirrored events have no route and are
-- identified by google_event_id instead.

alter table public.scheduled_actions
  alter column source_route_id drop not null;

alter table public.scheduled_actions
  add column if not exists google_event_id text,
  add column if not exists calendar_title text,
  add column if not exists calendar_url text,
  add column if not exists calendar_etag text,
  add column if not exists calendar_state text not null default 'confirmed';

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_calendar_state_check,
  add constraint scheduled_actions_calendar_state_check check (calendar_state in ('confirmed', 'cancelled'));

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_origin_check,
  add constraint scheduled_actions_origin_check check (source_route_id is not null or google_event_id is not null);

create unique index if not exists scheduled_actions_google_event_id_key
  on public.scheduled_actions (google_event_id)
  where google_event_id is not null;

comment on column public.scheduled_actions.google_event_id is
  'Google Calendar event id for rows mirrored by /api/calendar-sync. Null for rows created from a Dashboard route.';

-- Run the sync every 15 minutes. The URL and bearer secret live in Supabase
-- Vault (calendar_sync_url / calendar_sync_secret); the job does nothing until
-- both exist.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'calendar-todo-sync',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'calendar_sync_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'calendar_sync_secret');
  $job$
);
