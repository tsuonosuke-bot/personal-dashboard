-- The backlog recovery feature (spreading overdue reviews over several days) has
-- no screen any more: the review queue and priority-scaled intervals replaced it.
begin;

drop function if exists public.apply_review_recovery(jsonb);
drop function if exists public.preview_review_recovery(integer);

commit;
