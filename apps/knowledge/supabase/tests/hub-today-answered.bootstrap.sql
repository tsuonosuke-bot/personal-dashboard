-- Isolated disposable PostgreSQL/PGlite fixture only. Never run against production.
create role anon;
create role authenticated;
create role service_role bypassrls;
create function public.jst_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Tokyo')::date $$;
create table public.knowledge (
  id uuid primary key, title text, category text, mastery text, times_asked integer, times_correct integer,
  accuracy numeric, next_review_on date, created_at timestamptz, archived boolean,
  tags text[], stability_hours numeric
);
create table public.quiz_log (
  id bigint primary key, knowledge_id uuid, asked_on date, verdict text, review_queue_id bigint,
  confirmed_at timestamptz
);
create table public.review_queue (id bigint primary key, status text);
create table public.dashboard_schema_versions (app_id text primary key, migration text, updated_at timestamptz);
alter table public.knowledge enable row level security;
alter table public.quiz_log enable row level security;
alter table public.review_queue enable row level security;
grant select on public.knowledge, public.quiz_log, public.review_queue to service_role;
create function public.get_review_queue_status()
returns table(ready_due bigint, waiting_grading bigint, grading_errors bigint, unconfirmed_results bigint, generation_held bigint)
language sql stable as $$
  select count(*) filter (where status = 'ready'), count(*) filter (where status in ('answered','grading')),
    count(*) filter (where status = 'error'), 0::bigint, 0::bigint from public.review_queue;
$$;
insert into public.knowledge values
  ('11111111-1111-4111-8111-111111111111','Card A','技術','学習中',3,1,null,'2026-10-27','2026-10-26T00:00:00Z',false,'{tag}',24),
  ('22222222-2222-4222-8222-222222222222','Card B','英語','定着',2,2,100,'2026-10-28','2026-10-26T01:00:00Z',false,'{}',48),
  ('33333333-3333-4333-8333-333333333333','Archived','技術','未学習',0,0,null,'2026-10-27','2026-10-26T02:00:00Z',true,'{}',0);
-- 23:59:59 JST previous day, 00:00:00 today, today's second answer, 00:00:00 next day.
insert into public.quiz_log values
  (1,'11111111-1111-4111-8111-111111111111',('2026-10-26T14:59:59Z'::timestamptz at time zone 'Asia/Tokyo')::date,'正解',1,now()),
  (2,'11111111-1111-4111-8111-111111111111',('2026-10-26T15:00:00Z'::timestamptz at time zone 'Asia/Tokyo')::date,'不正解',2,null),
  (3,'11111111-1111-4111-8111-111111111111','2026-10-27','部分正解',3,null),
  (4,'22222222-2222-4222-8222-222222222222',('2026-10-27T15:00:00Z'::timestamptz at time zone 'Asia/Tokyo')::date,'正解',4,now());
insert into public.review_queue values (1,'graded'),(2,'graded'),(3,'graded'),(5,'answered'),(6,'grading'),(7,'ready'),(8,'discarded'),(9,'error');
create temp table before_business_data as select
  (select md5(string_agg(to_jsonb(k)::text,',' order by id)) from public.knowledge k) as knowledge,
  (select md5(string_agg(to_jsonb(l)::text,',' order by id)) from public.quiz_log l) as logs,
  (select md5(string_agg(to_jsonb(q)::text,',' order by id)) from public.review_queue q) as queue;
