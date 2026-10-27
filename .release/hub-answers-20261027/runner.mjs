import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { guard, GuardFailure, lf, parseDatabaseUrl, childEnvironment, capture, checkProcess, parseClientTls } from './process-safety.mjs';

export const MANIFEST_SHA256 = '711b9300c9926a8c595bdac49482c05a2d8adace4abb21d911daec25a3f7908f';
export const REPO = 'tsuonosuke-bot/personal-dashboard';
export const BUNDLE = '.release/hub-answers-20261027';
export const WORKFLOW = '.github/workflows/supabase-backup.yml';
export const PROJECT = 'plwlxwidpqbunugfxjhp';
export const SIGNATURE = 'public.get_knowledge_hub_summary(date)';
export const VERSION = '20261027085600';
export const MIGRATION = 'apps/knowledge/supabase/migrations/20261027085600_hub_today_answered.sql';
export const hash = value => createHash('sha256').update(value).digest('hex');
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[a-z][a-z0-9_]*$/;
export const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const identifier = value => { guard(NAME.test(value), 'sql_identifier'); return '"' + value + '"'; };
const json = value => { try { return JSON.parse(String(value)); } catch { throw new GuardFailure('json'); } };
const equals = (left,right) => JSON.stringify(left) === JSON.stringify(right);
const digestSql = sql => `(select encode(sha256(convert_to(coalesce(string_agg(v,'' order by v),''),'UTF8')),'hex') from (${sql}) z)`;
const rowDigest = table => `jsonb_build_object('name',${literal(table)},'count',(select count(*) from public.${identifier(table)}),'sha256',${digestSql(`select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') v from public.${identifier(table)} t`)})`;

export function validateManifest(m, now=Date.now()) {
  guard(m?.format === 'hub-answers-release-v1' && m.repository === REPO && m.projectRef === PROJECT, 'manifest_identity');
  guard(SHA.test(m.sourceCommit||'') && /^claude\/hub-answers-ops-[a-z0-9-]+$/.test(m.branch||''), 'manifest_source_branch');
  guard(['preflight','apply'].includes(m.phase) && m.version === VERSION && m.migration === MIGRATION && m.name === 'hub_today_answered', 'manifest_scope');
  for (const field of ['migrationSha256','oldBodySha256','newBodySha256','safetySha256']) guard(HASH.test(m[field]||''), 'manifest_hashes');
  guard(Number.isFinite(Date.parse(m.expiresAt)) && now < Date.parse(m.expiresAt) && Date.parse(m.expiresAt) - now <= 24*3600000, 'manifest_expiration');
  guard(m.baseline === null || m.baseline?.file === 'baseline.json' && HASH.test(m.baseline.sha256||''), 'manifest_baseline');
  guard(m.phase !== 'apply' || m.baseline !== null, 'apply_requires_preflight');
  validateBackup(m.backup, now);
  return m;
}
export function validateBackup(b, now=Date.now()) {
  guard(b?.repository === REPO && b.workflowPath === WORKFLOW && b.branch === 'main' && b.conclusion === 'success', 'backup_identity');
  guard(Number.isSafeInteger(b.runId) && Number.isSafeInteger(b.artifactId) && b.runId > 0 && b.artifactId > 0 && SHA.test(b.headSha||''), 'backup_ids');
  guard(/^supabase-\d{8}T\d{6}Z$/.test(b.artifactName||'') && /^sha256:[a-f0-9]{64}$/.test(b.artifactDigest||'') && HASH.test(b.workflowSha256||''), 'backup_digest');
  const created = Date.parse(b.createdAt);
  guard(Number.isFinite(created) && created <= now && now-created < 24*3600000 && b.encryptedArchiveVerified === true, 'backup_fresh_encrypted');
}
export function validateDispatch(env,event,m) {
  const ref = `refs/heads/${m.branch}`;
  guard(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === REPO, 'github_dispatch');
  guard(env.GITHUB_REF_TYPE === 'branch' && env.GITHUB_REF === ref && env.GITHUB_WORKFLOW_REF === `${REPO}/${WORKFLOW}@${ref}`, 'github_workflow');
  guard(SHA.test(env.GITHUB_SHA||'') && event?.inputs?.approved_ops_sha === env.GITHUB_SHA && Object.keys(event.inputs).length === 1, 'approved_ops_sha');
  guard(event?.repository?.full_name === REPO && [m.branch,ref].includes(event.ref), 'event_repository_ref');
}
export function validateEncryptedZip(bytes,name) {
  guard(Buffer.isBuffer(bytes) && bytes.length > 100 && bytes.length < 32*1024*1024, 'backup_zip_size');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(bytes.readUInt32LE(i)===0x06054b50) { end=i; break; }
  guard(end>=0 && bytes.readUInt16LE(end+8)===1 && bytes.readUInt16LE(end+10)===1, 'backup_zip_single_entry');
  const central=bytes.readUInt32LE(end+16);
  guard(central+46<=bytes.length && bytes.readUInt32LE(central)===0x02014b50, 'backup_zip_central');
  const n=bytes.readUInt16LE(central+28), compressed=bytes.readUInt32LE(central+20), length=bytes.readUInt32LE(central+24);
  guard(bytes.subarray(central+46,central+46+n).toString()===`${name}.tar.gz.gpg` && compressed>0 && compressed<32*1024*1024 && length>100 && length<32*1024*1024, 'backup_zip_filename');
  const local=bytes.readUInt32LE(central+42);
  guard(local+30<=bytes.length && bytes.readUInt32LE(local)===0x04034b50, 'backup_zip_local');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28), method=bytes.readUInt16LE(central+10);
  guard(start+compressed<=central && [0,8].includes(method), 'backup_zip_compression');
  const content=method===8?inflateRawSync(bytes.subarray(start,start+compressed),{maxOutputLength:32*1024*1024}):bytes.subarray(start,start+compressed);
  guard(content.length===length && content[0]===0x8c && content[2]===4 && content[3]===9, 'backup_openpgp_aes256');
  return true;
}
async function verifyBackupOnline(m,env) {
  const get=async (endpoint,binary=false) => {
    const response=await fetch(`https://api.github.com/repos/${REPO}/${endpoint}`,{headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(60000)});
    guard(response.ok,'backup_api');
    return binary?Buffer.from(await response.arrayBuffer()):response.json();
  };
  const b=m.backup;
  const [run,artifact,workflow]=await Promise.all([get(`actions/runs/${b.runId}`),get(`actions/artifacts/${b.artifactId}`),get(`contents/${WORKFLOW}?ref=${b.headSha}`)]);
  guard(run.status==='completed' && run.conclusion==='success' && run.head_branch==='main' && run.head_sha===b.headSha && run.path===WORKFLOW && run.repository?.full_name===REPO, 'backup_run_live');
  guard(artifact.id===b.artifactId && artifact.name===b.artifactName && artifact.digest===b.artifactDigest && artifact.expired===false && artifact.created_at===b.createdAt && artifact.workflow_run?.id===b.runId && artifact.workflow_run.head_sha===b.headSha, 'backup_artifact_live');
  guard(workflow.encoding==='base64' && hash(Buffer.from(workflow.content,'base64'))===b.workflowSha256, 'backup_workflow_live');
  const bytes=await get(`actions/artifacts/${b.artifactId}/zip`,true);
  guard(`sha256:${hash(bytes)}`===b.artifactDigest,'backup_download_digest');
  validateEncryptedZip(bytes,b.artifactName);
  validateBackup(b);
}

export function functionInfoSql() {
  return `(select jsonb_build_object('bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'owner',pg_get_userbyid(p.proowner),'securityInvoker',not p.prosecdef,'language',l.lanname,'returnType',format_type(p.prorettype,null),'volatility',p.provolatile::text,'searchPath',p.proconfig,'acl',coalesce(p.proacl,acldefault('f',p.proowner))::text,'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'public',exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${literal(SIGNATURE)}))`;
}
export function snapshotBody(tables) {
  return `select jsonb_build_object('format','hub-answers-snapshot-v1','database',current_database(),'role',current_user,
    'function',${functionInfoSql()},
    'tableNames',(select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
    'tables',jsonb_build_array(${tables.filter(t=>t!=='dashboard_schema_versions').map(rowDigest).join(',')}),
    'tableSecurity',${digestSql("select to_jsonb(c)::text v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','S')")},
    'columns',${digestSql("select to_jsonb(a)::text||coalesce(pg_get_expr(d.adbin,d.adrelid),'') v from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname='public' and a.attnum>0 and not a.attisdropped")},
    'constraints',${digestSql("select to_jsonb(c)::text v from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'")},
    'policies',${digestSql("select to_jsonb(p)::text v from pg_policies p where schemaname='public'")},
    'domains',${digestSql("select to_jsonb(t)::text v from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='d'")},
    'roles',${digestSql("select to_jsonb(r)::text v from pg_roles r union all select to_jsonb(m)::text from pg_auth_members m")},
    'otherFunctions',${digestSql(`select to_jsonb(p)::text v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid<>to_regprocedure(${literal(SIGNATURE)})`)},
    'oldHistory',${digestSql(`select to_jsonb(h)::text v from supabase_migrations.schema_migrations h where version<>${literal(VERSION)}`)},
    'releaseHistory',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsCount',cardinality(statements),'sourceSha256',encode(sha256(convert_to(statements[1],'UTF8')),'hex'))),'[]'::jsonb) from supabase_migrations.schema_migrations where version=${literal(VERSION)}),
    'otherMarkers',${digestSql("select to_jsonb(m)::text v from public.dashboard_schema_versions m where app_id<>'knowledge-dashboard'")},
    'knowledgeMarker',(select migration from public.dashboard_schema_versions where app_id='knowledge-dashboard'),
    'activity',(select jsonb_build_object('date',public.jst_today(),'hubDate',hub.value->'date','todayAnswered',hub.value->'todayAnswered',
      'oldContractSha256',encode(sha256(convert_to((hub.value-'date'-'todayAnswered')::text,'UTF8')),'hex'),
      'learning',public.get_learning_summary()->'today'->'answered','recorded',(select count(*) from public.quiz_log where asked_on=public.jst_today()))
      from (select public.get_knowledge_hub_summary() as value) hub)
  )`;
}
export function validateSnapshot(s,m,phase) {
  guard(s?.format==='hub-answers-snapshot-v1' && s.database==='postgres' && s.role==='postgres','snapshot_identity');
  const f=s.function;
  guard(f?.bodySha256===(phase==='before'?m.oldBodySha256:m.newBodySha256) && f.owner==='postgres' && f.securityInvoker===true && f.language==='sql' && f.returnType==='jsonb' && f.volatility==='s' && equals(f.searchPath,['search_path=public, pg_temp']), 'snapshot_function');
  guard(f.service===true && f.anon===false && f.authenticated===false && f.public===false, 'snapshot_execute');
  guard(Array.isArray(s.tableNames) && s.tableNames.length>0 && s.tableNames.length<=300 && s.tableNames.every(t=>NAME.test(t)) && new Set(s.tableNames).size===s.tableNames.length, 'snapshot_tables');
  for(const t of ['knowledge','quiz_log','review_queue','dashboard_schema_versions']) guard(s.tableNames.includes(t),'snapshot_required_tables');
  guard(Array.isArray(s.tables) && s.tables.length===s.tableNames.length-1 && s.tables.every(t=>NAME.test(t.name) && Number.isSafeInteger(t.count) && t.count>=0 && HASH.test(t.sha256)), 'snapshot_digests');
  for(const key of ['tableSecurity','columns','constraints','policies','domains','roles','otherFunctions','oldHistory','otherMarkers']) guard(HASH.test(s[key]||''),'snapshot_catalog_digest');
  guard(/^\d{4}-\d{2}-\d{2}$/.test(s.activity?.date||'') && HASH.test(s.activity?.oldContractSha256||'')
    && Number.isSafeInteger(s.activity.learning) && s.activity.learning>=0 && s.activity.learning===s.activity.recorded,'snapshot_activity_minimal');
  guard(s.knowledgeMarker===(phase==='before'?'20261026040000_learning_read_models':`${VERSION}_hub_today_answered`),'snapshot_marker');
  if(phase==='before') guard(equals(s.releaseHistory,[]),'migration_already_applied');
  else {
    guard(s.releaseHistory?.length===1 && s.releaseHistory[0].version===VERSION && s.releaseHistory[0].name==='hub_today_answered' && s.releaseHistory[0].statementsCount===1 && s.releaseHistory[0].sourceSha256===m.migrationSha256,'snapshot_history');
    guard(s.activity.hubDate===s.activity.date && s.activity.todayAnswered===s.activity.learning && s.activity.todayAnswered===s.activity.recorded,'snapshot_dated_count');
  }
  return s;
}
export function compareSnapshots(before,after) {
  for(const key of ['tableNames','tables','tableSecurity','columns','constraints','policies','domains','roles','otherFunctions','oldHistory','otherMarkers']) guard(equals(before[key],after[key]),`preserve_${key}`);
  const omitBody = f => Object.fromEntries(Object.entries(f).filter(([key])=>key!=='bodySha256'));
  guard(equals(omitBody(before.function),omitBody(after.function)),'preserve_function_security');
  guard(before.activity.oldContractSha256===after.activity.oldContractSha256,'preserve_hub_contract');
}
const readonly = body => `begin transaction isolation level repeatable read read only; set local statement_timeout='120s'; ${body}; commit;`;
export function applySql(m,source,tables,baseline) {
  guard(hash(lf(source))===m.migrationSha256,'sql_source_hash');
  const body=lf(source).replace(/\nbegin;\n/,'\n').replace(/\ncommit;\s*$/,'\n');
  guard(!/^\s*(begin|commit|rollback)\s*;/im.test(body),'single_atomic_transaction');
  const catalogKeys=['function','tableNames','tableSecurity','columns','constraints','policies','domains','roles','otherFunctions','oldHistory','otherMarkers','knowledgeMarker','releaseHistory'];
  const checks=catalogKeys.map(key=>`if b->${literal(key)} is distinct from ${literal(JSON.stringify(baseline[key]))}::jsonb then raise exception using errcode='P0001', message='baseline_changed'; end if;`).join('\n');
  const preservation=['tableNames','tables','tableSecurity','columns','constraints','policies','domains','roles','otherFunctions','oldHistory','otherMarkers'];
  return `begin transaction isolation level repeatable read;
set local statement_timeout='120s'; set local lock_timeout='5s';
select pg_advisory_xact_lock(270856319);
lock table ${tables.map(t=>`public.${identifier(t)}`).join(',')} in share row exclusive mode;
create temp table hub_answers_before as ${snapshotBody(tables)};
do $$ declare b jsonb; begin select * into b from hub_answers_before; ${checks} end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements) values (${literal(VERSION)},'hub_today_answered',array[${literal(lf(source))}]);
create temp table hub_answers_after as ${snapshotBody(tables)};
do $$ declare b jsonb; a jsonb; begin select * into b from hub_answers_before; select * into a from hub_answers_after;
${preservation.map(key=>`if b->${literal(key)} is distinct from a->${literal(key)} then raise exception using errcode='P0001',message='preservation_failed'; end if;`).join('\n')}
if (b->'function')-'bodySha256' is distinct from (a->'function')-'bodySha256' or a->'function'->>'bodySha256'<>${literal(m.newBodySha256)} then raise exception using errcode='P0001',message='function_security_or_body'; end if;
if b->'activity'->'oldContractSha256' is distinct from a->'activity'->'oldContractSha256' then raise exception using errcode='P0001',message='hub_contract_changed'; end if;
if a->'activity'->'hubDate' is distinct from a->'activity'->'date' or a->'activity'->'todayAnswered' is distinct from a->'activity'->'learning' or a->'activity'->'todayAnswered' is distinct from a->'activity'->'recorded' then raise exception using errcode='P0001',message='dated_count_mismatch'; end if;
if a->>'knowledgeMarker'<>${literal(`${VERSION}_hub_today_answered`)} or a->'releaseHistory' <> ${literal(JSON.stringify([{version:VERSION,name:'hub_today_answered',statementsCount:1,sourceSha256:m.migrationSha256}]))}::jsonb then raise exception using errcode='P0001',message='history_marker_failed'; end if;
end $$;
select jsonb_build_object('before',(select jsonb_build_object from hub_answers_before),'after',(select jsonb_build_object from hub_answers_after));
commit;`;
}

async function safeFile(file,max=32*1024*1024) { const stat=await lstat(file); guard(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'file_shape'); return readFile(file); }
export async function run({root=process.cwd(),env=process.env,execute=capture}={}) {
  const result={format:'hub-answers-result-v1',passed:false,phase:'unknown',applied:false,checks:[],failure:null};
  let outputReady=false;
  const output=path.join(root,'hub-answers-result');
  try {
    root=path.resolve(root); const bundle=path.join(root,BUNDLE);
    guard(await realpath(root)===root && await realpath(bundle)===bundle && fileURLToPath(import.meta.url)===path.join(bundle,'runner.mjs'),'bound_location');
    const bytes=await safeFile(path.join(bundle,'manifest.json'),1024*1024);
    guard(HASH.test(MANIFEST_SHA256)&&hash(bytes)===MANIFEST_SHA256,'immutable_manifest');
    const m=validateManifest(json(bytes)); result.phase=m.phase; result.sourceCommit=m.sourceCommit;
    guard(hash(await safeFile(path.join(bundle,'process-safety.mjs')))===m.safetySha256,'safety_file_hash');
    validateDispatch(env,json(await safeFile(env.GITHUB_EVENT_PATH,1024*1024)),m);
    const git=async args=>checkProcess(await execute('git',['--no-replace-objects',...args],{cwd:root,env:{...childEnvironment(env),GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'},timeout:30000}),'git_context').toString();
    guard((await git(['rev-parse','HEAD'])).trim()===env.GITHUB_SHA && (await git(['status','--porcelain','--untracked-files=all'])).trim()==='','clean_approved_head');
    await git(['merge-base','--is-ancestor',m.sourceCommit,'HEAD']);
    const changes=(await git(['diff','--name-only','-z',m.sourceCommit,'HEAD'])).split('\0').filter(Boolean);
    guard(changes.length>0&&changes.every(f=>f===WORKFLOW||f.startsWith(BUNDLE+'/')),'ops_diff_scope');
    const source=lf(await safeFile(path.join(root,MIGRATION)));
    guard(hash(source)===m.migrationSha256&&hash(lf(await git(['show',`${m.sourceCommit}:${MIGRATION}`])))===m.migrationSha256,'migration_source_hash');
    let baseline=null;
    if(m.baseline) { const raw=await safeFile(path.join(bundle,m.baseline.file),1024*1024); guard(hash(raw)===m.baseline.sha256,'baseline_hash'); baseline=validateSnapshot(json(raw),m,'before'); }
    await verifyBackupOnline(m,env); result.checks.push('github_context_source_scope','fresh_encrypted_backup');
    // Database secret is first read only after all immutable/GitHub/backup gates pass.
    const connection=parseDatabaseUrl(env.SUPABASE_DB_URL);
    const psql=async (input,args=[])=>checkProcess(await execute('psql',['-X','--no-password','--quiet','--no-align','--tuples-only','--set=ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate','--set=SHOW_CONTEXT=never',...args],{cwd:root,env:childEnvironment(env,connection),input,timeout:300000}),'psql');
    parseClientTls(await psql(undefined,['--field-separator','\t','--pset=footer=off','--command','\\conninfo']),connection);
    const profile=json(await psql(readonly(`select jsonb_build_object('database',current_database(),'role',current_user,'session',session_user,'readOnly',current_setting('transaction_read_only')='on','ssl',exists(select from pg_stat_ssl where pid=pg_backend_pid() and ssl),'admin',exists(select from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)),'tables',(select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')))`)));
    guard(profile.database==='postgres'&&profile.role==='postgres'&&profile.session==='postgres'&&profile.readOnly===true&&profile.ssl===true&&profile.admin===true,'db_identity_tls_visibility');
    guard(Array.isArray(profile.tables)&&profile.tables.every(t=>NAME.test(t))&&profile.tables.length<=300,'profile_tables');
    await mkdir(output,{recursive:false,mode:0o700}); outputReady=true;
    if(m.phase==='preflight') {
      const before=validateSnapshot(json(await psql(readonly(snapshotBody(profile.tables)))),m,'before');
      await writeFile(path.join(output,'before-snapshot.json'),JSON.stringify(before)+'\n',{mode:0o600});
      result.checks.push('readonly_preflight_old_body_security_history_marker');
    } else {
      guard(Date.now()<Date.parse(m.expiresAt),'approval_expired_before_ddl');
      const pair=json(await psql(applySql(m,source,profile.tables,baseline)));
      const before=validateSnapshot(pair.before,m,'before');
      const after=validateSnapshot(pair.after,m,'after');
      compareSnapshots(before,after); result.applied=true;
      await writeFile(path.join(output,'before-snapshot.json'),JSON.stringify(before)+'\n',{mode:0o600});
      await writeFile(path.join(output,'after-snapshot.json'),JSON.stringify(after)+'\n',{mode:0o600});
      result.checks.push('atomic_single_rpc_and_exact_history','all_original_table_domain_security_role_data_digests','dated_count_matches_knowledge');
    }
    result.passed=true;
  } catch(error) { result.failure=error instanceof GuardFailure?{check:error.check,code:error.code}:{check:'unexpected_failure',code:'INTERNAL_FAILURE'}; }
  if(outputReady) await writeFile(path.join(output,'release-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=process.argv.length===2?await run():{passed:false,failure:{check:'arguments',code:'GUARD_REJECTED'}};
  console.log(JSON.stringify(result)); if(!result.passed) process.exitCode=1;
}
