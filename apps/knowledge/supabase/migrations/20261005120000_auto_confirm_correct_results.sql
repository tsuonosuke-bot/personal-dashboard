-- Only results the learner got wrong (不正解・部分正解) need reviewing. Treat a correct
-- queue result as confirmed when it is recorded, so "未確認の採点結果" (the dashboard's
-- 見直す講評, the learning log filter, and get_review_queue_status.unconfirmed_results)
-- counts only the answers worth looking at again.
--
-- A trigger covers every writer of quiz_log (instant multiple-choice recording,
-- empty answers, and the grading batch) without redefining those functions.
begin;

create or replace function public.auto_confirm_correct_review_result()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.review_queue_id is not null and new.verdict = '正解' and new.confirmed_at is null then
    new.confirmed_at := coalesce(new.answered_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists quiz_log_auto_confirm_correct on public.quiz_log;
create trigger quiz_log_auto_confirm_correct
  before insert or update of verdict, confirmed_at on public.quiz_log
  for each row execute function public.auto_confirm_correct_review_result();

-- One-time backfill for correct results recorded before this migration.
update public.quiz_log
set confirmed_at = coalesce(answered_at, created_at)
where review_queue_id is not null
  and verdict = '正解'
  and confirmed_at is null;

commit;
