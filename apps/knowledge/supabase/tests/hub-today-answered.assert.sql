do $$
declare v jsonb; v_today date;
begin
  if exists (select from before_business_data b where
    b.knowledge <> (select md5(string_agg(to_jsonb(k)::text,',' order by id)) from public.knowledge k)
    or b.logs <> (select md5(string_agg(to_jsonb(l)::text,',' order by id)) from public.quiz_log l)
    or b.queue <> (select md5(string_agg(to_jsonb(q)::text,',' order by id)) from public.review_queue q)) then
    raise exception 'migration changed business data';
  end if;
  for v_today in select unnest(array['2026-10-26'::date,'2026-10-27'::date,'2026-10-28'::date,'2026-10-29'::date]) loop
    v := public.get_knowledge_hub_summary(v_today);
    if (v->>'date')::date <> v_today or v->'todayAnswered' <> public.get_learning_summary(v_today)->'today'->'answered' then
      raise exception 'Hub/Knowledge dated count mismatch for %', v_today;
    end if;
  end loop;
  v := public.get_knowledge_hub_summary('2026-10-27');
  if v->>'todayAnswered' <> '2' or v->'reviewStatus'->>'waiting_grading' <> '2' or v->'reviewStatus'->>'ready_due' <> '1' then
    raise exception 'pending/skipped/discarded answers were counted or queue changed';
  end if;
  if v - 'date' - 'todayAnswered' <> (select summary from before_hub_summary) then
    raise exception 'existing summary contract changed';
  end if;
  if has_function_privilege('anon','public.get_knowledge_hub_summary(date)','EXECUTE')
     or has_function_privilege('authenticated','public.get_knowledge_hub_summary(date)','EXECUTE')
     or not has_function_privilege('service_role','public.get_knowledge_hub_summary(date)','EXECUTE') then
    raise exception 'RPC execute privileges changed';
  end if;
  if exists(select from pg_proc where oid = 'public.get_knowledge_hub_summary(date)'::regprocedure and prosecdef) then
    raise exception 'RPC unexpectedly bypasses caller permissions';
  end if;
  if exists(select from pg_class where oid in ('public.knowledge'::regclass,'public.quiz_log'::regclass,'public.review_queue'::regclass) and not relrowsecurity) then
    raise exception 'RLS disabled';
  end if;
end $$;
-- Accepted pending input is absent until the grading result is actually recorded.
update public.review_queue set status = 'graded' where id = 5;
insert into public.quiz_log values (5,'22222222-2222-4222-8222-222222222222','2026-10-27','正解',5,now());
do $$ begin
  if public.get_knowledge_hub_summary('2026-10-27')->>'todayAnswered' <> '3'
     or public.get_knowledge_hub_summary('2026-10-27')->'todayAnswered' <> public.get_learning_summary('2026-10-27')->'today'->'answered'
     or public.get_knowledge_hub_summary('2026-10-27')->>'todayAnswered' <> '3' then
    raise exception 'grading transition or repeat read counted incorrectly';
  end if;
end $$;
set role service_role;
select public.get_knowledge_hub_summary('2026-10-27')->>'todayAnswered' as service_role_answered;
reset role;
