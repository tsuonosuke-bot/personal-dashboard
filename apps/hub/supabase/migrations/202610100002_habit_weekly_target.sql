-- Weekly habits can aim for several times a week (#163). Every record of a
-- weekly habit becomes its own D:<date> row, and a week counts as achieved
-- when its records reach habits.target_per_week. Existing W:<monday> rows are
-- re-keyed to the day they were practiced; unique (habit_id, practiced_on)
-- already guarantees one row per habit and day, so the re-key cannot collide.

alter table public.habits
  add column if not exists target_per_week smallint not null default 1;

alter table public.habits
  drop constraint if exists habits_target_per_week_range;
alter table public.habits
  add constraint habits_target_per_week_range check (target_per_week between 1 and 7);

comment on column public.habits.target_per_week is
  'Times per week a weekly habit aims for (1-7). Other cadences keep 1. Changing it re-evaluates past weeks too.';

update public.habit_logs
set tracking_key = 'D:' || to_char(practiced_on, 'YYYY-MM-DD')
where tracking_key like 'W:%';

comment on column public.habit_logs.tracking_key is
  'D:date for each record, weekly habits included (W:monday keys were re-keyed by 202610100002); used to make writes idempotent.';
