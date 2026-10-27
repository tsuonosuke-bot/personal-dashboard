// Bind with prepare-release.mjs. Never execute this unbound template against DB.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, lstat, realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_SHA256 = "049c2a9d0ba3f8f3c2da2a7eaa5ff6d487a1f3debc7a06669525ec9de4112e29";
export const BUNDLE = ".release/projects-goals-20261027";
export const REPO = "tsuonosuke-bot/personal-dashboard";
export const PROJECT_REF = "plwlxwidpqbunugfxjhp";
export const WORKFLOW = ".github/workflows/supabase-backup.yml";
export const CLI_VERSION = "2.117.0";
export const DERIVED_CACHES = Object.freeze(["project_todo_read_cache"]);
export const NEW_TABLES = Object.freeze({
  project_goal_requests: {
    columns: [
      "request_id:uuid:NO",
      "project_id:bigint:NO",
      "operation:text:NO",
      "payload:jsonb:NO",
      "result:jsonb:NO",
      "created_at:timestamp with time zone:NO",
    ],
    fk: 1,
    unique: 1,
    keys: ["f:project_id:projects:id:c", "p:request_id"],
    grants: ["SELECT", "INSERT"],
  },
  project_reviews: {
    columns: [
      "project_id:bigint:NO",
      "reviewed_at:timestamp with time zone:NO",
      "fingerprint:text:NO",
    ],
    fk: 1,
    unique: 1,
    keys: ["f:project_id:projects:id:c", "p:project_id"],
    grants: ["SELECT", "INSERT", "UPDATE"],
  },
  project_habits: {
    columns: [
      "project_id:bigint:NO",
      "habit_id:bigint:NO",
      "linked:boolean:NO",
      "created_at:timestamp with time zone:NO",
      "updated_at:timestamp with time zone:NO",
    ],
    fk: 2,
    unique: 1,
    keys: [
      "f:habit_id:habits:id:r",
      "f:project_id:projects:id:c",
      "p:project_id,habit_id",
    ],
    grants: ["SELECT", "INSERT", "UPDATE"],
  },
  project_schedule_operations: {
    columns: [
      "request_id:uuid:NO",
      "action_id:bigint:NO",
      "project_id:bigint:NO",
      "action_updated_at:timestamp with time zone:NO",
      "project_updated_at:timestamp with time zone:NO",
      "content:text:NO",
      "calendar:jsonb:NO",
      "stage:text:NO",
      "event_id:text:NO",
      "calendar_url:text:YES",
      "calendar_etag:text:YES",
      "todo_id:bigint:YES",
      "error_code:text:YES",
      "created_at:timestamp with time zone:NO",
      "updated_at:timestamp with time zone:NO",
    ],
    fk: 3,
    unique: 4,
    keys: [
      "f:action_id:project_actions:id:r",
      "f:project_id:projects:id:r",
      "f:todo_id:scheduled_actions:id:r",
      "p:request_id",
      "u:action_id",
      "u:event_id",
      "u:todo_id",
    ],
    grants: ["SELECT", "INSERT", "UPDATE"],
  },
});
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const PHASES = new Set(["preflight", "apply", "types", "verify"]);
const MAX_BYTES = 32 * 1024 * 1024;
export class GuardFailure extends Error {
  constructor(check, code = "GUARD_REJECTED") {
    super(check);
    this.check = check;
    this.code = code;
  }
}
export const guard = (value, check) => {
  if (!value) throw new GuardFailure(check);
};
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const lf = (value) => String(value).replace(/\r\n/g, "\n");
export const literal = (value) =>
  "'" + String(value).replaceAll("'", "''") + "'";
const identifier = (name) => {
  guard(NAME.test(name), "identifier");
  return '"' + name + '"';
};
const freeze = (value) => Object.freeze(value);
export function validateManifest(value, now = Date.now()) {
  const manifestKeys = [
    "format",
    "repository",
    "projectRef",
    "sourceCommit",
    "branch",
    "expiresAt",
    "phase",
    "cliVersion",
    "migrations",
    "functions",
    "newTables",
    "derivedCaches",
    "backup",
    "baseline",
  ];
  guard(
    value &&
      Object.keys(value).length === manifestKeys.length &&
      manifestKeys.every((key) => Object.hasOwn(value, key)),
    "manifest_exact_shape",
  );
  guard(
    value?.format === "projects-goals-release-v1" &&
      value.repository === REPO &&
      value.projectRef === PROJECT_REF,
    "manifest_identity",
  );
  guard(
    SHA.test(value.sourceCommit || "") &&
      /^codex\/projects-goals-ops-[a-z0-9-]+$/.test(value.branch || ""),
    "manifest_source_branch",
  );
  guard(
    Number.isFinite(now) &&
      Number.isFinite(Date.parse(value.expiresAt)) &&
      now < Date.parse(value.expiresAt) &&
      Date.parse(value.expiresAt) - now <= 72 * 3600000,
    "approval_expired",
  );
  guard(
    PHASES.has(value.phase) && value.cliVersion === CLI_VERSION,
    "manifest_phase_cli",
  );
  guard(
    Array.isArray(value.migrations) && value.migrations.length === 4,
    "manifest_migrations",
  );
  const versions = [
    "20261027030001",
    "20261027030002",
    "20261027030003",
    "20261027030004",
  ];
  guard(
    JSON.stringify(value.newTables) ===
      JSON.stringify(Object.keys(NEW_TABLES)) &&
      JSON.stringify(value.derivedCaches) === JSON.stringify(DERIVED_CACHES),
    "manifest_table_policy",
  );
  for (const [index, item] of value.migrations.entries())
    guard(
      item.version === versions[index] &&
        NAME.test(item.name || "") &&
        item.file ===
          `apps/hub/supabase/migrations/${item.version}_${item.name}.sql` &&
        HASH.test(item.sha256 || "") &&
        HASH.test(item.applySha256 || "") &&
        item.applyFile === `${item.version}.apply.sql`,
      "manifest_migration",
    );
  guard(
    Array.isArray(value.functions) &&
      value.functions.length >= 12 &&
      value.functions.length <= 30,
    "manifest_functions",
  );
  guard(
    new Set(value.functions.map((f) => f.signature)).size ===
      value.functions.length,
    "manifest_function_duplicates",
  );
  for (const f of value.functions)
    guard(
      /^public\.[a-z][a-z0-9_]*\([a-z,\[\] ]*\)$/.test(f.signature || "") &&
        HASH.test(f.bodySha256 || "") &&
        ["sql", "plpgsql"].includes(f.language) &&
        ["public", "''"].includes(f.searchPath) &&
        ["jsonb", "text", "bigint", "integer", "void"].includes(f.returnType) &&
        ["s", "i", "v"].includes(f.volatility),
      "manifest_function_shape",
    );
  guard(
    value.baseline === null ||
      (value.baseline?.file === "baseline.json" &&
        HASH.test(value.baseline.sha256 || "")),
    "manifest_baseline",
  );
  if (value.phase === "verify")
    guard(value.baseline !== null, "verify_baseline_required");
  if (value.phase === "apply") validateBackup(value.backup, now);
  return freeze(value);
}
export function validateBackup(value, now = Date.now()) {
  const keys = [
    "repository",
    "workflowPath",
    "branch",
    "conclusion",
    "runId",
    "headSha",
    "artifactId",
    "artifactName",
    "artifactDigest",
    "encryptedArchiveVerified",
    "createdAt",
  ];
  guard(
    value &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "backup_exact_shape",
  );
  guard(
    value?.repository === REPO &&
      value.workflowPath === WORKFLOW &&
      value.branch === "main" &&
      value.conclusion === "success",
    "backup_identity",
  );
  guard(
    Number.isSafeInteger(value.runId) &&
      value.runId > 0 &&
      SHA.test(value.headSha || "") &&
      Number.isSafeInteger(value.artifactId) &&
      value.artifactId > 0,
    "backup_identifiers",
  );
  guard(
    /^supabase-\d{8}T\d{6}Z$/.test(value.artifactName || "") &&
      /^sha256:[a-f0-9]{64}$/.test(value.artifactDigest || "") &&
      value.encryptedArchiveVerified === true,
    "encrypted_backup_required",
  );
  guard(
    Number.isFinite(Date.parse(value.createdAt)) &&
      Date.parse(value.createdAt) <= now &&
      now - Date.parse(value.createdAt) < 24 * 3600000,
    "backup_recent",
  );
}
export function validateDispatch(env, event, manifest) {
  const ref = `refs/heads/${manifest.branch}`;
  guard(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "workflow_dispatch_required",
  );
  guard(
    env.GITHUB_REPOSITORY === REPO &&
      env.GITHUB_REF === ref &&
      env.GITHUB_REF_TYPE === "branch",
    "repository_ref",
  );
  guard(
    env.GITHUB_WORKFLOW_REF === `${REPO}/${WORKFLOW}@${ref}`,
    "workflow_identity",
  );
  guard(
    SHA.test(env.GITHUB_SHA || "") &&
      event?.inputs?.approved_ops_sha === env.GITHUB_SHA,
    "approved_ops_sha",
  );
  guard(
    event?.repository?.full_name === REPO &&
      [manifest.branch, ref].includes(event.ref) &&
      Object.keys(event.inputs).length === 1,
    "dispatch_event",
  );
}
export function parseDatabaseUrl(raw, ref = PROJECT_REF) {
  guard(
    typeof raw === "string" &&
      raw.length > 0 &&
      raw.length < 8192 &&
      !/[\u0000-\u0020\u007f]/.test(raw),
    "db_url_shape",
  );
  let url, user, password;
  try {
    url = new URL(raw);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new GuardFailure("db_url_parse");
  }
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const pooler = /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/.test(
    url.hostname,
  );
  guard(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      !url.hash &&
      (direct || pooler),
    "db_host_protocol",
  );
  guard(
    user === (direct ? "postgres" : `postgres.${ref}`) &&
      password.length > 0 &&
      !/[\u0000-\u001f\u007f]/.test(password),
    "db_privileged_project_user",
  );
  guard(
    (url.port || "5432") === "5432" && url.pathname === "/postgres",
    "db_port_name",
  );
  const params = [...url.searchParams.entries()];
  guard(
    params.length === 0 ||
      (params.length === 1 &&
        params[0][0] === "sslmode" &&
        ["require", "verify-ca", "verify-full"].includes(params[0][1])),
    "db_ssl_params",
  );
  url.searchParams.set("sslmode", params[0]?.[1] || "require");
  return freeze({
    host: url.hostname,
    user,
    password,
    port: "5432",
    database: "postgres",
    sslmode: url.searchParams.get("sslmode"),
    cliUrl: url.toString(),
  });
}
export function childEnvironment(env, connection) {
  const value = {
    CI: "true",
    NO_COLOR: "1",
    LANG: "C",
    LC_ALL: "C",
    LC_MESSAGES: "C",
    SUPABASE_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
    SUPABASE_NO_KEYRING: "1",
  };
  for (const key of ["PATH", "HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (typeof env[key] === "string") value[key] = env[key];
  if (connection)
    Object.assign(value, {
      PGHOST: connection.host,
      PGPORT: connection.port,
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGDATABASE: "postgres",
      PGSSLMODE: connection.sslmode,
      PGCONNECT_TIMEOUT: "15",
      PGAPPNAME: "projects-goals-release-20261027",
      PSQLRC: "/dev/null",
      PSQL_HISTORY: "/dev/null",
    });
  return value;
}
export async function capture(
  command,
  args,
  { env, cwd, input, timeout = 240000, limit = MAX_BYTES } = {},
) {
  return new Promise((resolve) => {
    let child,
      timer,
      killTimer,
      size = 0,
      kind = "";
    const out = [],
      err = [];
    const stop = (reason) => {
      kind ||= reason;
      child?.kill("SIGTERM");
      killTimer ||= setTimeout(() => child?.kill("SIGKILL"), 2000);
    };
    const collect = (list) => (chunk) => {
      size += chunk.length;
      if (size > limit) return stop("OUTPUT_LIMIT");
      list.push(chunk);
    };
    try {
      child = spawn(command, args, {
        env,
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return resolve({
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        kind: "SPAWN_FAILED",
      });
    }
    timer = setTimeout(() => stop("TIMEOUT"), timeout);
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    child.stdout.on("error", () => stop("STREAM_FAILED"));
    child.stderr.on("error", () => stop("STREAM_FAILED"));
    child.on("error", () => {
      kind = "SPAWN_FAILED";
    });
    child.stdin.on("error", () => {});
    child.on("close", (status) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        status,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        kind,
      });
    });
    child.stdin.end(input);
  });
}
export function checkProcess(value, check) {
  if (value.status === 0 && !value.kind) return value.stdout;
  // Never preserve message/stack, argv, SQL echo, subprocess output or row text.
  const state = /\b(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/.exec(
    String(value.stderr),
  )?.[1];
  throw new GuardFailure(
    check,
    state ||
      (["OUTPUT_LIMIT", "TIMEOUT", "SPAWN_FAILED", "STREAM_FAILED"].includes(
        value.kind,
      )
        ? value.kind
        : "PROCESS_FAILED"),
  );
}
export function parseClientTls(raw, connection) {
  const text = lf(raw).trimEnd();
  guard(text.length > 0 && text.length < 32768, "tls_shape");
  const lines = text.split("\n");
  if (lines.some((line) => line.includes("\t"))) {
    const pairs = lines.map((line) => line.split("\t"));
    guard(
      pairs.every((p) => p.length === 2) &&
        new Set(pairs.map((p) => p[0])).size === pairs.length,
      "tls_tabular_shape",
    );
    const fields = Object.fromEntries(pairs);
    guard(
      fields.Database === "postgres" &&
        fields["Client User"] === connection.user &&
        fields.Host === connection.host &&
        fields["Server Port"] === "5432",
      "tls_target",
    );
    guard(
      fields["SSL Connection"] === "true" &&
        /^TLSv\d+(?:\.\d+)?$/.test(fields["SSL Protocol"] || "") &&
        /^[A-Za-z0-9_-]+$/.test(fields["SSL Cipher"] || "") &&
        !["none", "unknown"].includes(fields["SSL Cipher"]),
      "tls_required",
    );
  } else {
    guard(lines.length === 2, "tls_classic_shape");
    const target =
      /^You are connected to database "([^"]+)" as user "([^"]+)" on host "([^"]+)"(?: \(address "[^"]+"\))? at port "(\d+)"\.$/.exec(
        lines[0],
      );
    guard(
      target &&
        target[1] === "postgres" &&
        target[2] === connection.user &&
        target[3] === connection.host &&
        target[4] === "5432",
      "tls_target",
    );
    guard(
      /^SSL connection \(protocol: TLSv\d+(?:\.\d+)?, cipher: [A-Za-z0-9_-]+, (?:bits: [1-9]\d*, )?compression: (?:on|off)(?:, ALPN: [A-Za-z0-9_./-]+)?\)$/.test(
        lines[1],
      ),
      "tls_required",
    );
  }
  return true;
}
const transaction = (sql) =>
  `begin transaction isolation level repeatable read read only;\nset local statement_timeout='120s';\n${sql}\ncommit;\n`;
const listSql = (list) => list.map(literal).join(",");
export function profileSql(manifest) {
  const signatures = listSql(manifest.functions.map((f) => f.signature));
  return transaction(`select jsonb_build_object('database',current_database(),'currentUser',current_user,'sessionUser',session_user,
    'readOnly',current_setting('transaction_read_only')='on','admin',exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)),
    'publicCreate',has_schema_privilege(current_user,'public','CREATE'),
    'history',to_regclass('supabase_migrations.schema_migrations') is not null,
    'historyInsert',has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT'),
    'markerWrite',has_table_privilege(current_user,'public.dashboard_schema_versions','UPDATE'),
    'replacementFunctionOwnership',not exists(select 1 from pg_proc p where p.oid in(select to_regprocedure(s) from unnest(array[${signatures}]) s) and not pg_has_role(current_user,p.proowner,'USAGE')),
    'references',has_table_privilege(current_user,'public.projects','REFERENCES') and has_table_privilege(current_user,'public.project_actions','REFERENCES') and has_table_privilege(current_user,'public.habits','REFERENCES') and has_table_privilege(current_user,'public.scheduled_actions','REFERENCES'),
    'tables',coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'read',has_table_privilege(current_user,c.oid,'SELECT'),
      'owner',pg_has_role(current_user,c.relowner,'USAGE'),'fullVisibility',not c.relforcerowsecurity or exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),'[]'::jsonb));`);
}
export function validateProfile(value) {
  guard(
    value?.database === "postgres" &&
      value.currentUser === "postgres" &&
      value.sessionUser === "postgres",
    "database_identity",
  );
  for (const key of [
    "readOnly",
    "admin",
    "publicCreate",
    "history",
    "historyInsert",
    "markerWrite",
    "replacementFunctionOwnership",
    "references",
  ])
    guard(value[key] === true, `privilege_${key}`);
  guard(
    Array.isArray(value.tables) &&
      value.tables.length > 0 &&
      value.tables.length <= 300,
    "public_table_inventory",
  );
  guard(
    new Set(value.tables.map((t) => t.name)).size === value.tables.length,
    "table_inventory_duplicate",
  );
  for (const row of value.tables)
    guard(
      NAME.test(row.name) && row.read === true && row.fullVisibility === true,
      "table_privileges_visibility",
    );
  for (const name of [
    "projects",
    "project_actions",
    "project_items",
    "project_milestones",
    "project_action_todos",
    "scheduled_actions",
    "scheduled_action_schedule_history",
    "habits",
    "habit_logs",
    "wants",
    "idea_inbox",
    "project_todo_read_cache",
  ])
    guard(
      value.tables.some((t) => t.name === name),
      "required_domain_tables",
    );
  return value.tables.map((t) => t.name).sort();
}
const digestExpression = (name) =>
  `(select jsonb_build_object('name',${literal(name)},'count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex')) from public.${identifier(name)} t)`;
export function snapshotSql(tables, manifest) {
  const preserved = tables.filter(
    (name) =>
      name !== "dashboard_schema_versions" &&
      !Object.hasOwn(NEW_TABLES, name) &&
      !DERIVED_CACHES.includes(name),
  );
  const versions = listSql(manifest.migrations.map((m) => m.version));
  const functions = manifest.functions
    .map(
      (
        f,
      ) => `jsonb_build_object('signature',${literal(f.signature)},'present',to_regprocedure(${literal(f.signature)}) is not null,
    'bodySha256',(select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=to_regprocedure(${literal(f.signature)})),
    'language',(select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${literal(f.signature)})),
    'returnType',(select format_type(prorettype,null) from pg_proc where oid=to_regprocedure(${literal(f.signature)})),
    'volatility',(select provolatile::text from pg_proc where oid=to_regprocedure(${literal(f.signature)})),
    'securityInvoker',(select not prosecdef from pg_proc where oid=to_regprocedure(${literal(f.signature)})),
    'searchPath',(select array_to_string(proconfig,',') from pg_proc where oid=to_regprocedure(${literal(f.signature)})),
    'serviceExecute',coalesce(has_function_privilege('service_role',to_regprocedure(${literal(f.signature)}),'EXECUTE'),false),
    'anonExecute',coalesce(has_function_privilege('anon',to_regprocedure(${literal(f.signature)}),'EXECUTE'),false),
    'authenticatedExecute',coalesce(has_function_privilege('authenticated',to_regprocedure(${literal(f.signature)}),'EXECUTE'),false),
    'publicExecute',exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=to_regprocedure(${literal(f.signature)}) and a.grantee=0 and a.privilege_type='EXECUTE'))`,
    )
    .join(",");
  const newTables = Object.keys(NEW_TABLES)
    .map(
      (
        name,
      ) => `jsonb_build_object('name',${literal(name)},'present',to_regclass('public.${name}') is not null,
    'rls',(select relrowsecurity from pg_class where oid=to_regclass('public.${name}')),
    'columns',coalesce((select jsonb_agg(column_name||':'||data_type||':'||is_nullable order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=${literal(name)}),'[]'::jsonb),
    'foreignKeys',(select count(*) from pg_constraint where conrelid=to_regclass('public.${name}') and contype='f'),
    'uniqueKeys',(select count(*) from pg_constraint where conrelid=to_regclass('public.${name}') and contype in ('u','p')),
    'keyShape',coalesce((select jsonb_agg(k.shape order by k.shape) from (select c.contype::text||':'||
      (select string_agg(a.attname,',' order by v.ord) from unnest(c.conkey) with ordinality v(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=v.num)
      ||case when c.contype='f' then ':'||(select relname from pg_class where oid=c.confrelid)||':'||
        (select string_agg(a.attname,',' order by v.ord) from unnest(c.confkey) with ordinality v(num,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=v.num)||':'||c.confdeltype::text else '' end as shape
      from pg_constraint c where c.conrelid=to_regclass('public.${name}') and c.contype in ('p','u','f')) k),'[]'::jsonb),
    'dangerousRolesHaveAnyPrivilege',exists(select 1 from pg_class c,aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=to_regclass('public.${name}') and a.grantee=0)
      or exists(select 1 from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v where has_table_privilege(r,to_regclass('public.${name}'),v)),
    'servicePrivileges',coalesce((select jsonb_agg(privilege_type order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name=${literal(name)} and grantee='service_role'),'[]'::jsonb))`,
    )
    .join(",");
  const digestValues = preserved.map(digestExpression).join(",");
  return transaction(`select jsonb_build_object('format','projects-goals-snapshot-v1','sourceCommit',${literal(manifest.sourceCommit)},'database',current_database(),'role',current_user,
    'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
    'tableNames',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
    'preservation',jsonb_build_array(${digestValues}),
    'derivedCaches',jsonb_build_array(${DERIVED_CACHES.filter((name) =>
      tables.includes(name),
    )
      .map(digestExpression)
      .join(",")}),
    'cacheIntegrity',jsonb_build_object('orphanRows',(select count(*) from public.project_todo_read_cache c where not exists(select 1 from public.scheduled_actions t where t.id=c.scheduled_action_id)),
      'duplicateKeys',(select count(*) from (select scheduled_action_id from public.project_todo_read_cache group by scheduled_action_id having count(*)>1) d)),
    'oldHistory',(select jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(h)::text,'' order by version),''),'UTF8')),'hex')) from supabase_migrations.schema_migrations h where version not in (${versions})),
    'releaseHistory',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsCount',cardinality(statements),'sourceSha256',encode(sha256(convert_to(statements[1],'UTF8')),'hex')) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations where version in (${versions})),
    'otherMarkers',(select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(m)::text,'' order by app_id),''),'UTF8')),'hex') from public.dashboard_schema_versions m where app_id<>'hub'),
    'hubMarker',(select migration from public.dashboard_schema_versions where app_id='hub'),
    'newTables',jsonb_build_array(${newTables}),'functions',jsonb_build_array(${functions}));`);
}
export function validateSnapshot(value, manifest, phase) {
  guard(
    value?.format === "projects-goals-snapshot-v1" &&
      value.sourceCommit === manifest.sourceCommit &&
      value.database === "postgres" &&
      value.role === "postgres" &&
      value.readOnly === true &&
      value.isolation === "repeatable read",
    "snapshot_identity",
  );
  guard(
    Array.isArray(value.preservation) &&
      value.preservation.length > 0 &&
      value.preservation.length <= 300,
    "snapshot_preservation",
  );
  for (const item of value.preservation)
    guard(
      NAME.test(item.name) &&
        Number.isSafeInteger(item.count) &&
        item.count >= 0 &&
        HASH.test(item.sha256 || ""),
      "snapshot_digest_shape",
    );
  guard(
    value.oldHistory &&
      HASH.test(value.oldHistory.sha256 || "") &&
      HASH.test(value.otherMarkers || ""),
    "snapshot_history_digest",
  );
  guard(
    Array.isArray(value.derivedCaches) &&
      JSON.stringify(value.derivedCaches.map((row) => row.name)) ===
        JSON.stringify(DERIVED_CACHES),
    "derived_cache_inventory",
  );
  for (const item of value.derivedCaches)
    guard(
      Number.isSafeInteger(item.count) &&
        item.count >= 0 &&
        HASH.test(item.sha256 || ""),
      "derived_cache_digest",
    );
  guard(
    value.cacheIntegrity?.orphanRows === 0 &&
      value.cacheIntegrity?.duplicateKeys === 0,
    "derived_cache_integrity",
  );
  guard(
    Array.isArray(value.releaseHistory) && value.releaseHistory.length <= 4,
    "snapshot_release_history",
  );
  for (const row of value.releaseHistory) {
    const expected = manifest.migrations.find((m) => m.version === row.version);
    guard(
      expected &&
        row.name === expected.name &&
        row.statementsCount === 1 &&
        row.sourceSha256 === expected.sha256,
      "recorded_source_mismatch",
    );
  }
  if (phase === "before") {
    guard(value.releaseHistory.length === 0, "preflight_history_absent");
    for (const t of value.newTables)
      guard(t.present === false, "preflight_new_tables_absent");
    return;
  }
  guard(
    value.releaseHistory.length === 4 &&
      value.hubMarker === "20261027030004_project_review_habit_snapshot",
    "after_history_marker",
  );
  guard(
    value.newTables.length === Object.keys(NEW_TABLES).length,
    "after_new_tables",
  );
  for (const t of value.newTables) {
    const expected = NEW_TABLES[t.name];
    guard(
      expected &&
        t.present === true &&
        t.rls === true &&
        t.dangerousRolesHaveAnyPrivilege === false,
      "after_table_security",
    );
    guard(
      JSON.stringify(t.columns) === JSON.stringify(expected.columns) &&
        t.foreignKeys === expected.fk &&
        t.uniqueKeys === expected.unique &&
        JSON.stringify(t.keyShape) === JSON.stringify(expected.keys),
      "after_table_schema",
    );
    guard(
      JSON.stringify(t.servicePrivileges) ===
        JSON.stringify([...expected.grants].sort()),
      "after_table_service_grants",
    );
  }
  guard(
    value.functions.length === manifest.functions.length,
    "after_function_count",
  );
  for (const f of value.functions) {
    const expected = manifest.functions.find(
      (x) => x.signature === f.signature,
    );
    guard(
      expected &&
        f.present === true &&
        f.bodySha256 === expected.bodySha256 &&
        f.language === expected.language &&
        f.returnType === expected.returnType &&
        f.volatility === expected.volatility &&
        f.securityInvoker === true &&
        f.searchPath ===
          `search_path=${expected.searchPath === "''" ? '""' : expected.searchPath}` &&
        f.serviceExecute === true &&
        f.anonExecute === false &&
        f.authenticatedExecute === false &&
        f.publicExecute === false,
      "after_function_definition_permissions",
    );
  }
}
export function compareSnapshots(before, after, manifest) {
  guard(
    before.sourceCommit === manifest.sourceCommit &&
      after.sourceCommit === manifest.sourceCommit,
    "comparison_source",
  );
  guard(
    JSON.stringify(before.preservation) === JSON.stringify(after.preservation),
    "original_domain_rows_changed",
  );
  guard(
    JSON.stringify(before.oldHistory) === JSON.stringify(after.oldHistory) &&
      before.otherMarkers === after.otherMarkers,
    "unrelated_history_marker_changed",
  );
  const added = after.tableNames.filter(
    (name) => !before.tableNames.includes(name),
  );
  guard(
    before.tableNames.every((name) => after.tableNames.includes(name)) &&
      JSON.stringify(added.sort()) ===
        JSON.stringify(Object.keys(NEW_TABLES).sort()),
    "table_scope_changed",
  );
}
export function validateTypes(source, connection) {
  guard(
    typeof source === "string" &&
      source.length > 1000 &&
      source.length < 8 * 1024 * 1024 &&
      source.startsWith("export type Json =") &&
      source.includes("export type Database =") &&
      source.includes("graphql_public:"),
    "type_shape",
  );
  const encoded = encodeURIComponent(connection.password);
  const secrets = [
    connection.password,
    encoded,
    encoded.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase()),
    connection.cliUrl,
    connection.host,
  ];
  guard(
    !secrets.some((value) => value && source.includes(value)) &&
      !/postgres(?:ql)?:\/\/|https?:\/\/|sb_secret_|sbp_[a-zA-Z0-9]+|Bearer |BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i.test(
        source,
      ),
    "type_secret_guard",
  );
  for (const name of Object.keys(NEW_TABLES))
    guard(source.includes(`${name}:`), "type_new_tables");
  return lf(source).trimEnd() + "\n";
}
async function file(filePath, limit = MAX_BYTES) {
  const info = await lstat(filePath);
  guard(
    info.isFile() && !info.isSymbolicLink() && info.size <= limit,
    "regular_bounded_file",
  );
  return readFile(filePath);
}
function parseJson(bytes) {
  try {
    return JSON.parse(String(bytes));
  } catch {
    throw new GuardFailure("invalid_json");
  }
}
export async function contextGate({
  root,
  env,
  event,
  manifest,
  execute = capture,
}) {
  validateManifest(manifest);
  validateDispatch(env, event, manifest);
  const run = async (args) =>
    checkProcess(
      await execute("git", ["--no-replace-objects", ...args], {
        cwd: root,
        env: {
          ...childEnvironment(env),
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        timeout: 30000,
      }),
      "git_context",
    ).toString("utf8");
  guard(
    (await run(["rev-parse", "HEAD"])).trim() === env.GITHUB_SHA,
    "checkout_head",
  );
  guard(
    (await run(["status", "--porcelain", "--untracked-files=all"])).trim() ===
      "",
    "checkout_clean",
  );
  await run(["merge-base", "--is-ancestor", manifest.sourceCommit, "HEAD"]);
  const changed = (
    await run(["diff", "--name-only", "-z", manifest.sourceCommit, "HEAD"])
  )
    .split("\0")
    .filter(Boolean);
  guard(
    changed.length > 0 &&
      changed.every(
        (name) => name === WORKFLOW || name.startsWith(BUNDLE + "/"),
      ),
    "ops_diff_scope",
  );
  for (const migration of manifest.migrations)
    guard(
      hash(
        lf(await run(["show", `${manifest.sourceCommit}:${migration.file}`])),
      ) === migration.sha256,
      "approved_source_hash",
    );
}
export async function run({
  root = process.cwd(),
  env = process.env,
  execute = capture,
} = {}) {
  let manifest,
    result = {
      format: "projects-goals-result-v1",
      passed: false,
      phase: "unknown",
      checks: [],
      appliedVersions: [],
      failure: null,
    };
  let outputReady = false;
  const output = path.join(root, "result-output");
  const publish = async () => {
    if (outputReady)
      await writeFile(
        path.join(output, "release-result.json"),
        JSON.stringify(result, null, 2) + "\n",
        { mode: 0o600 },
      );
  };
  try {
    root = path.resolve(root);
    guard((await realpath(root)) === root, "workspace_realpath");
    const bundle = path.join(root, BUNDLE);
    guard(
      (await realpath(bundle)) === bundle &&
        fileURLToPath(import.meta.url) === path.join(bundle, "ci-runner.mjs"),
      "bound_runner_location",
    );
    const bytes = await file(path.join(bundle, "manifest.json"), 1024 * 1024);
    guard(
      HASH.test(MANIFEST_SHA256) && hash(bytes) === MANIFEST_SHA256,
      "immutable_manifest_hash",
    );
    manifest = validateManifest(parseJson(bytes));
    result.phase = manifest.phase;
    result.sourceCommit = manifest.sourceCommit;
    result.opsCommit = SHA.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null;
    result.projectRef = PROJECT_REF;
    const event = parseJson(await file(env.GITHUB_EVENT_PATH, 1024 * 1024));
    await contextGate({ root, env, event, manifest, execute });
    for (const migration of manifest.migrations) {
      guard(
        hash(lf(await file(path.join(root, migration.file)))) ===
          migration.sha256,
        "checkout_migration_hash",
      );
      guard(
        hash(await file(path.join(bundle, migration.applyFile))) ===
          migration.applySha256,
        "apply_file_hash",
      );
    }
    let baseline;
    if (manifest.baseline) {
      const content = await file(
        path.join(bundle, manifest.baseline.file),
        1024 * 1024,
      );
      guard(hash(content) === manifest.baseline.sha256, "baseline_hash");
      baseline = parseJson(content);
      validateSnapshot(baseline, manifest, "before");
    }
    // First secret access occurs only after immutable bundle and GitHub gates.
    const connection = parseDatabaseUrl(env.SUPABASE_DB_URL);
    await mkdir(output, { recursive: false, mode: 0o700 });
    outputReady = true;
    const command = async (name, args, options) =>
      checkProcess(
        await execute(name, args, {
          cwd: root,
          env: childEnvironment(env),
          ...options,
        }),
        name,
      );
    const psql = async (input, args = []) =>
      command(
        "psql",
        [
          "-X",
          "--no-password",
          "--quiet",
          "--no-align",
          "--tuples-only",
          "--set=ON_ERROR_STOP=1",
          "--set=VERBOSITY=sqlstate",
          "--set=SHOW_CONTEXT=never",
          ...args,
        ],
        { env: childEnvironment(env, connection), input },
      );
    parseClientTls(
      await psql(undefined, [
        "--field-separator",
        "\t",
        "--pset=footer=off",
        "--command",
        "\\conninfo",
      ]),
      connection,
    );
    result.checks.push("client_tls");
    const tables = validateProfile(parseJson(await psql(profileSql(manifest))));
    result.checks.push("identity_privileges_visibility");
    const snapshot = async (phase) => {
      const value = parseJson(await psql(snapshotSql(tables, manifest)));
      validateSnapshot(value, manifest, phase);
      return value;
    };
    if (manifest.phase === "preflight") {
      const before = await snapshot("before");
      await writeFile(
        path.join(output, "before-snapshot.json"),
        JSON.stringify(before) + "\n",
        { mode: 0o600 },
      );
      result.checks.push("readonly_preflight");
    } else if (manifest.phase === "apply") {
      validateBackup(manifest.backup);
      const before = await snapshot("before");
      await writeFile(
        path.join(output, "before-snapshot.json"),
        JSON.stringify(before) + "\n",
        { mode: 0o600 },
      );
      for (const migration of manifest.migrations) {
        guard(
          Date.now() < Date.parse(manifest.expiresAt),
          "approval_expired_before_ddl",
        );
        await psql(await file(path.join(bundle, migration.applyFile)));
        result.appliedVersions.push(migration.version);
        await publish();
      }
      const after = await snapshot("after");
      compareSnapshots(before, after, manifest);
      result.derivedCacheChanged =
        JSON.stringify(before.derivedCaches) !==
        JSON.stringify(after.derivedCaches);
      result.checks.push(
        "definitions_security_history_marker",
        "original_domain_rows_preserved",
      );
      for (const name of Object.keys(NEW_TABLES)) {
        const count = parseJson(
          await psql(
            transaction(`select count(*) from public.${identifier(name)};`),
          ),
        );
        guard(count === 0, "new_tables_start_empty");
      }
      result.checks.push("new_tables_empty");
      await writeFile(
        path.join(output, "after-snapshot.json"),
        JSON.stringify(after) + "\n",
        { mode: 0o600 },
      );
    } else if (manifest.phase === "types") {
      await snapshot("after");
      guard(
        (await command("supabase", ["--version"], { timeout: 30000 }))
          .toString("utf8")
          .trim() === CLI_VERSION,
        "cli_pinned_version",
      );
      const types = validateTypes(
        (
          await command(
            "supabase",
            [
              "gen",
              "types",
              "typescript",
              "--db-url",
              connection.cliUrl,
              "--schema",
              "public,graphql_public",
            ],
            { timeout: 300000 },
          )
        ).toString("utf8"),
        connection,
      );
      await writeFile(path.join(output, "generated-database.types.ts"), types, {
        mode: 0o600,
      });
      result.typesSha256 = hash(types);
      result.typesMatch =
        types ===
        lf(
          await file(
            path.join(root, "packages/database-types/database.types.ts"),
          ),
        ).trimEnd() +
          "\n";
      result.checks.push("schema_types_secret_guard");
    } else {
      guard(baseline, "verify_baseline_required");
      const after = await snapshot("after");
      compareSnapshots(baseline, after, manifest);
      result.derivedCacheChanged =
        JSON.stringify(baseline.derivedCaches) !==
        JSON.stringify(after.derivedCaches);
      result.checks.push(
        "definitions_security_history_marker",
        "original_domain_rows_preserved",
      );
      await writeFile(
        path.join(output, "after-snapshot.json"),
        JSON.stringify(after) + "\n",
        { mode: 0o600 },
      );
    }
    result.passed = true;
  } catch (error) {
    result.failure =
      error instanceof GuardFailure
        ? { check: error.check, code: error.code }
        : { check: "unexpected_failure", code: "INTERNAL_FAILURE" };
  }
  try {
    await publish();
  } catch {
    result.passed = false;
    result.failure = { check: "result_publication", code: "OUTPUT_FAILED" };
  }
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2) {
    console.log(
      JSON.stringify({
        passed: false,
        failure: { check: "arguments", code: "GUARD_REJECTED" },
      }),
    );
    process.exitCode = 1;
  } else {
    const result = await run();
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  }
}
