-- Read-only deployment check. Expect true flags and zero inconsistent links.
select
  to_regclass('public.project_action_todos') is not null as link_table_exists,
  (select relrowsecurity from pg_class where oid = 'public.project_action_todos'::regclass) as link_rls_enabled,
  to_regprocedure('public.link_project_action_todo(jsonb)') is not null as link_rpc_exists,
  to_regprocedure('public.unlink_project_action_todo(jsonb)') is not null as unlink_rpc_exists,
  to_regprocedure('public.update_linked_todo(jsonb)') is not null as execution_rpc_exists,
  to_regprocedure('public.delete_unlinked_scheduled_actions(bigint[],timestamp with time zone)') is not null as sync_guard_exists,
  not has_function_privilege('anon', 'public.update_linked_todo(jsonb)', 'execute') as anon_cannot_update,
  not has_function_privilege('authenticated', 'public.link_project_action_todo(jsonb)', 'execute') as browser_cannot_link,
  not has_function_privilege('anon', 'public.resolve_project_next_action(bigint,timestamp with time zone,text,bigint,text,text,date)', 'execute') as legacy_entry_is_private,
  has_function_privilege('service_role', 'public.link_project_action_todo(jsonb)', 'execute') as server_can_link;

select count(*) as inconsistent_links
from public.project_action_todos link
join public.project_actions action on action.id = link.project_action_id
join public.scheduled_actions todo on todo.id = link.scheduled_action_id
where (todo.status = 'pending' and action.status not in ('next','queued','waiting'))
   or (todo.status = 'completed' and (action.status <> 'done' or action.completed_at is distinct from todo.completed_at))
   or (todo.status = 'skipped' and (action.status <> 'cancelled' or action.completed_at is not null));

select count(*) as projects_with_multiple_next_actions from (
  select project_id from public.project_actions where status = 'next' group by project_id having count(*) > 1
) invalid;
