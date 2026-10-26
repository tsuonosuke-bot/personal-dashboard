-- Read-only catalog/history audit for knowledge-db (run as the project owner).
-- This is verification, not a migration. No application rows or secrets are returned.
-- Compare the result with scripts/migration-baselines.json; do not replay baseline/.
with history as (
  select version, name,
    regexp_replace(lower(array_to_string(statements, ' ')), '\s+', ' ', 'g') as sql
  from supabase_migrations.schema_migrations
), target_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (
    'knowledge', 'quiz_log', 'expenses', 'budget_categories',
    'recurring_expenses', 'recurring_expense_occurrences'
  )
), target_functions as (
  select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'next_recurring_date', 'create_recurring_expense_rule',
    'materialize_recurring_expenses', 'set_recurring_expense_active',
    'update_recurring_expense_rule', 'expenses_fill_category'
  )
)
select jsonb_build_object(
  'observed_at', current_timestamp,
  'history_count', (select count(*) from history),
  'history_without_sql', (select count(*) from history where sql is null or sql = ''),
  'identified_history', (
    select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version)
    from history where version in ('20260920023245', '20260920043311', '20261009020520')
  ),
  -- These are search candidates only, not proof that a whole baseline was applied.
  'other_history_candidates', (
    select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version)
    from history where
      sql ~ '\mcreate\s+table\s+(if\s+not\s+exists\s+)?(public\.)?recurring_expenses\M'
      or sql ~ '\mrevoke\M[^;]*\m(knowledge|quiz_log|expenses|budget_categories)\M[^;]*\manon\M'
  ),
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table', relname, 'rls', relrowsecurity,
      'privileges', (
        select jsonb_agg(jsonb_build_object(
          'role', role_name,
          'select', has_table_privilege(role_name, t.oid, 'SELECT'),
          'insert', has_table_privilege(role_name, t.oid, 'INSERT'),
          'update', has_table_privilege(role_name, t.oid, 'UPDATE'),
          'delete', has_table_privilege(role_name, t.oid, 'DELETE'),
          'truncate', has_table_privilege(role_name, t.oid, 'TRUNCATE'),
          'references', has_table_privilege(role_name, t.oid, 'REFERENCES'),
          'trigger', has_table_privilege(role_name, t.oid, 'TRIGGER')
        ) order by role_name)
        from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
      )
    ) order by relname) from target_tables t
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name', proname, 'args', pg_get_function_identity_arguments(oid),
      'owner', pg_get_userbyid(proowner), 'security_definer', prosecdef,
      'strict', proisstrict, 'volatility', provolatile, 'config', proconfig,
      -- Whitespace-normalized diagnostic hash, not byte or semantic equivalence.
      'body_md5', md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))),
      'execute_anon', has_function_privilege('anon', oid, 'EXECUTE'),
      'execute_authenticated', has_function_privilege('authenticated', oid, 'EXECUTE'),
      'execute_service_role', has_function_privilege('service_role', oid, 'EXECUTE')
    ) order by proname, pg_get_function_identity_arguments(oid)) from target_functions
  ),
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default, 'identity', is_identity
    ) order by table_name, ordinal_position)
    from information_schema.columns where table_schema = 'public' and (
      table_name in ('recurring_expenses', 'recurring_expense_occurrences')
      or table_name = 'expenses' and column_name = 'category'
    )
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text, 'name', conname,
      'definition', pg_get_constraintdef(oid)
    ) order by conrelid, conname)
    from pg_constraint where
      conrelid in (to_regclass('public.recurring_expenses'), to_regclass('public.recurring_expense_occurrences'))
      or conrelid = to_regclass('public.quiz_log') and conname = 'quiz_log_format_check'
  ),
  'category_trigger', (
    select jsonb_agg(jsonb_build_object(
      'name', tgname, 'enabled', tgenabled, 'definition', pg_get_triggerdef(oid)
    )) from pg_trigger where tgrelid = to_regclass('public.expenses')
      and not tgisinternal and tgname = 'expenses_fill_category'
  ),
  'sequence_service_usage', has_sequence_privilege('service_role', to_regclass('public.recurring_expenses_id_seq'), 'USAGE'),
  'sequence_service_select', has_sequence_privilege('service_role', to_regclass('public.recurring_expenses_id_seq'), 'SELECT'),
  'cron', (
    select jsonb_agg(jsonb_build_object(
      'name', jobname, 'schedule', schedule, 'active', active,
      'expected_command', btrim(command) = 'select public.materialize_recurring_expenses();'
    )) from cron.job where jobname = 'materialize-recurring-expenses-jst'
  )
) as baseline_audit;
