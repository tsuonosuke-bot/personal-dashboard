-- Drop the copy of the review schedule taken before the pacing change in
-- 20260928100000_review_pacing.sql (issue #62). The schedule has run on the new
-- pacing since 2026-09-28 and reviews now come from the question queue, so the
-- old schedule will not be restored. The weekly encrypted backup taken on
-- 2026-09-28 06:08 UTC, before the pacing change was applied, still holds the
-- original schedule until 2026-12-27.
--
-- This permanently deletes the rows. Run it yourself once you agree.
begin;

drop table if exists public.knowledge_schedule_backup_20260928;

commit;
