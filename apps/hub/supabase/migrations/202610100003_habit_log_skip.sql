-- A day (or week) a habit was deliberately rested, e.g. illness or travel
-- (#164). A skip is stored as a habit_logs row with kind = 'skip' so it keeps
-- the one-row-per-habit-and-day rule and its note says why. Skipped days are
-- left out of achievement rates and do not break a streak. Existing rows are
-- all 'done'.

alter table public.habit_logs
  add column if not exists kind text not null default 'done';

alter table public.habit_logs
  drop constraint if exists habit_logs_kind_check;
alter table public.habit_logs
  add constraint habit_logs_kind_check check (kind in ('done', 'skip'));

comment on column public.habit_logs.kind is
  'done = practiced; skip = deliberately rested (excluded from rates, keeps the streak).';
