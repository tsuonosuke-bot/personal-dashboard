begin;

create table if not exists public.dashboard_schema_versions (
  app_id text primary key,
  migration text not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_schema_versions enable row level security;
revoke all on table public.dashboard_schema_versions from anon, authenticated;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('personal-dashboard', '202609220005_connection_status', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
