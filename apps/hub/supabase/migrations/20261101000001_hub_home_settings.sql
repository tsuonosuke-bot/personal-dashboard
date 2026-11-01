-- Hubホームの表示設定。非表示にするセクションを1行（id='home'）に持ち、全端末で共通にする。
-- ブラウザ（anon）からは読めない。service_role（Pages Functions）だけ。
begin;

create table if not exists public.hub_home_settings (
  id text primary key check (id = 'home'),
  hidden_sections text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.hub_home_settings enable row level security;
revoke all on table public.hub_home_settings from public, anon, authenticated;
grant select, insert, update on table public.hub_home_settings to service_role;

insert into public.hub_home_settings (id) values ('home') on conflict (id) do nothing;

comment on table public.hub_home_settings is 'Hubホームで非表示にするセクション。既定は全部表示（空配列）。';

notify pgrst, 'reload schema';

commit;
