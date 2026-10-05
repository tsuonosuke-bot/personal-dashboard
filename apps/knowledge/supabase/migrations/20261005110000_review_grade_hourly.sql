-- Grade answers every hour instead of every 15 minutes. cron.schedule with an
-- existing job name updates that job's schedule in place.
begin;

select cron.schedule('review-grade-answers', '0 * * * *', $job$select public.trigger_review_batch('grade')$job$);

commit;
