-- Reuse validated insight analyses only when both their input and analysis policy match (#118).
begin;

create table if not exists public.insight_analysis_cache (
  input_hash text primary key check (input_hash ~ '^[0-9a-f]{64}$'),
  analysis jsonb not null check (jsonb_typeof(analysis) = 'object'),
  analyzed_at timestamptz not null default now()
);

alter table public.insight_analysis_cache enable row level security;
revoke all on table public.insight_analysis_cache from public, anon, authenticated;
grant select, insert, update on table public.insight_analysis_cache to service_role;
comment on table public.insight_analysis_cache is 'Validated AI insight themes keyed by exact input and analysis policy. Read via authenticated Pages Functions only.';

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('knowledge-dashboard', '20261022100000_insight_analysis_cache', now())
on conflict (app_id) do update set migration = excluded.migration, updated_at = excluded.updated_at;
notify pgrst, 'reload schema';
commit;
