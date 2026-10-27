-- Read-only production verification; no row contents or secrets returned.
select public.jst_today() as jst_date,
  public.get_knowledge_hub_summary()->>'date' as hub_date,
  public.get_knowledge_hub_summary()->'todayAnswered' as hub_answered,
  public.get_learning_summary()->'today'->'answered' as knowledge_answered,
  (select count(*) from public.quiz_log where asked_on = public.jst_today()) as recorded_answered,
  public.get_knowledge_hub_summary()->'reviewStatus' as review_status;
select rolname, has_function_privilege(rolname, 'public.get_knowledge_hub_summary(date)', 'EXECUTE') as can_execute
  from pg_roles where rolname in ('anon','authenticated','service_role');
select version, name from supabase_migrations.schema_migrations where version = '20261027085600';
