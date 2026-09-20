-- Google Calendar is the canonical store for scheduled actions. The refresh
-- token is encrypted by the Pages Function before it reaches Supabase.

alter table public.want_routes
  add column if not exists destination_data jsonb not null default '{}'::jsonb;

alter table public.want_routes
  drop constraint if exists want_routes_destination_data_check;

alter table public.want_routes
  add constraint want_routes_destination_data_check check (
    (
      destination = 'calendar' and
      destination_data ? 'calendar' and
      jsonb_typeof(destination_data -> 'calendar') = 'object' and
      destination_data - 'calendar' = '{}'::jsonb
    ) or
    (destination <> 'calendar' and destination_data = '{}'::jsonb)
  ) not valid;

create table if not exists public.integration_connections (
  provider text primary key check (provider in ('google_calendar')),
  encrypted_credentials text not null check (char_length(encrypted_credentials) between 20 and 8000),
  scope text not null check (char_length(scope) between 1 and 2000),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_connections enable row level security;

comment on column public.want_routes.destination_data is 'Validated destination-specific data used to create the canonical target.';
comment on table public.integration_connections is 'Server-only encrypted OAuth credentials. No browser-readable RLS policy is defined.';
