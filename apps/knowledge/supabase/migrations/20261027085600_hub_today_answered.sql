-- Dated Hub activity uses exactly the existing Knowledge today.answered definition.
-- Pending review_queue answers are intentionally excluded until quiz_log is recorded.
begin;
create or replace function public.get_knowledge_hub_summary(p_today date default public.jst_today())
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with active as not materialized (
    select k.id,k.title,k.category,k.mastery,k.times_asked,k.times_correct,
      coalesce(k.accuracy, case when k.times_asked > 0 then round(100.0 * k.times_correct / k.times_asked) else null end) as accuracy,
      k.next_review_on,k.created_at,k.archived from public.knowledge k where not k.archived
  ), weak as (select * from active where times_asked > 0 and accuracy < 80 order by accuracy, times_asked desc, created_at desc, id limit 2),
  due as (select * from active where next_review_on <= p_today order by next_review_on, created_at desc, id limit 2),
  newest as (select * from active order by created_at desc,id limit 5),
  candidates as (select * from weak union select * from due union select * from newest)
  select jsonb_build_object('date', p_today,
    'todayAnswered', (select count(*) from public.quiz_log where asked_on = p_today),
    'dueCount', (select count(*) from active where next_review_on <= p_today),
    'weakCount', (select count(*) from active where times_asked > 0 and accuracy < 80),
    'items', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id), '[]') from candidates c),
    'reviewStatus', (select jsonb_build_object('ready_due', s.ready_due, 'waiting_grading', s.waiting_grading,
      'grading_errors', s.grading_errors, 'unconfirmed_results', s.unconfirmed_results, 'generation_held', s.generation_held)
      from public.get_review_queue_status() s));
$$;
revoke all on function public.get_knowledge_hub_summary(date) from public, anon, authenticated;
grant execute on function public.get_knowledge_hub_summary(date) to service_role;
insert into public.dashboard_schema_versions(app_id, migration, updated_at)
values ('knowledge-dashboard', '20261027085600_hub_today_answered', now())
on conflict(app_id) do update set migration = excluded.migration, updated_at = excluded.updated_at;
notify pgrst, 'reload schema';
commit;
