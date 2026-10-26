-- Read models keep history bodies off the dashboard and page all historical results.
begin;
create index if not exists quiz_log_knowledge_answered_idx on public.quiz_log
  (knowledge_id, (coalesce(answered_at, created_at)) desc, id desc);
create index if not exists quiz_log_learning_log_idx on public.quiz_log(created_at desc, id desc);
create index if not exists quiz_log_first_answer_idx on public.quiz_log(knowledge_id, asked_on, id);

create or replace function public.learning_log_matches(
  p_from date default null, p_category text default null, p_verdict text default null,
  p_unconfirmed boolean default false, p_knowledge_id uuid default null
)
returns setof public.quiz_log language sql stable set search_path = public, pg_temp as $$
  select l.* from public.quiz_log l left join public.knowledge k on k.id = l.knowledge_id
   where (p_from is null or l.asked_on >= p_from)
     and (p_category is null or coalesce(k.category, '不明') = p_category)
     and (p_verdict is null or l.verdict = p_verdict)
     and (not p_unconfirmed or l.review_queue_id is not null and l.confirmed_at is null)
     and (p_knowledge_id is null or l.knowledge_id = p_knowledge_id);
$$;

create or replace function public.get_learning_log_page(
  p_limit integer default 30, p_offset integer default 0, p_from date default null,
  p_category text default null, p_verdict text default null, p_unconfirmed boolean default false,
  p_knowledge_id uuid default null, p_misses boolean default false, p_ids bigint[] default null
)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if p_limit not between 1 and 200 or p_offset < 0 or p_limit is null or p_offset is null then
    raise exception 'invalid page' using errcode = '22023';
  end if;
  with matches as not materialized (
    select l.* from public.learning_log_matches(p_from, p_category, p_verdict, p_unconfirmed, p_knowledge_id) l
      where (not p_misses or l.verdict <> '正解') and (p_ids is null or l.id = any(p_ids))
  ), page as (
    select l.*, coalesce(k.title, '（削除されたナレッジ）') as title, coalesce(k.category, '不明') as category
      from matches l left join public.knowledge k on k.id = l.knowledge_id
     order by case when p_knowledge_id is not null or p_misses then coalesce(l.answered_at, l.created_at) else l.created_at end desc, l.id desc
     limit p_limit offset p_offset
  )
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'),
    'limit', p_limit, 'offset', p_offset, 'total', count(*),
    'correct', count(*) filter (where verdict = '正解'),
    'unconfirmed', count(*) filter (where review_queue_id is not null and confirmed_at is null))
    into v_result from matches;
  return v_result;
end $$;

create or replace function public.snapshot_review_result_ids(
  p_from date default null, p_category text default null, p_verdict text default null, p_misses boolean default false
)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(l.id order by case when p_misses then coalesce(l.answered_at,l.created_at) else l.created_at end desc, l.id desc), '[]')
    from public.learning_log_matches(p_from, p_category, p_verdict, true, null) l where not p_misses or l.verdict <> '正解';
$$;

create or replace function public.get_learning_summary(p_today date default public.jst_today())
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with daily as (
    select asked_on, count(*) as total, count(*) filter (where verdict = '正解') as correct
      from public.quiz_log group by asked_on
  ), today as (
    select count(*) as answered, count(*) filter (where verdict = '正解') as correct,
      count(distinct knowledge_id) as cards from public.quiz_log where asked_on = p_today
  ), misses as (
    select count(*) as total, count(*) filter (where verdict = '不正解') as wrong,
      count(*) filter (where verdict = '部分正解') as partial from public.quiz_log
     where review_queue_id is not null and confirmed_at is null and verdict <> '正解'
  ), weeks as (
    select generate_series(date_trunc('week', p_today::timestamp)::date - 28,
      date_trunc('week', p_today::timestamp)::date, interval '1 week')::date as start
  ), weekly as (
    select w.start, count(l.id) as answered, count(l.id) filter (where l.verdict = '正解') as correct
      from weeks w left join public.quiz_log l on l.asked_on >= w.start and l.asked_on < w.start + 7
       and l.id <> (select f.id from public.quiz_log f where f.knowledge_id = l.knowledge_id order by f.asked_on, f.id limit 1)
     group by w.start
  ), registered as (
    select (created_at at time zone 'Asia/Tokyo')::date as day, count(*) as count from public.knowledge
     where created_at >= ((date_trunc('week', p_today::timestamp)::date - 77)::timestamp at time zone 'Asia/Tokyo')
       and created_at < ((p_today + 1)::timestamp at time zone 'Asia/Tokyo') group by 1
  ), memory as (
    select case when not exists(select 1 from public.quiz_log l where l.knowledge_id = k.id) then 'unasked'
      when k.stability_hours >= 720 then '30d' when k.stability_hours >= 168 then '7d'
      when k.stability_hours >= 72 then '3d' when k.stability_hours >= 24 then '1d' else '0d' end as bucket,
      count(*) as count from public.knowledge k where not k.archived group by 1
  )
  select jsonb_build_object(
    'date', p_today,
    'today', (select to_jsonb(t) || jsonb_build_object('accuracy', case when answered > 0 then correct::float8 / answered else null end) from today t),
    'misses', (select to_jsonb(m) from misses m),
    'weekly', (select jsonb_agg(jsonb_build_object('weekStart', start, 'answered', answered, 'correct', correct,
      'accuracy', case when answered > 0 then correct::float8 / answered else null end,
      'partial', start = date_trunc('week', p_today::timestamp)::date) order by start) from weekly),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('date', asked_on, 'total', total, 'correct', correct,
      'accuracy', round(correct * 100.0 / total)) order by asked_on), '[]') from daily),
    'registrationDays', (select coalesce(jsonb_agg(jsonb_build_object('date', day, 'count', count) order by day), '[]') from registered),
    'memory', (select coalesce(jsonb_object_agg(bucket, count), '{}') from memory),
    'categories', (select coalesce(jsonb_agg(category order by category), '[]') from (select distinct category from public.knowledge) c),
    'tags', (select coalesce(jsonb_agg(tag order by tag), '[]') from (select distinct unnest(tags) as tag from public.knowledge) t),
    'archivedCount', (select count(*) from public.knowledge where archived)
  );
$$;

create or replace function public.search_archived_knowledge(p_search text default '', p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 200 or p_offset < 0 or length(p_search) > 500 then
    raise exception 'invalid archive query' using errcode = '22023';
  end if;
  return (with matches as not materialized (
    select k.* from public.knowledge k where k.archived and (btrim(p_search) = '' or
      strpos(lower(concat_ws(' ', k.title, k.category, coalesce(k.explanation, ''), array_to_string(k.tags, ' '))), lower(btrim(p_search))) > 0)
  ), page as (select * from matches order by created_at desc, id limit p_limit offset p_offset)
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'),
    'total', (select count(*) from matches), 'limit', p_limit, 'offset', p_offset));
end $$;

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
  select jsonb_build_object('dueCount', (select count(*) from active where next_review_on <= p_today),
    'weakCount', (select count(*) from active where times_asked > 0 and accuracy < 80),
    'items', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id), '[]') from candidates c),
    'reviewStatus', (select jsonb_build_object('ready_due', s.ready_due, 'waiting_grading', s.waiting_grading,
      'grading_errors', s.grading_errors, 'unconfirmed_results', s.unconfirmed_results, 'generation_held', s.generation_held)
      from public.get_review_queue_status() s));
$$;

revoke all on function public.learning_log_matches(date,text,text,boolean,uuid) from public, anon, authenticated;
revoke all on function public.get_learning_log_page(integer,integer,date,text,text,boolean,uuid,boolean,bigint[]) from public, anon, authenticated;
revoke all on function public.snapshot_review_result_ids(date,text,text,boolean) from public, anon, authenticated;
revoke all on function public.get_learning_summary(date) from public, anon, authenticated;
revoke all on function public.search_archived_knowledge(text,integer,integer) from public, anon, authenticated;
revoke all on function public.get_knowledge_hub_summary(date) from public, anon, authenticated;
grant execute on function public.learning_log_matches(date,text,text,boolean,uuid) to service_role;
grant execute on function public.get_learning_log_page(integer,integer,date,text,text,boolean,uuid,boolean,bigint[]) to service_role;
grant execute on function public.snapshot_review_result_ids(date,text,text,boolean) to service_role;
grant execute on function public.get_learning_summary(date) to service_role;
grant execute on function public.search_archived_knowledge(text,integer,integer) to service_role;
grant execute on function public.get_knowledge_hub_summary(date) to service_role;
insert into public.dashboard_schema_versions(app_id, migration, updated_at)
values ('knowledge-dashboard', '20261026040000_learning_read_models', now())
on conflict(app_id) do update set migration = excluded.migration, updated_at = excluded.updated_at;
notify pgrst, 'reload schema';
commit;
