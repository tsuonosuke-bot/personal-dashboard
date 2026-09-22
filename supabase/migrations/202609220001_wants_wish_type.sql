-- Keep material wishes in Wants without mixing them into the untriaged queue.
-- Existing deferred/routing records use type='want', while the pre-existing
-- type='concern' remains valid for records created by the current workflow.

alter table public.wants
  drop constraint if exists wants_type_check;

alter table public.wants
  add constraint wants_type_check
  check (type in ('want', 'concern', 'wish')) not valid;

alter table public.wants
  validate constraint wants_type_check;
