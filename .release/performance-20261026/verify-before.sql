-- Performance #275-#300 verification; source commit 0e74c32570dd61677f87050b1605f4a4306242af
-- BEFORE ONLY. This script does not apply/reapply migrations or call application RPCs.
-- Save the single verification JSON. No body, answer, secret, cron command or error text is returned.
-- query_to_xml executes only the fixed SELECT strings below; no helper objects are created.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local extra_float_digits = 3;
set local search_path = pg_catalog, public, extensions;
with
settings as (select 'before'::text as phase),
expected_functions(signature,expected_before_present,body_sha256,language,config,returns,input_types,arg_names,default_count,security_definer,volatility) as (values
    ('public.add_insight_group_members(bigint,bigint[],timestamp with time zone)',false,'d8dd1e822123f1a562849f4c9013283af154858eb26fa44d232ff62f54968c65','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['bigint','bigint[]','timestamp with time zone']::text[],ARRAY['p_group_id','p_insight_ids','p_expected_updated_at']::text[],0,false,'v'),
    ('public.attach_review_generation_jobs(bigint)',false,'214f0890c8cac74a8f039028a55aa3956b008562bf2039619b1024444fe92ffd','sql',ARRAY['search_path=public, pg_temp']::text[],'void',ARRAY['bigint']::text[],ARRAY['p_run_id']::text[],0,false,'v'),
    ('public.bulk_categorize_expenses(text,jsonb)',false,'2af439142efa13835b308c9ec74a7004c91f815d48b8fa543a5a4a875f2075bb','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['text','jsonb']::text[],ARRAY['p_category','p_items']::text[],0,false,'v'),
    ('public.claim_relearning_generation()',false,'cfb4d03a9c2ad9e0270518aec032b43577875cd0c9f62c7a8605d42ae8860f42','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'bigint',ARRAY[]::text[],ARRAY[]::text[],0,false,'v'),
    ('public.finish_review_generation_jobs(bigint,boolean)',false,'5a8b9a3aa96077d2ab0a51bffd81a40c0d18780c76e17a2145cb0bf0cd2085b2','sql',ARRAY['search_path=public, pg_temp']::text[],'void',ARRAY['bigint','boolean']::text[],ARRAY['p_run_id','p_succeeded']::text[],0,false,'v'),
    ('public.get_finance_expense_page(date,text[],text,text,text,date,date,text,numeric,numeric,text,boolean,integer,integer,boolean)',false,'4cb5563a8b4a6e8788895ed1fdd0015219e7bb8b1405a7acd30cf0a450327ab2','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date','text[]','text','text','text','date','date','text','numeric','numeric','text','boolean','integer','integer','boolean']::text[],ARRAY['p_month','p_categories','p_category_mode','p_payer','p_query','p_from','p_to','p_type','p_amount_min','p_amount_max','p_sort','p_voided','p_limit','p_offset','p_count']::text[],14,false,'s'),
    ('public.get_finance_hub_summary(date)',false,'89141441c29fb2fb068cef4b17b55ce9e6e5f3b9eda2c2cf20ee861f2b87b368','sql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date']::text[],ARRAY['p_today']::text[],0,false,'s'),
    ('public.get_finance_overview(date,text[],text,text)',false,'fcf9c2fd1d7a59e3d283b49d978d2f80c75517e88fdb41166be195d3122df230','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date','text[]','text','text']::text[],ARRAY['p_month','p_categories','p_category_mode','p_payer']::text[],3,false,'s'),
    ('public.get_hub_local_summary(text,date)',false,'8a4e2cc1edcc81ddd0bd85d1cc77dd59c5e1feb13a80c639cdebfbbbde2760d7','plpgsql',ARRAY['search_path=public']::text[],'jsonb',ARRAY['text','date']::text[],ARRAY['p_source','p_today']::text[],0,false,'s'),
    ('public.get_idea_read_model(text,text,text,text,text,integer,integer,bigint,integer,date)',false,'361163ce446920c656fc7e0dd2381667501c31624d7314f53f8ea2fc2dd19d45','sql',ARRAY['search_path=public']::text[],'jsonb',ARRAY['text','text','text','text','text','integer','integer','bigint','integer','date']::text[],ARRAY['p_view','p_status','p_search','p_filter','p_category','p_offset','p_limit','p_id','p_route_offset','p_today']::text[],10,false,'s'),
    ('public.get_inbox_triage_summary(bigint)',false,'d6877286e068a382d9fc95ddfcc3e584975f2a79ded4da654ced370a06cef5f0','sql',ARRAY['search_path=public']::text[],'jsonb',ARRAY['bigint']::text[],ARRAY['p_inbox_id']::text[],0,false,'s'),
    ('public.get_knowledge_hub_summary(date)',false,'530a1c4b5887cb6f7593596d9ce1f59309901257a3873a564543479f75ac66ee','sql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date']::text[],ARRAY['p_today']::text[],1,false,'s'),
    ('public.get_learning_log_page(integer,integer,date,text,text,boolean,uuid,boolean,bigint[])',false,'f4cf0e075a57d064cdeb8f4581c1ae5ab2e058d10e34ffa3322ba0dadc876438','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['integer','integer','date','text','text','boolean','uuid','boolean','bigint[]']::text[],ARRAY['p_limit','p_offset','p_from','p_category','p_verdict','p_unconfirmed','p_knowledge_id','p_misses','p_ids']::text[],9,false,'s'),
    ('public.get_learning_summary(date)',false,'a8153853bb619919cd73809278dbe42aff2206d4102b6d4fa7b1f52e00ef8e7f','sql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date']::text[],ARRAY['p_today']::text[],1,false,'s'),
    ('public.get_project_read_model(text,text,integer,integer,bigint,integer,integer,integer,date,boolean,text)',false,'86caf1609178ef0cc2716c444522e0815d94064f6363a05d2beca1484304f685','sql',ARRAY['search_path=public']::text[],'jsonb',ARRAY['text','text','integer','integer','bigint','integer','integer','integer','date','boolean','text']::text[],ARRAY['p_view','p_search','p_offset','p_limit','p_project_id','p_history_offset','p_history_limit','p_item_offset','p_today','p_attention','p_sort']::text[],11,false,'s'),
    ('public.get_scheduled_action_counts()',false,'e8734d5acf4af44d747e0b149650b565b6b2e67da0666e64e862cbc7977cfcb4','sql',ARRAY['search_path=public']::text[],'jsonb',ARRAY[]::text[],ARRAY[]::text[],0,false,'s'),
    ('public.learning_log_matches(date,text,text,boolean,uuid)',false,'367a2801638591bf1c59c5ad6f38af2d0afa51292e4a6da7effd41ccabc85f84','sql',ARRAY['search_path=public, pg_temp']::text[],'SETOF quiz_log',ARRAY['date','text','text','boolean','uuid']::text[],ARRAY['p_from','p_category','p_verdict','p_unconfirmed','p_knowledge_id']::text[],5,false,'s'),
    ('public.list_theme_materials(text,text,integer,double precision)',true,'5199b2cbace80a4758048f54ada7d1a535a7dcb09b56bc8942c0ccbec470a450','sql',ARRAY['search_path=public, pg_temp']::text[],'TABLE(source_type text, source_id text, title text, body text, meta text, knowledge_id uuid, entry_date date, similarity double precision, origin text)',ARRAY['text','text','integer','double precision']::text[],ARRAY['p_tag','p_model','p_per_type','p_min_similarity','source_type','source_id','title','body','meta','knowledge_id','entry_date','similarity','origin']::text[],2,false,'s'),
    ('public.record_project_todo_read_cache(jsonb)',false,'8eaddd423afd2ad8a971997d5625c66f41b9c4e7c29c7b9bcfa6d62a9c69d651','plpgsql',ARRAY['search_path=public']::text[],'void',ARRAY['jsonb']::text[],ARRAY['p_items']::text[],0,false,'v'),
    ('public.record_review_grades_batch(jsonb,jsonb)',false,'2ba12aff79c74796686ffd27373f20c58abbbbdc481d50826faf976efa920013','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'TABLE(item_id bigint, recorded boolean, status text, relearning boolean, error text)',ARRAY['jsonb','jsonb']::text[],ARRAY['p_grades','p_errors','item_id','recorded','status','relearning','error']::text[],1,false,'v'),
    ('public.search_archived_knowledge(text,integer,integer)',false,'1a1ade9d54cba75adfe9c4c515027dc3f125ad51d373b76af18e6d04da9840b7','plpgsql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['text','integer','integer']::text[],ARRAY['p_search','p_limit','p_offset']::text[],3,false,'s'),
    ('public.snapshot_review_result_ids(date,text,text,boolean)',false,'5d337bf2e017131b2c756d3d9a8bc8c4cdc6f643ecd809832568114698502588','sql',ARRAY['search_path=public, pg_temp']::text[],'jsonb',ARRAY['date','text','text','boolean']::text[],ARRAY['p_from','p_category','p_verdict','p_misses']::text[],4,false,'s'),
    ('public.theme_material_keys(text,integer,double precision)',true,'95fc0e15558373280136f0fdc8f23bafc0605241cef4d0e5ae874cacda4a31d2','sql',ARRAY['search_path=public, pg_temp']::text[],'TABLE(tag text, source_type text, source_id text, similarity double precision, origin text)',ARRAY['text','integer','double precision']::text[],ARRAY['p_model','p_per_type','p_min_similarity','tag','source_type','source_id','similarity','origin']::text[],2,false,'s'),
    ('public.theme_material_keys_for_tag(text,integer,double precision,text)',false,'8d598f59e5abf65e98769626ec558c079ab0f0d3e23ae4ef8163eaa8f3aa3cbc','plpgsql',ARRAY['search_path=public, extensions, pg_temp']::text[],'TABLE(tag text, source_type text, source_id text, similarity double precision, origin text)',ARRAY['text','integer','double precision','text']::text[],ARRAY['p_model','p_per_type','p_min_similarity','p_tag','tag','source_type','source_id','similarity','origin']::text[],3,false,'s')
),
function_catalog as (
 select e.*,p.oid,p.prosecdef,p.provolatile,p.proargnames,p.pronargdefaults,p.proconfig,l.lanname,
  pg_get_function_result(p.oid) as actual_returns,
  array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t) as actual_input_types,
  case when p.oid is not null then encode(sha256(convert_to(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^\s+|\s+$','','g'),'UTF8')),'hex') end as actual_body_sha256,
  coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false) as anon_execute,
  coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) as authenticated_execute,
  coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false) as service_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
  coalesce((select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb) as grants
 from expected_functions e left join pg_proc p on p.oid=to_regprocedure(e.signature) left join pg_language l on l.oid=p.prolang
),
function_checks as (
 select *,coalesce(oid is not null and actual_body_sha256=body_sha256 and lanname=language and proconfig=config
  and actual_returns=returns and actual_input_types=input_types and coalesce(proargnames,'{}'::text[])=arg_names and pronargdefaults=default_count
  and prosecdef=security_definer and provolatile::text=volatility and not anon_execute and not authenticated_execute and not public_execute and service_execute,false) as post_matches
 from function_catalog
),
expected_tables(name,columns,required_service_privileges,constraints) as (values
    ('review_generation_jobs','[{"name":"item_id","type":"bigint","nullable":false,"default_expression":null,"identity":"","generated":""},{"name":"status","type":"text","nullable":false,"default_expression":"''pending''::text","identity":"","generated":""},{"name":"generation_run_id","type":"bigint","nullable":true,"default_expression":null,"identity":"","generated":""},{"name":"next_attempt_at","type":"timestamp with time zone","nullable":false,"default_expression":"now()","identity":"","generated":""},{"name":"updated_at","type":"timestamp with time zone","nullable":false,"default_expression":"now()","identity":"","generated":""}]'::jsonb,ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[],'[{"name":"review_generation_jobs_generation_run_id_fkey","type":"f","definition":"FOREIGN KEY (generation_run_id) REFERENCES review_batch_runs(id) ON DELETE SET NULL"},{"name":"review_generation_jobs_item_id_fkey","type":"f","definition":"FOREIGN KEY (item_id) REFERENCES review_queue(id) ON DELETE CASCADE"},{"name":"review_generation_jobs_pkey","type":"p","definition":"PRIMARY KEY (item_id)"},{"name":"review_generation_jobs_status_check","type":"c","definition":"CHECK (status = ANY (ARRAY[''pending''::text, ''running''::text, ''done''::text]))"}]'::jsonb),
    ('project_todo_read_cache','[{"name":"scheduled_action_id","type":"bigint","nullable":false,"default_expression":null,"identity":"","generated":""},{"name":"todo_updated_at","type":"timestamp with time zone","nullable":false,"default_expression":null,"identity":"","generated":""},{"name":"effective_date","type":"date","nullable":false,"default_expression":null,"identity":"","generated":""},{"name":"schedule","type":"jsonb","nullable":true,"default_expression":null,"identity":"","generated":""},{"name":"fetched_at","type":"timestamp with time zone","nullable":false,"default_expression":null,"identity":"","generated":""}]'::jsonb,ARRAY['SELECT','INSERT','UPDATE']::text[],'[{"name":"project_todo_read_cache_pkey","type":"p","definition":"PRIMARY KEY (scheduled_action_id)"},{"name":"project_todo_read_cache_scheduled_action_id_fkey","type":"f","definition":"FOREIGN KEY (scheduled_action_id) REFERENCES scheduled_actions(id) ON DELETE CASCADE"}]'::jsonb)
),
table_catalog as (
 select e.*,c.oid,c.relrowsecurity,c.relforcerowsecurity,
  coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'default_expression',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) as actual_columns,
  (select count(*) from pg_policy p where p.polrelid=c.oid) as policy_count,
  coalesce((select jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated) order by k.conname) from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),'[]'::jsonb) as actual_constraints,
  exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0) as public_any_privilege,
  coalesce(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false) as anon_any_privilege,
  coalesce(has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false) as authenticated_any_privilege,
  coalesce((select bool_and(has_table_privilege('service_role',c.oid,privilege)) from unnest(e.required_service_privileges) privilege),false) as service_required_privileges,
  exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and (has_column_privilege('anon',c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') or has_column_privilege('authenticated',c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))) as browser_any_column_privilege,
  coalesce((select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type) order by a.grantee,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),'[]'::jsonb) as grants
 from expected_tables e left join pg_class c on c.oid=to_regclass('public.'||e.name)
),
table_checks as (
 select *,coalesce(oid is not null and relrowsecurity and not relforcerowsecurity and policy_count=0 and actual_columns=columns
  and not public_any_privilege and not anon_any_privilege and not authenticated_any_privilege and not browser_any_column_privilege and service_required_privileges
  and (select count(*) from jsonb_array_elements(actual_constraints))=(select count(*) from jsonb_array_elements(constraints))
  and not exists(select 1 from jsonb_array_elements(constraints) x where not exists(select 1 from jsonb_array_elements(actual_constraints) a where a->>'name'=x->>'name' and a->>'type'=x->>'type' and a->>'definition'=x->>'definition' and (a->>'validated')::boolean)),false) as post_matches
 from table_catalog
),
table_targets(name,is_new) as (values
    ('expenses',false),
    ('budget_categories',false),
    ('recurring_expenses',false),
    ('recurring_expense_occurrences',false),
    ('knowledge',false),
    ('quiz_log',false),
    ('knowledge_mastery_history',false),
    ('speaking_practice_log',false),
    ('knowledge_insights',false),
    ('insight_groups',false),
    ('insight_group_members',false),
    ('knowledge_tag_vocabulary',false),
    ('knowledge_auto_tags',false),
    ('knowledge_auto_tag_state',false),
    ('theme_material_exclusions',false),
    ('question_material_exclusions',false),
    ('question_embeddings',false),
    ('semantic_embeddings',false),
    ('insight_analysis_cache',false),
    ('daily_journal',false),
    ('idea_inbox',false),
    ('wants',false),
    ('want_routes',false),
    ('writing_topics',false),
    ('habits',false),
    ('habit_logs',false),
    ('focus_items',false),
    ('projects',false),
    ('project_actions',false),
    ('project_items',false),
    ('project_milestones',false),
    ('project_action_todos',false),
    ('scheduled_actions',false),
    ('scheduled_action_schedule_history',false),
    ('inbox_sf6_routes',false),
    ('sf6_drills',false),
    ('sf6_drill_logs',false),
    ('sf6_matches',false),
    ('sf6_situations',false),
    ('sf6_sequences',false),
    ('sf6_sequence_starts',false),
    ('sf6_sequence_results',false),
    ('sf6_move_sets',false),
    ('sf6_moves',false),
    ('personal_profile',false),
    ('integration_connections',false),
    ('review_queue',false),
    ('review_batch_runs',false),
    ('review_generation_holds',false),
    ('review_ai_batches',false),
    ('review_generation_jobs',true),
    ('project_todo_read_cache',true)
),
table_xml as materialized (
 select name,is_new,to_regclass('public.'||name) is not null as present,
  case when to_regclass('public.'||name) is not null then query_to_xml(format(
   'select count(*)::bigint as row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha256,'''' order by row_sha256 collate "C"),''''),''UTF8'')),''hex'') as row_digest_sha256 from (select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') as row_sha256 from public.%I t) hashed',name),false,false,'') end as metrics
 from table_targets
),
table_metrics as (
 select name,is_new,present,case when present then (xpath('//row_count/text()',metrics))[1]::text::bigint end as row_count,
  case when present then (xpath('//row_digest_sha256/text()',metrics))[1]::text end as row_digest_sha256 from table_xml
),
expected_indexes(name,table_name) as (values
    ('expenses_active_page_idx','expenses'),
    ('review_generation_jobs_pending_idx','review_generation_jobs'),
    ('quiz_log_knowledge_answered_idx','quiz_log'),
    ('quiz_log_learning_log_idx','quiz_log'),
    ('quiz_log_first_answer_idx','quiz_log'),
    ('project_actions_project_status_updated_idx','project_actions'),
    ('project_items_project_updated_idx','project_items'),
    ('wants_source_inbox_created_idx','wants'),
    ('want_routes_want_created_idx','want_routes')
),
index_checks as (
 select e.*,c.oid,coalesce(i.indisvalid,false) as valid,coalesce(i.indisready,false) as ready,
  i.indrelid=to_regclass('public.'||e.table_name) as table_matches,pg_get_indexdef(c.oid) as definition,
  pg_get_expr(i.indpred,i.indrelid) as predicate,
  array(select pg_get_indexdef(c.oid,k,true) from generate_series(1,i.indnkeyatts) k) as keys
 from expected_indexes e left join pg_class c on c.oid=to_regclass('public.'||e.name) left join pg_index i on i.indexrelid=c.oid
),
dependency_checks as (
 select signature,to_regprocedure(signature) is not null as present,
  case when to_regprocedure(signature) is not null then encode(sha256(convert_to(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^\s+|\s+$','','g'),'UTF8')),'hex') end as body_sha256,
  p.prosecdef as security_definer,p.proconfig as config
 from unnest(ARRAY['public.record_review_grade(bigint,smallint,text,text,text,text)','public.release_review_answer(bigint,text)','public.begin_review_batch(text,text)','public.trigger_review_batch(text)','public.semantic_sources()','public.jst_today()','public.get_review_queue_status()']::text[]) signature left join pg_proc p on p.oid=to_regprocedure(signature)
),
marker_data as (
 select coalesce(jsonb_agg(jsonb_build_object('appId',app_id,'migration',migration,'updatedAt',updated_at) order by app_id),'[]'::jsonb) as rows,
  encode(sha256(convert_to(coalesce(string_agg(case when app_id not in('financial-dashboard','knowledge-dashboard') then encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') end,'' order by app_id),''),'UTF8')),'hex') as other_rows_sha256 from public.dashboard_schema_versions v
),
history_data as (select case when to_regclass('supabase_migrations.schema_migrations') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('with docs as (select to_jsonb(h) as d from supabase_migrations.schema_migrations h), target as (
 select d, coalesce(d->''statements'',''[]''::jsonb) as statements from docs where d->>''version''=any(ARRAY[''20261026035236'',''20261026035400'',''20261026035600'',''20261026040000'',''20261026040132'',''20261026040133'',''20261026040500'',''20261026041122'']::text[])
), rows as (select d->>''version'' as version,d->>''name'' as name,jsonb_array_length(statements) as statement_count,
 encode(sha256(convert_to(replace(coalesce((select string_agg(value,E''\n'' order by ordinality) from jsonb_array_elements_text(statements) with ordinality),''''),E''\r\n'',E''\n''),''UTF8'')),''hex'') as sql_lf_sha256 from target)
select jsonb_build_object(''available'',true,''targetRows'',coalesce((select jsonb_agg(to_jsonb(r) order by version) from rows r),''[]''::jsonb),
 ''otherRowCount'',(select count(*) from docs where d->>''version''<>all(ARRAY[''20261026035236'',''20261026035400'',''20261026035600'',''20261026040000'',''20261026040132'',''20261026040133'',''20261026040500'',''20261026041122'']::text[])),
 ''otherRowsSha256'',encode(sha256(convert_to(coalesce((select string_agg(encode(sha256(convert_to(d::text,''UTF8'')),''hex''),'''' order by d->>''version'') from docs where d->>''version''<>all(ARRAY[''20261026035236'',''20261026035400'',''20261026035600'',''20261026040000'',''20261026040132'',''20261026040133'',''20261026040500'',''20261026041122'']::text[])), ''''),''UTF8'')),''hex''))::text as payload',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['supabase_migrations.schema_migrations']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as data),
expected_history(version,name,sql_lf_sha256) as (values
    ('20261026035236','performance_batch_writes','9a5101ce3384a810415d1e9b7018ccccfda50f40d81b3405053996c211223821'),
    ('20261026035400','theme_material_scope','8b67ab90080756a795a0d5191e77f9e5a005474ef9bc89e373e09686efc48aba'),
    ('20261026035600','finance_read_models','7495cd0f42b96be1debb4e6ab59403b84ae28c62daeaa4c0a86ed0b0704c2188'),
    ('20261026040000','learning_read_models','2311385ae2063e8d5fd5a95d1bc846ecc08b96db6e9911f74c052078d264c5de'),
    ('20261026040132','hub_local_summary','6a1d692b3103538a08b7daabb2489e8626d0d0076a7d560eb1c6e0012ba0d79e'),
    ('20261026040133','project_read_model','7a374f9f3dfe978d01ae8cb40a4bb556b9d252fe06e60003befb41f473e4731d'),
    ('20261026040500','idea_read_model','88ed7c495a7f278b1297c151381ee93aca9c97b424ddb115b2ba6082a5a1f482'),
    ('20261026041122','bulk_expense_categories','4d007cb590b7e39927bb062bea964cf021bc89078183a09f0c1c2353fdaa42eb')
),
history_checks as (
 select e.*,a.version is not null as present,a.name as actual_name,a.statement_count,a.sql_lf_sha256 as actual_sql_lf_sha256,
  coalesce(a.version is not null and a.name=e.name and a.statement_count=1 and a.sql_lf_sha256=e.sql_lf_sha256,false) as post_matches
 from expected_history e left join lateral (select * from jsonb_to_recordset(coalesce((select data->'targetRows' from history_data),'[]'::jsonb)) as x(version text,name text,statement_count integer,sql_lf_sha256 text) where x.version=e.version) a on true
),
cron_data as (select case when to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('select jsonb_build_object(''available'',true,''configurationSha256'',encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(j)::text,''UTF8'')),''hex''),'''' order by j.jobid),''''),''UTF8'')),''hex''),
 ''jobs'',coalesce(jsonb_agg(jsonb_build_object(''jobId'',j.jobid,''name'',j.jobname,''schedule'',j.schedule,''active'',j.active,''commandSha256'',encode(sha256(convert_to(j.command,''UTF8'')),''hex''),
 ''lastRun'',(select jsonb_build_object(''startTime'',d.start_time,''endTime'',d.end_time,''status'',d.status) from cron.job_run_details d where d.jobid=j.jobid order by d.start_time desc limit 1),
 ''failed24h'',(select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status=''failed'' and d.start_time>now()-interval ''24 hours'')) order by j.jobname,j.jobid),''[]''::jsonb))::text as payload from cron.job j',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['cron.job','cron.job_run_details']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as data),
expected_cron(name,schedule) as (values
    ('review-generate-questions','*/30 * * * *'),
    ('review-grade-answers','0 * * * *'),
    ('semantic-embeddings','40 * * * *'),
    ('calendar-todo-sync','*/15 * * * *'),
    ('prune-dashboard-handoff-nonce','20 18 * * *')
),
cron_checks as (
 select e.*,coalesce((select count(*)=1 and bool_and(j->>'schedule'=e.schedule and (j->>'active')::boolean) from jsonb_array_elements(coalesce((select data->'jobs' from cron_data),'[]'::jsonb)) j where j->>'name'=e.name),false) as active_schedule_matches from expected_cron e
),
state_data as (select
 case when to_regclass('public.review_batch_runs') is not null and to_regclass('public.review_queue') is not null and to_regclass('public.quiz_log') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('select jsonb_build_object(''available'',true,''byKind'',coalesce((select jsonb_agg(jsonb_build_object(''kind'',kind,
 ''running'',running,''staleRunning'',stale_running,''failed24h'',failed24h,''lastStarted'',last_started,''lastSucceeded'',last_succeeded) order by kind) from
 (select kind,count(*) filter(where status=''running'') running,count(*) filter(where status=''running'' and started_at<now()-interval ''15 minutes'') stale_running,
 count(*) filter(where status=''failed'' and started_at>now()-interval ''24 hours'') failed24h,max(started_at) last_started,max(started_at) filter(where status in(''succeeded'',''skipped'')) last_succeeded from public.review_batch_runs group by kind) s),''[]''::jsonb),
 ''queueStatuses'',(select coalesce(jsonb_object_agg(status,n),''{}''::jsonb) from(select status,count(*) n from public.review_queue group by status)s),
 ''activeQueueDuplicateKnowledge'',(select count(*) from(select knowledge_id from public.review_queue where status in(''ready'',''answered'',''grading'',''error'') group by knowledge_id having count(*)>1)s),
 ''duplicateQuizLogQueueIds'',(select count(*) from(select review_queue_id from public.quiz_log where review_queue_id is not null group by review_queue_id having count(*)>1)s))::text as payload',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['public.review_batch_runs','public.review_queue','public.quiz_log']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as review,
 case when to_regclass('public.review_generation_jobs') is not null and to_regclass('public.review_queue') is not null and to_regclass('public.review_batch_runs') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('select jsonb_build_object(''available'',true,''rowCount'',count(*),
 ''pending'',count(*) filter(where j.status=''pending''),''running'',count(*) filter(where j.status=''running''),''done'',count(*) filter(where j.status=''done''),
 ''invalidStatus'',count(*) filter(where j.status not in(''pending'',''running'',''done'')),
 ''orphanQueueItem'',count(*) filter(where q.id is null),''orphanRun'',count(*) filter(where j.generation_run_id is not null and r.id is null),
 ''duePending'',count(*) filter(where j.status=''pending'' and j.next_attempt_at<=now()),
 ''staleRunning'',count(*) filter(where j.status=''running'' and (r.id is null or r.status<>''running'' or r.started_at<now()-interval ''15 minutes'')),
 ''oldestDuePendingAt'',min(j.next_attempt_at) filter(where j.status=''pending'' and j.next_attempt_at<=now()))::text as payload
 from public.review_generation_jobs j left join public.review_queue q on q.id=j.item_id left join public.review_batch_runs r on r.id=j.generation_run_id',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['public.review_generation_jobs','public.review_queue','public.review_batch_runs']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as generation_jobs,
 case when to_regclass('public.project_todo_read_cache') is not null and to_regclass('public.scheduled_actions') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('select jsonb_build_object(''available'',true,''rowCount'',count(*),''orphanTodo'',count(*) filter(where t.id is null),
 ''staleTodoVersion'',count(*) filter(where c.todo_updated_at is distinct from t.updated_at),''nullSchedule'',count(*) filter(where c.schedule is null),
 ''invalidRequiredFields'',count(*) filter(where c.todo_updated_at is null or c.effective_date is null or c.fetched_at is null))::text as payload
 from public.project_todo_read_cache c left join public.scheduled_actions t on t.id=c.scheduled_action_id',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['public.project_todo_read_cache','public.scheduled_actions']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as todo_cache,
 case when to_regclass('public.project_action_todos') is not null and to_regclass('public.project_actions') is not null and to_regclass('public.scheduled_actions') is not null and to_regclass('public.insight_group_members') is not null and to_regclass('public.knowledge_insights') is not null and to_regclass('public.insight_groups') is not null then (select x.payload::jsonb from xmltable('/table/row' passing query_to_xml('select jsonb_build_object(''available'',true,
 ''orphanProjectTodoAction'',(select count(*) from public.project_action_todos l left join public.project_actions a on a.id=l.project_action_id where a.id is null),
 ''orphanProjectTodo'',(select count(*) from public.project_action_todos l left join public.scheduled_actions t on t.id=l.scheduled_action_id where t.id is null),
 ''projectsWithMultipleNextActions'',(select count(*) from(select project_id from public.project_actions where status=''next'' group by project_id having count(*)>1)s),
 ''orphanGroupInsight'',(select count(*) from public.insight_group_members m left join public.knowledge_insights i on i.id=m.insight_id left join public.insight_groups g on g.id=m.group_id where i.id is null or g.id is null))::text as payload',false,false,'') columns payload text path 'payload') x) else jsonb_build_object('available',false,'missingRelations',coalesce((select jsonb_agg(x) from unnest(ARRAY['public.project_action_todos','public.project_actions','public.scheduled_actions','public.insight_group_members','public.knowledge_insights','public.insight_groups']::text[]) x where to_regclass(x) is null),'[]'::jsonb)) end as links
)
select jsonb_build_object(
 'format','performance-release-verification-v1','phase',(select phase from settings),'sourceCommit','0e74c32570dd61677f87050b1605f4a4306242af','capturedAt',now(),
 'environment',jsonb_build_object('database',current_database(),'role',current_user,'serverVersion',current_setting('server_version'),'transactionReadOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation')),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname),'[]'::jsonb) from pg_extension where extname in('pg_cron','pg_trgm','vector')),
 'roles',(select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'bypassRls',rolbypassrls,'superuser',rolsuper) order by rolname),'[]'::jsonb) from pg_roles where rolname in('anon','authenticated','service_role')),
 'preservation',(select jsonb_agg(to_jsonb(t) order by name) from table_metrics t where not is_new),
 'newTableMetrics',(select jsonb_agg(to_jsonb(t) order by name) from table_metrics t where is_new),
 'functions',(select jsonb_agg(jsonb_build_object('signature',signature,'present',oid is not null,'expectedBeforePresent',expected_before_present,'beforePresenceMatches',(oid is not null)=expected_before_present,
  'postMatches',post_matches,'bodySha256',actual_body_sha256,'expectedBodySha256',body_sha256,'returns',actual_returns,'inputTypes',actual_input_types,'argumentNames',proargnames,'defaultCount',pronargdefaults,
  'language',lanname,'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig,'publicExecute',public_execute,'anonExecute',anon_execute,'authenticatedExecute',authenticated_execute,'serviceExecute',service_execute,'grants',grants) order by signature) from function_checks),
 'newTables',(select jsonb_agg(jsonb_build_object('name',name,'present',oid is not null,'postMatches',post_matches,'rls',relrowsecurity,'forcedRls',relforcerowsecurity,'policyCount',policy_count,'columns',actual_columns,'constraints',actual_constraints,
  'publicAnyPrivilege',public_any_privilege,'anonAnyPrivilege',anon_any_privilege,'authenticatedAnyPrivilege',authenticated_any_privilege,'browserAnyColumnPrivilege',browser_any_column_privilege,'serviceRequiredPrivileges',service_required_privileges,'grants',grants) order by name) from table_checks),
 'indexes',(select jsonb_agg(to_jsonb(i) order by name) from index_checks i),
 'unchangedDependencies',(select jsonb_agg(to_jsonb(d) order by signature) from dependency_checks d),
 'schemaMarkers',(select rows from marker_data),'otherSchemaMarkersSha256',(select other_rows_sha256 from marker_data),
 'history',(select data from history_data),'historyChecks',(select jsonb_agg(to_jsonb(h) order by version) from history_checks h),
 'cron',(select data from cron_data),'cronChecks',(select jsonb_agg(to_jsonb(c) order by name) from cron_checks c),
 'operationalState',(select to_jsonb(s) from state_data s),
 'checks',jsonb_build_object(
  'requiredExtensionsPresent',(select count(*)=3 from pg_extension where extname in('pg_cron','pg_trgm','vector')),
  'roleConfigurationMatches',(select count(*)=3 and bool_and(case when rolname='service_role' then rolbypassrls or rolsuper else not rolbypassrls and not rolsuper end) from pg_roles where rolname in('anon','authenticated','service_role')),
  'allExistingTablesPresent',(select bool_and(present) from table_metrics where not is_new),
  'allDependenciesPresent',(select bool_and(present) from dependency_checks),
  'beforeObjectPresenceMatches',(select bool_and((oid is not null)=expected_before_present) from function_checks) and (select bool_and(oid is null) from table_checks) and (select bool_and(oid is null) from index_checks),
  'beforeHistoryAbsent',(select bool_and(not present) from history_checks),
  'postFunctionsMatch',(select bool_and(post_matches) from function_checks),'postTablesMatch',(select bool_and(post_matches) from table_checks),
  'postIndexesValid',(select bool_and(coalesce(oid is not null and valid and ready and table_matches,false)) from index_checks),
  'postHistoryMatches',(select bool_and(post_matches) from history_checks),
  'postMarkersMatch',exists(select 1 from public.dashboard_schema_versions where app_id='financial-dashboard' and migration='20261026041122_bulk_expense_categories') and exists(select 1 from public.dashboard_schema_versions where app_id='knowledge-dashboard' and migration='20261026040000_learning_read_models'),
  'expectedCronActive',(select bool_and(active_schedule_matches) from cron_checks)
 )
) as verification;
commit;
