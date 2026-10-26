begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(275300);
do $performance_guard$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026040132') then
    raise exception 'PERFORMANCE_MIGRATION_ALREADY_RECORDED: 20261026040132';
  end if;
end;
$performance_guard$;

-- Hub reads aggregate counts and only its visible previews, independently per source.
create or replace function public.get_hub_local_summary(p_source text, p_today date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if p_source = 'inbox' then
    return jsonb_build_object('pendingInbox', (select count(*) from public.idea_inbox where status = 'pending'),
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from
        (select id,content,status,created_at from public.idea_inbox where status='pending' order by created_at asc,id asc limit 3) i), '[]'::jsonb));
  elsif p_source = 'wants' then
    return (select jsonb_build_object('activeWants',count(*) filter (where status='active'),
      'untriagedWants',count(*) filter (where status='active' and coalesce(type,'want') <> 'wish' and revisit_on <= p_today)) from public.wants);
  elsif p_source = 'projects' then
    return jsonb_build_object('activeProjects',(select count(*) from public.projects where status in ('active','waiting','on_hold')));
  elsif p_source = 'writing' then
    return jsonb_build_object('writingIdeas',(select count(*) from public.writing_topics where status='candidate'));
  elsif p_source = 'focus' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order asc nulls last,f.created_at,f.id) from
      (select id,source_route_id,source_want_id,content,note,status,sort_order,created_at,updated_at from public.focus_items
        where status='active' order by sort_order asc nulls last,created_at asc,id asc limit 5) f),'[]'::jsonb));
  elsif p_source = 'habits' then
    return (with active as (select * from public.habits where status='active'),
      logs as (select habit_id,bool_or(practiced_on=p_today and kind='done') as done_today,
        bool_or(practiced_on=p_today and kind='skip') as skipped_today,
        count(distinct practiced_on) filter(where kind='done') as week_count,bool_or(kind='skip') as skipped_week
        from public.habit_logs where practiced_on between p_today-((extract(isodow from p_today))::integer-1) and p_today group by habit_id)
      select jsonb_build_object('summary',jsonb_build_object('active',count(*),
        'completedToday',count(*) filter(where coalesce(l.done_today,false)),
        'remainingToday',count(*) filter(where a.started_on<=p_today and
          (a.cadence='weekly' and coalesce(l.week_count,0)<coalesce(a.target_per_week,1) and not coalesce(l.skipped_week,false)
            or a.cadence in ('daily','weekdays') and (a.cadence='daily' or extract(isodow from p_today)<=5)
              and not coalesce(l.done_today,false) and not coalesce(l.skipped_today,false)))))
      from active a left join logs l on l.habit_id=a.id);
  end if;
  raise exception 'HUB_SOURCE_INVALID';
end;
$$;
revoke all on function public.get_hub_local_summary(text,date) from public, anon, authenticated;
grant execute on function public.get_hub_local_summary(text,date) to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20261026040132','hub_local_summary',array[$performance_source_20261026040132$-- Hub reads aggregate counts and only its visible previews, independently per source.
create or replace function public.get_hub_local_summary(p_source text, p_today date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if p_source = 'inbox' then
    return jsonb_build_object('pendingInbox', (select count(*) from public.idea_inbox where status = 'pending'),
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from
        (select id,content,status,created_at from public.idea_inbox where status='pending' order by created_at asc,id asc limit 3) i), '[]'::jsonb));
  elsif p_source = 'wants' then
    return (select jsonb_build_object('activeWants',count(*) filter (where status='active'),
      'untriagedWants',count(*) filter (where status='active' and coalesce(type,'want') <> 'wish' and revisit_on <= p_today)) from public.wants);
  elsif p_source = 'projects' then
    return jsonb_build_object('activeProjects',(select count(*) from public.projects where status in ('active','waiting','on_hold')));
  elsif p_source = 'writing' then
    return jsonb_build_object('writingIdeas',(select count(*) from public.writing_topics where status='candidate'));
  elsif p_source = 'focus' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order asc nulls last,f.created_at,f.id) from
      (select id,source_route_id,source_want_id,content,note,status,sort_order,created_at,updated_at from public.focus_items
        where status='active' order by sort_order asc nulls last,created_at asc,id asc limit 5) f),'[]'::jsonb));
  elsif p_source = 'habits' then
    return (with active as (select * from public.habits where status='active'),
      logs as (select habit_id,bool_or(practiced_on=p_today and kind='done') as done_today,
        bool_or(practiced_on=p_today and kind='skip') as skipped_today,
        count(distinct practiced_on) filter(where kind='done') as week_count,bool_or(kind='skip') as skipped_week
        from public.habit_logs where practiced_on between p_today-((extract(isodow from p_today))::integer-1) and p_today group by habit_id)
      select jsonb_build_object('summary',jsonb_build_object('active',count(*),
        'completedToday',count(*) filter(where coalesce(l.done_today,false)),
        'remainingToday',count(*) filter(where a.started_on<=p_today and
          (a.cadence='weekly' and coalesce(l.week_count,0)<coalesce(a.target_per_week,1) and not coalesce(l.skipped_week,false)
            or a.cadence in ('daily','weekdays') and (a.cadence='daily' or extract(isodow from p_today)<=5)
              and not coalesce(l.done_today,false) and not coalesce(l.skipped_today,false)))))
      from active a left join logs l on l.habit_id=a.id);
  end if;
  raise exception 'HUB_SOURCE_INVALID';
end;
$$;
revoke all on function public.get_hub_local_summary(text,date) from public, anon, authenticated;
grant execute on function public.get_hub_local_summary(text,date) to service_role;
$performance_source_20261026040132$]::text[]);
notify pgrst, 'reload schema';

commit;
