-- DB usage for the Hub (issue #36): the whole database size, as the Supabase
-- dashboard counts it (pg_database_size), the size of the public tables, and
-- the five largest tables. Read-only; only the server-side secret key can call it.
begin;

create or replace function public.get_database_usage()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'public_bytes', coalesce((
      select sum(pg_total_relation_size(c.oid))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ), 0),
    'top_tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'bytes', t.bytes) order by t.bytes desc)
      from (
        select c.relname::text as name, pg_total_relation_size(c.oid) as bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by 2 desc limit 5
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_database_usage() from public, anon, authenticated;
grant execute on function public.get_database_usage() to service_role;

notify pgrst, 'reload schema';

commit;
