-- Compact Inbox provenance, including legacy result fallback in the JS model.
-- Route history stays on the detail path; the list receives no history rows.
create or replace function public.get_inbox_triage_summary(p_inbox_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $$
with linked as (select * from public.wants where source_inbox_id=p_inbox_id),
destinations as (
  select w.id as want_id,w.created_at as want_created,'wish'::text as destination,'created'::text as status,
    0 as kind,w.created_at as route_created,0::bigint as route_id from linked w where w.status='active' and w.type='wish'
  union all select w.id,w.created_at,r.destination,r.status,1,r.created_at,r.id from linked w
    join public.want_routes r on r.want_id=w.id where r.status in ('planned','created')
), ordered as (
  select *,row_number() over(order by want_created desc,want_id desc,kind,route_created desc,route_id desc) as position from destinations
), grouped as (
  select destination,case when bool_or(status='created') then 'created' else 'planned' end as status,min(position) as position from ordered group by destination
), result as (
  select coalesce((select jsonb_agg(jsonb_build_object('destination',destination,'status',status) order by position) from grouped),'[]'::jsonb) as destinations,
    (select min(revisit_on) from linked where status='active') as revisit_on
)
select case when jsonb_array_length(destinations)=0 and revisit_on is null then null else
  jsonb_build_object('destinations',destinations,'revisitOn',revisit_on,'source','route') end from result;
$$;
revoke all on function public.get_inbox_triage_summary(bigint) from public,anon,authenticated;
grant execute on function public.get_inbox_triage_summary(bigint) to service_role;

create or replace function public.get_idea_read_model(
  p_view text default 'inbox',p_status text default 'pending',p_search text default '',p_filter text default '',
  p_category text default '',p_offset integer default 0,p_limit integer default 50,p_id bigint default null,
  p_route_offset integer default 0,p_today date default (now() at time zone 'Asia/Tokyo')::date
) returns jsonb language sql stable security invoker set search_path=public as $$
with matching_inbox as (
  select i.* from public.idea_inbox i where p_view='inbox' and
    (p_id is not null and i.id=p_id or p_id is null and (p_status='' or i.status=p_status)
      and (p_search='' or position(lower(p_search) in lower(i.content))>0 or position(lower(p_search) in lower(i.result))>0))
), matching_wants as (
  select w.*,case when w.category in ('place','watch','play','read','do','wish') then w.category
    when w.type='wish' then 'wish' else 'other' end as effective_category
  from public.wants w where p_view='wants' and
    (p_id is not null and w.id=p_id or p_id is null and (p_status='' or w.status=p_status)
      and (p_search='' or position(lower(p_search) in lower(w.content))>0 or position(lower(p_search) in lower(w.note))>0)
      and (p_filter not in ('knowledge','github','untriaged')
        or p_filter='untriaged' and w.status='active' and coalesce(w.type,'want')<>'wish' and w.revisit_on<=p_today
        or p_filter in ('knowledge','github') and exists(select 1 from public.want_routes r where r.want_id=w.id and r.destination=p_filter and r.status='planned')
          and not exists(select 1 from public.want_routes r where r.want_id=w.id and r.destination=p_filter and r.status='created')))
), category_wants as (
  select * from matching_wants where p_id is not null or p_category='' or effective_category=p_category
), selected_inbox as (
  select * from matching_inbox order by created_at desc,id desc limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0)
), selected_wants as (
  select * from category_wants order by
    case when p_status='active' and p_filter not in ('knowledge','github') then array_position(array['place','watch','play','read','do','wish','other'],effective_category) else 0 end,
    case when p_status='active' and p_filter not in ('knowledge','github') then case when revisit_on<=p_today then 0 when revisit_on is null then 1 else 2 end else 0 end,
    created_at desc,id desc limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0)
), routes as (
  select r.* from public.want_routes r join selected_wants w on w.id=r.want_id where p_id is not null
  order by r.created_at desc,r.id desc limit 50 offset greatest(p_route_offset,0)
), preview_routes as (
  select distinct on(r.want_id,r.destination,r.status) r.* from public.want_routes r join selected_wants w on w.id=r.want_id
  where p_id is null and r.status in ('planned','created') order by r.want_id,r.destination,r.status,r.created_at desc,r.id desc
), all_routes as (select * from routes union all select * from preview_routes)
select jsonb_build_object(
  'inbox',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('triage',public.get_inbox_triage_summary(i.id)) order by i.created_at desc,i.id desc) from selected_inbox i),'[]'::jsonb),
  'wants',coalesce((select jsonb_agg(to_jsonb(w)) from selected_wants w),'[]'::jsonb),
  'routes',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from all_routes r),'[]'::jsonb),
  'summary',jsonb_build_object(
    'inboxTotal',(select count(*) from public.idea_inbox),'pendingInbox',(select count(*) from public.idea_inbox where status='pending'),
    'wantsTotal',(select count(*) from public.wants),'activeWants',(select count(*) from public.wants where status='active'),
    'completedWants',(select count(*) from public.wants where status='completed'),
    'untriagedWants',(select count(*) from public.wants where status='active' and coalesce(type,'want')<>'wish' and revisit_on<=p_today),
    'dueForReview',(select count(*) from public.wants where status='active' and revisit_on<=p_today),
    'knowledgePending',(select count(*) from public.wants w where exists(select 1 from public.want_routes r where r.want_id=w.id and r.destination='knowledge' and r.status='planned')),
    'githubPending',(select count(*) from public.wants w where exists(select 1 from public.want_routes r where r.want_id=w.id and r.destination='github' and r.status='planned'))),
  'statuses',coalesce(case when p_view='inbox' then (select jsonb_agg(s.status order by s.status) from (select distinct status from public.idea_inbox) s)
    else (select jsonb_agg(s.status order by s.status) from (select distinct status from public.wants) s) end,'[]'::jsonb),
  'page',jsonb_build_object('view',p_view,'offset',p_offset,'total',case when p_view='inbox' then (select count(*) from matching_inbox) else (select count(*) from category_wants) end,
    'hasMore',p_offset+case when p_view='inbox' then (select count(*) from selected_inbox) else (select count(*) from selected_wants) end<
      case when p_view='inbox' then (select count(*) from matching_inbox) else (select count(*) from category_wants) end,
    'categoryCounts',coalesce((select jsonb_object_agg(effective_category,total) from (select effective_category,count(*) as total from matching_wants group by effective_category) c),'{}'::jsonb),
    'due',(select count(*) from category_wants where revisit_on<=p_today),'sleeping',(select count(*) from category_wants where revisit_on>p_today)),
  'routePage',jsonb_build_object('offset',p_route_offset,'hasMore',p_id is not null and p_route_offset+50<(select count(*) from public.want_routes where want_id=p_id),
    'total',case when p_id is not null then (select count(*) from public.want_routes where want_id=p_id) else 0 end)
);
$$;
revoke all on function public.get_idea_read_model(text,text,text,text,text,integer,integer,bigint,integer,date) from public,anon,authenticated;
grant execute on function public.get_idea_read_model(text,text,text,text,text,integer,integer,bigint,integer,date) to service_role;
create index if not exists wants_source_inbox_created_idx on public.wants(source_inbox_id,created_at desc,id desc);
create index if not exists want_routes_want_created_idx on public.want_routes(want_id,created_at desc,id desc);

create or replace function public.get_scheduled_action_counts()
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('pending',count(*) filter(where status='pending'),'completed',count(*) filter(where status='completed'),'skipped',count(*) filter(where status='skipped')) from public.scheduled_actions;
$$;
revoke all on function public.get_scheduled_action_counts() from public,anon,authenticated;
grant execute on function public.get_scheduled_action_counts() to service_role;
