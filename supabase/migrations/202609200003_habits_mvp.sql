-- Habit MVP supports both Want-routed habits and directly created habits.
-- the Habits screen. started_on makes the visible tracking period explicit.

alter table public.habits
  alter column source_route_id drop not null,
  alter column source_want_id drop not null;

alter table public.habits
  add column if not exists started_on date not null
    default ((now() at time zone 'Asia/Tokyo')::date);

alter table public.habit_logs
  add column if not exists tracking_key text
    check (tracking_key is null or tracking_key ~ '^[DW]:[0-9]{4}-[0-9]{2}-[0-9]{2}$');

create index if not exists habits_status_created_at_idx
  on public.habits (status, created_at desc);

create index if not exists habit_logs_practiced_on_habit_id_idx
  on public.habit_logs (practiced_on desc, habit_id);

create unique index if not exists habit_logs_habit_id_tracking_key_uidx
  on public.habit_logs (habit_id, tracking_key)
  where tracking_key is not null;

comment on column public.habits.source_route_id is
  'Want route that created this habit. Null when the habit was created directly.';
comment on column public.habits.source_want_id is
  'Source Want for routed habits. Null when the habit was created directly.';
comment on column public.habits.started_on is
  'First local date on which this habit is shown as trackable.';
comment on column public.habit_logs.tracking_key is
  'D:date for daily records or W:monday for weekly records; used to make writes idempotent.';
