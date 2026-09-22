-- Run this as a separate, read-only query after applying
-- supabase/migrations/202609220003_projects_mvp.sql.

select
  to_regclass('public.projects') is not null as projects_table,
  to_regclass('public.project_items') is not null as project_items_table,
  to_regclass('public.project_actions') is not null as project_actions_table;

select
  count(*) filter (where proname = 'create_project_with_next_action') = 1 as create_project_rpc,
  count(*) filter (where proname = 'create_project_from_source') = 1 as create_from_source_rpc,
  count(*) filter (where proname = 'link_project_source') = 1 as link_source_rpc,
  count(*) filter (where proname = 'process_project_item') = 1 as process_item_rpc,
  count(*) filter (where proname = 'resume_project_with_next_action') = 1 as resume_project_rpc,
  count(*) filter (where proname = 'add_project_queued_action') = 1 as add_queued_action_rpc,
  count(*) filter (where proname = 'resolve_project_next_action') = 1 as resolve_action_rpc
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'create_project_with_next_action',
    'create_project_from_source',
    'link_project_source',
    'process_project_item',
    'resume_project_with_next_action',
    'add_project_queued_action',
    'resolve_project_next_action'
  );

select
  count(*) filter (where indexname = 'project_actions_one_next_idx') = 1 as one_next_index,
  count(*) filter (where indexname = 'project_items_one_project_per_source_idx') = 1 as one_project_per_source_index
from pg_indexes
where schemaname = 'public'
  and indexname in ('project_actions_one_next_idx', 'project_items_one_project_per_source_idx');

select count(*) as projects_with_multiple_next_actions
from (
  select project_id
  from public.project_actions
  where status = 'next'
  group by project_id
  having count(*) > 1
) conflicts;

select count(*) as sources_linked_to_multiple_projects
from (
  select source_type, source_id
  from public.project_items
  group by source_type, source_id
  having count(*) > 1
) conflicts;

select
  (select count(*) from public.projects) as projects,
  (select count(*) from public.project_items) as linked_items,
  (select count(*) from public.project_actions) as actions;
