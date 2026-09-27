-- inbox-route-v1 のシナリオ検証。使い捨てDBで実行する（本番では実行しない）。
\set ON_ERROR_STOP 1
begin;
set role service_role;

create temp table t_ids (name text primary key, id bigint);
create or replace function pg_temp.expect_error(p_sql text, p_message text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected % but succeeded: %', p_message, p_sql;
exception when others then
  if sqlerrm <> p_message then raise exception 'expected % but got %: %', p_message, sqlerrm, p_sql; end if;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'check failed: %', p_label; end if; end $$;

with names as (
  select e from unnest(array['wish','defer','writing','knowledge','habit','focus','github','journal','archive','calendar','close','project','conflict']) e
), ins as (
  insert into idea_inbox (content) select 'inbox ' || e || E'\n2行目' from names returning id, content
)
insert into t_ids select substring(content from 7 for position(E'\n' in content) - 7), id from ins;
select pg_temp.check(inbox_route_contract() ->> 'contract' = 'inbox-route-v1', 'contract');

-- wish
select route_inbox_item((select id from t_ids where name='wish'), 'wish',
  jsonb_build_object('expected', jsonb_build_object('content', E'inbox wish\n2行目', 'result', null), 'note', 'メモ'),
  '00000000-0000-4000-8000-000000000001') ->> 'state' = 'completed' as ok \gset
select pg_temp.check(:'ok'::boolean, 'wish state');
select pg_temp.check((select status='done' and result='欲しいものとしてWantsに保存' from idea_inbox where id=(select id from t_ids where name='wish')), 'wish inbox');
select pg_temp.check((select type='wish' and status='active' and note='メモ' from wants where idempotency_key='00000000-0000-4000-8000-000000000001'), 'wish want');
-- 再送は前回結果
select pg_temp.check((route_inbox_item((select id from t_ids where name='wish'), 'wish',
  jsonb_build_object('expected', jsonb_build_object('content', E'inbox wish\n2行目'), 'note', 'メモ'),
  '00000000-0000-4000-8000-000000000001') ->> 'replayed')::boolean, 'wish replay');
select pg_temp.check((select count(*)=1 from wants where source_inbox_id=(select id from t_ids where name='wish')), 'wish no dup');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'wish','{"expected":{"content":"inbox wish\n2行目"},"note":"別"}','00000000-0000-4000-8000-000000000001')$q$, (select id from t_ids where name='wish')), 'IDEMPOTENCY_CONFLICT');
-- 別キーでも整理済みなら競合
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'wish','{"expected":{"content":"inbox wish\n2行目"}}','00000000-0000-4000-8000-0000000000ff')$q$, (select id from t_ids where name='wish')), 'INBOX_ROUTE_CONFLICT');

-- defer
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'defer','{"expected":{"content":"inbox defer\n2行目"},"revisit_on":"2000-01-01"}','00000000-0000-4000-8000-000000000002')$q$, (select id from t_ids where name='defer')), 'INBOX_ROUTE_INVALID');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'defer','{"expected":{"content":"inbox defer\n2行目"},"revisit_on":"2099-02-30"}','00000000-0000-4000-8000-000000000002')$q$, (select id from t_ids where name='defer')), 'INBOX_ROUTE_INVALID');
select route_inbox_item((select id from t_ids where name='defer'), 'defer',
  '{"expected":{"content":"inbox defer\n2行目"},"revisit_on":"2099-01-31","content":"編集後"}', '00000000-0000-4000-8000-000000000002') is not null;
select pg_temp.check((select result='保留（再訪 2099-01-31）' from idea_inbox where id=(select id from t_ids where name='defer')), 'defer inbox');
select pg_temp.check((select type='want' and revisit_on='2099-01-31' and content='編集後' from wants where idempotency_key='00000000-0000-4000-8000-000000000002'), 'defer want');

-- writing / habit / focus / archive (created)
select route_inbox_item((select id from t_ids where name='writing'), 'writing', '{"expected":{"content":"inbox writing\n2行目"},"title":"問い","detail":"深掘り"}', '00000000-0000-4000-8000-000000000003') is not null;
select pg_temp.check((select r.status='created' and r.target_url='/writing/?id='||r.target_id and w.status='completed' and t.question='深掘り' and t.status='candidate'
  from want_routes r join wants w on w.id=r.want_id join writing_topics t on t.source_route_id=r.id where r.idempotency_key='00000000-0000-4000-8000-000000000003'), 'writing');
select pg_temp.check((select result='Writingへ振り分け' from idea_inbox where id=(select id from t_ids where name='writing')), 'writing inbox');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'habit','{"expected":{"content":"inbox habit\n2行目"},"title":"習慣"}','00000000-0000-4000-8000-000000000004')$q$, (select id from t_ids where name='habit')), 'INBOX_ROUTE_INVALID');
select route_inbox_item((select id from t_ids where name='habit'), 'habit', '{"expected":{"content":"inbox habit\n2行目"},"title":"習慣","cadence":"weekly"}', '00000000-0000-4000-8000-000000000004') is not null;
select pg_temp.check((select h.cadence='weekly' and h.status='active' and r.intent='continue' from want_routes r join habits h on h.source_route_id=r.id where r.idempotency_key='00000000-0000-4000-8000-000000000004'), 'habit');
select route_inbox_item((select id from t_ids where name='focus'), 'focus', '{"expected":{"content":"inbox focus\n2行目"},"title":"言葉"}', '00000000-0000-4000-8000-000000000005') is not null;
select pg_temp.check((select f.status='active' and r.status='created' from want_routes r join focus_items f on f.source_route_id=r.id where r.idempotency_key='00000000-0000-4000-8000-000000000005'), 'focus');
select route_inbox_item((select id from t_ids where name='archive'), 'archive', '{"expected":{"content":"inbox archive\n2行目"},"title":"見送り","intent":"keep"}', '00000000-0000-4000-8000-000000000006') is not null;
select pg_temp.check((select r.status='created' and r.intent='keep' and r.target_id='want:'||r.want_id from want_routes r where r.idempotency_key='00000000-0000-4000-8000-000000000006'), 'archive');
select pg_temp.check((select result='アーカイブへ振り分け' from idea_inbox where id=(select id from t_ids where name='archive')), 'archive inbox');

-- planned
select route_inbox_item((select id from t_ids where name='knowledge'), 'knowledge', '{"expected":{"content":"inbox knowledge\n2行目"},"title":"調べる"}', '00000000-0000-4000-8000-000000000007') is not null;
select route_inbox_item((select id from t_ids where name='github'), 'github', '{"expected":{"content":"inbox github\n2行目"},"title":"実装"}', '00000000-0000-4000-8000-000000000008') is not null;
select route_inbox_item((select id from t_ids where name='journal'), 'journal', '{"expected":{"content":"inbox journal\n2行目"},"title":"記録"}', '00000000-0000-4000-8000-000000000009') is not null;
select pg_temp.check((select bool_and(r.status='planned' and w.status='completed') and count(*)=3 from want_routes r join wants w on w.id=r.want_id
  where r.idempotency_key in ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009')), 'planned routes');
select pg_temp.check((select string_agg(result, ',' order by result) = 'GitHub Issueへ振り分け,Journal候補へ振り分け,Knowledge候補へ振り分け'
  from idea_inbox where id in (select id from t_ids where name in ('knowledge','github','journal'))), 'planned inbox');
select pg_temp.check((route_inbox_item((select id from t_ids where name='github'), 'github', '{"expected":{"content":"inbox github\n2行目"},"title":"実装"}', '00000000-0000-4000-8000-000000000008') ->> 'replayed')::boolean, 'github replay');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"inbox github\n2行目"},"title":"別タイトル"}','00000000-0000-4000-8000-000000000008')$q$, (select id from t_ids where name='github')), 'IDEMPOTENCY_CONFLICT');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"inbox github\n2行目"},"title":"x","intent":"explore"}','00000000-0000-4000-8000-0000000000aa')$q$, (select id from t_ids where name='github')), 'INBOX_ROUTE_INVALID');

-- calendar: planned → failed → retry → created
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'calendar','{"expected":{"content":"inbox calendar\n2行目"},"title":"予定","calendar":{"allDay":false,"date":"2099-01-01","startTime":"10:00","endTime":"09:00","timeZone":"Asia/Tokyo"}}','00000000-0000-4000-8000-00000000000a')$q$, (select id from t_ids where name='calendar')), 'INBOX_ROUTE_INVALID');
select pg_temp.check(route_inbox_item((select id from t_ids where name='calendar'), 'calendar',
  '{"expected":{"content":"inbox calendar\n2行目"},"title":"予定","calendar":{"allDay":true,"date":"2099-01-01","startTime":null,"endTime":null,"timeZone":"Asia/Tokyo"}}',
  '00000000-0000-4000-8000-00000000000a') ->> 'state' = 'awaiting_external', 'calendar awaiting');
select pg_temp.check((select status='pending' from idea_inbox where id=(select id from t_ids where name='calendar')), 'calendar inbox pending');
select pg_temp.check(fail_inbox_route('00000000-0000-4000-8000-00000000000a', 'GOOGLE_CALENDAR_UNAVAILABLE') #>> '{route,status}' = 'failed', 'calendar failed');
select pg_temp.check((select w.status='active' from want_routes r join wants w on w.id=r.want_id where r.idempotency_key='00000000-0000-4000-8000-00000000000a'), 'calendar want active');
select pg_temp.check(route_inbox_item((select id from t_ids where name='calendar'), 'calendar',
  '{"expected":{"content":"inbox calendar\n2行目"},"title":"予定","calendar":{"allDay":true,"date":"2099-01-01","startTime":null,"endTime":null,"timeZone":"Asia/Tokyo"}}',
  '00000000-0000-4000-8000-00000000000a') #>> '{route,status}' = 'planned', 'calendar retry resets');
select pg_temp.check((select count(*)=1 from wants where source_inbox_id=(select id from t_ids where name='calendar')), 'calendar no dup want');
select pg_temp.check(complete_inbox_route('00000000-0000-4000-8000-00000000000a', 'evt1', 'https://example.test/e') ->> 'state' = 'completed', 'calendar complete');
select pg_temp.check((select status='done' and result='Google Calendarへ振り分け' from idea_inbox where id=(select id from t_ids where name='calendar')), 'calendar inbox done');
select pg_temp.check((select w.status='completed' and exists(select 1 from scheduled_actions s where s.source_route_id=r.id)
  from want_routes r join wants w on w.id=r.want_id where r.idempotency_key='00000000-0000-4000-8000-00000000000a'), 'calendar want+scheduled');
select pg_temp.check((complete_inbox_route('00000000-0000-4000-8000-00000000000a', 'evt1', null) ->> 'replayed')::boolean, 'complete replay');
select pg_temp.expect_error($q$select complete_inbox_route('00000000-0000-4000-8000-00000000000a', 'evt2', null)$q$, 'IDEMPOTENCY_CONFLICT');
select pg_temp.expect_error($q$select fail_inbox_route('00000000-0000-4000-8000-00000000000a', 'X')$q$, 'ROUTE_STATE_CONFLICT');
select pg_temp.expect_error($q$select complete_inbox_route('00000000-0000-4000-8000-000000000003', 'x', null)$q$, 'ROUTE_STATE_CONFLICT');

-- close
select route_inbox_item((select id from t_ids where name='close'), 'close', '{"expected":{"content":"inbox close\n2行目","result":null}}', '00000000-0000-4000-8000-00000000000b') is not null;
select pg_temp.check((select status='done' and result is null from idea_inbox where id=(select id from t_ids where name='close')), 'close');
select pg_temp.check((route_inbox_item((select id from t_ids where name='close'), 'close', '{"expected":{"content":"inbox close\n2行目"}}', '00000000-0000-4000-8000-00000000000c') ->> 'replayed')::boolean, 'close replay');

-- project
select pg_temp.check((route_inbox_item((select id from t_ids where name='project'), 'project_create',
  '{"expected":{"content":"inbox project\n2行目"},"title":"P1","outcome":"できた","next_action":"最初"}', '00000000-0000-4000-8000-00000000000d') ->> 'project_id') is not null, 'project create');
select pg_temp.check((select status='done' and result='Project「P1」に整理' from idea_inbox where id=(select id from t_ids where name='project')), 'project inbox');
select pg_temp.check((route_inbox_item((select id from t_ids where name='project'), 'project_create',
  '{"expected":{"content":"inbox project\n2行目"},"title":"P1","outcome":"できた","next_action":"最初"}', '00000000-0000-4000-8000-00000000000d') ->> 'replayed')::boolean, 'project replay');
insert into idea_inbox (content) values ('link me');
select pg_temp.check((route_inbox_item((select max(id) from idea_inbox), 'project_link',
  jsonb_build_object('expected', jsonb_build_object('content','link me'), 'project_id', (select id from projects where title='P1'),
    'project_updated_at', (select updated_at from projects where title='P1')), '00000000-0000-4000-8000-00000000000e') ->> 'project_id')::bigint
  = (select id from projects where title='P1'), 'project link');
select pg_temp.check((select result='Project「P1」に整理' from idea_inbox where content='link me'), 'project link inbox');

-- 楽観ロック・入力不正
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"違う"},"title":"x"}','00000000-0000-4000-8000-0000000000bb')$q$, (select id from t_ids where name='conflict')), 'INBOX_ROUTE_CONFLICT');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"inbox conflict\n2行目","result":"x"},"title":"x"}','00000000-0000-4000-8000-0000000000bb')$q$, (select id from t_ids where name='conflict')), 'INBOX_ROUTE_CONFLICT');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"inbox conflict\n2行目"},"title":"x","extra":1}','00000000-0000-4000-8000-0000000000bb')$q$, (select id from t_ids where name='conflict')), 'INBOX_ROUTE_INVALID');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'nope','{"expected":{"content":"inbox conflict\n2行目"}}','00000000-0000-4000-8000-0000000000bb')$q$, (select id from t_ids where name='conflict')), 'INBOX_ROUTE_INVALID');
select pg_temp.expect_error($q$select route_inbox_item(999999,'close','{"expected":{"content":"x"}}','00000000-0000-4000-8000-0000000000bb')$q$, 'INBOX_NOT_FOUND');
-- 別Inboxで使ったキーの流用
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'github','{"expected":{"content":"inbox conflict\n2行目"},"title":"実装"}','00000000-0000-4000-8000-000000000008')$q$, (select id from t_ids where name='conflict')), 'IDEMPOTENCY_CONFLICT');

-- Focus上限: 失敗時は何も残らない（トランザクションごと巻き戻る）
insert into idea_inbox (content) values ('focus full');
do $$
declare v_id bigint;
begin
  for g in 1..4 loop
    insert into idea_inbox (content) values ('focus fill ' || g) returning id into v_id;
    perform route_inbox_item(v_id, 'focus', jsonb_build_object('expected', jsonb_build_object('content', 'focus fill ' || g), 'title', 'f' || g), gen_random_uuid());
  end loop;
end $$;
select pg_temp.check((select count(*)=5 from focus_items where status='active'), 'focus full');
select pg_temp.expect_error(format($q$select route_inbox_item(%s,'focus','{"expected":{"content":"focus full"},"title":"x"}','00000000-0000-4000-8000-0000000000cc')$q$, (select id from idea_inbox where content='focus full')), 'FOCUS_ACTIVE_LIMIT');
select pg_temp.check((select count(*)=0 from wants where idempotency_key='00000000-0000-4000-8000-0000000000cc'), 'focus rollback');
select pg_temp.check((select status='pending' from idea_inbox where content='focus full'), 'focus inbox pending');

reset role;
set role anon;
select pg_temp.expect_error($q$select inbox_route_contract()$q$, 'permission denied for function inbox_route_contract');
reset role;
select 'ALL CHECKS PASSED';
rollback;
