-- Run the review batches on a schedule: questions every 30 minutes, grading
-- every 15 minutes. Each batch skips the AI when there is nothing to do (queue
-- full / no candidates / no answers). Until the Vault secret
-- 'review_batch_token' is set, trigger_review_batch only logs a warning, and the
-- batches can still be run by hand from the review screen.
begin;

select cron.schedule('review-generate-questions', '*/30 * * * *', $job$select public.trigger_review_batch('generate')$job$);
select cron.schedule('review-grade-answers', '*/15 * * * *', $job$select public.trigger_review_batch('grade')$job$);

commit;
