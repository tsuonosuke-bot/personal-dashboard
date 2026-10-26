// This file is copied unchanged into the reviewed temporary operations commit.
// It has no dependency installation, network API, credential file, or shell step.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rename, lstat, realpath, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const APPROVAL = Object.freeze({
  repository: "tsuonosuke-bot/personal-dashboard",
  implementationHead: "0e74c32570dd61677f87050b1605f4a4306242af",
  projectRef: "plwlxwidpqbunugfxjhp",
  branch: "claude/performance-release-ops-20261026",
  expiresAt: "2026-10-28T00:00:00Z",
  bundle: ".release/performance-20261026",
  workflow: ".github/workflows/supabase-backup.yml",
  cliVersion: "2.117.0",
});

const HASHES = Object.freeze({
  "release-manifest.json": "c3dd67b9015434a95f7a17a22c660aba5a80d12ee81a7ec074b0c38f2c2ed28f",
  "verify-before.sql": "4d1dfaf17e17f40719049616d1fcee21c4b3e603c4a4a9b0f444ad5e72bb0e70",
  "verify-after.sql": "681970a977c84f068e823dfc941a26230f28a8e491f50d9b6ccfa00c2f03e9f9",
  "verification-expected.json": "0eddce1d9923615a34cd7247c45aaf26cf490df04c5be1defef61892d4c92891",
  "compare-verification-snapshots.mjs": "14a3d1efd4fba2e99b0d4565648a447f9662943302fb1accd03b69f2cc82a6d9",
});
const PHASES = new Set(["preflight", "apply", "types", "verify"]);
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d{14}$/;
const FILE_LIMIT = 4 * 1024 * 1024;
const OUTPUT_LIMIT = 32 * 1024 * 1024;
const DDL_EXISTING_TABLES = Object.freeze(["expenses", "quiz_log", "project_actions", "project_items", "wants", "want_routes"]);
const PRIVILEGE_CHECKS = Object.freeze(["database", "administratorRole", "readOnly", "publicSchema", "extensionSchema", "historySchema", "historyPrivileges", "markerPrivileges", "existingTableReadPrivileges", "existingTableFullVisibility", "ddlTableOwnership", "foreignKeyReferences", "replacementFunctionOwnership"]);
const SQL_ENV = Object.freeze({
  PGCONNECT_TIMEOUT: "15", PGAPPNAME: "performance-release-20261026",
  PSQL_HISTORY: "/dev/null", PSQLRC: "/dev/null",
});

export class GuardFailure extends Error {
  constructor(stage, check, code = "GUARD_REJECTED", detail = {}) {
    // Never accept a subprocess/exception message here.
    super(check);
    this.stage = stage;
    this.check = check;
    this.code = code;
    this.sqlLine = detail.sqlLine;
    this.schemaIdentifierClass = detail.schemaIdentifierClass;
  }
}
const reject = (stage, check, code, detail) => { throw new GuardFailure(stage, check, code, detail); };
const requireGuard = (value, stage, check) => { if (!value) reject(stage, check); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const lf = (value) => value.replace(/\r\n/g, "\n");
const normalizeTypes = (value) => lf(value).trimEnd() + "\n";
const get = (value, key) => key.split(".").reduce((row, part) => row?.[part], value);
const unwrap = (value) => Array.isArray(value) ? unwrap(value[0]) : value?.verification ?? value;
const inside = (root, target) => target === root || (!path.relative(root, target).startsWith("..") && !path.isAbsolute(path.relative(root, target)));

function parseJson(bytes, stage, check) {
  try { return JSON.parse(String(bytes)); }
  catch { reject(stage, check, "INVALID_JSON"); }
}

export function parsePlan(value, now = Date.now()) {
  const keys = ["format", "phase", "implementationHead", "expectedProjectRef", "branch", "expiresAt"];
  requireGuard(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), "context", "plan_shape");
  requireGuard(value.format === "performance-release-runner-v1" && PHASES.has(value.phase), "context", "plan_phase");
  requireGuard(value.implementationHead === APPROVAL.implementationHead && value.expectedProjectRef === APPROVAL.projectRef &&
    value.branch === APPROVAL.branch, "context", "plan_approval_identity");
  requireGuard(value.expiresAt === APPROVAL.expiresAt && Number.isFinite(now) && now < Date.parse(value.expiresAt), "context", "approval_expired");
  return Object.freeze({ ...value });
}

export function validateDispatch(env, event, plan) {
  const ref = `refs/heads/${plan.branch}`;
  requireGuard(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch", "context", "workflow_dispatch_required");
  requireGuard(env.GITHUB_REPOSITORY === APPROVAL.repository && env.GITHUB_REF === ref && env.GITHUB_REF_TYPE === "branch", "context", "workflow_repository_ref");
  requireGuard(env.GITHUB_WORKFLOW_REF === `${APPROVAL.repository}/${APPROVAL.workflow}@${ref}`, "context", "workflow_identity");
  requireGuard(SHA.test(env.GITHUB_SHA || "") && event?.inputs?.approved_ops_sha === env.GITHUB_SHA, "context", "dispatch_approved_ops_sha");
  requireGuard(event?.repository?.full_name === APPROVAL.repository && [ref, plan.branch].includes(event?.ref), "context", "dispatch_event_identity");
  requireGuard(event.inputs && Object.keys(event.inputs).length === 1, "context", "dispatch_inputs");
}

export function secretVariants(raw) {
  const values = new Set();
  if (typeof raw !== "string" || !raw) return [];
  values.add(raw);
  try { values.add(decodeURIComponent(raw)); } catch { /* Invalid URLs are rejected separately. */ }
  try {
    const url = new URL(raw);
    if (url.password) {
      values.add(url.password);
      const decoded = decodeURIComponent(url.password);
      values.add(decoded);
      values.add(encodeURIComponent(decoded));
      values.add(encodeURIComponent(decoded).replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase()));
    }
  } catch { /* Do not preserve or print parser exceptions. */ }
  return [...values].filter(Boolean).sort((left, right) => right.length - left.length);
}

export function redact(value, secrets) {
  let text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
  const marker = secrets.some((secret) => "[REDACTED]".includes(secret)) ? "" : "[REDACTED]";
  for (const secret of secrets) text = text.split(secret).join(marker);
  // Catch normalized URLs and userinfo even if a tool formats them differently.
  text = text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, marker)
    .replace(/(https?:\/\/)[^/@\s]+:[^@\s]*@/gi, `$1${marker}@`);
  // Redaction boundaries must not accidentally reconstruct a credential.
  while (secrets.some((secret) => text.includes(secret))) {
    for (const secret of secrets) text = text.split(secret).join("");
  }
  return text;
}

export function parseDatabaseUrl(raw, ref) {
  requireGuard(typeof raw === "string" && raw.length > 0 && raw.length < 8192 && !/[\u0000-\u0020\u007f]/.test(raw), "target", "database_url_shape");
  let url, username, password;
  try {
    url = new URL(raw);
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { reject("target", "database_url_parse"); }
  requireGuard(["postgres:", "postgresql:"].includes(url.protocol) && !url.hash, "target", "database_url_protocol");
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const pooler = /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/.test(url.hostname);
  requireGuard(direct || pooler, "target", "database_host");
  requireGuard(username === (direct ? "postgres" : `postgres.${ref}`) && password.length > 0 && !/[\u0000-\u001f\u007f]/.test(password), "target", "database_project_user");
  requireGuard((url.port || "5432") === "5432" && url.pathname === "/postgres", "target", "database_port_name");
  const params = [...url.searchParams.entries()];
  requireGuard(params.length === 0 || (params.length === 1 && params[0][0] === "sslmode" && ["require", "verify-ca", "verify-full"].includes(params[0][1])), "target", "database_ssl_required");
  const sslmode = params.length ? params[0][1] : "require";
  url.searchParams.set("sslmode", sslmode);
  return Object.freeze({
    host: url.hostname, port: "5432", user: username, password, database: "postgres", sslmode, cliUrl: url.toString(),
  });
}

function baseChildEnv(env) {
  // In particular, do not inherit libpq overrides, access tokens, backup secrets,
  // NODE_OPTIONS, shell startup hooks, or the complete Actions environment.
  const clean = { CI: "true", NO_COLOR: "1", SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", SUPABASE_NO_KEYRING: "1", LANG: "C", LC_ALL: "C", LC_MESSAGES: "C" };
  for (const name of ["PATH", "HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (typeof env[name] === "string") clean[name] = env[name];
  return clean;
}

export function libpqEnvironment(connection, env) {
  return { ...baseChildEnv(env), ...SQL_ENV,
    PGHOST: connection.host, PGPORT: connection.port, PGUSER: connection.user, PGPASSWORD: connection.password,
    PGDATABASE: connection.database, PGSSLMODE: connection.sslmode,
  };
}

export function parseClientTls(value, connection) {
  // PostgreSQL REL_18_STABLE src/bin/psql/command.c:
  // exec_command_conninfo uses PQsslInUse and prints the two-column
  // "SSL Connection" true/false row through pset.popt.topt. printSSLInfo uses
  // PQsslAttribute("protocol"/"cipher") for the older classic text format.
  // Only the fixed English, unaligned, tuples-only command below is accepted.
  const text = lf(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
  requireGuard(text.length > 0 && text.length < 32768 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text), "preflight", "client_conninfo_shape");
  const lines = text.trimEnd().split("\n");
  const protocol = (item) => /^TLSv\d+(?:\.\d+)?$/.test(item || "");
  const cipher = (item) => /^[A-Za-z0-9_-]+$/.test(item || "") && item !== "unknown" && item !== "none";
  if (lines.some((line) => line.includes("\t"))) {
    const names = new Set(["Database", "Client User", "Host", "Host Address", "Socket Directory", "Server Port", "Options", "Protocol Version", "Password Used", "GSSAPI Authenticated", "Backend PID", "SSL Connection", "SSL Library", "SSL Protocol", "SSL Key Bits", "SSL Cipher", "SSL Compression", "ALPN", "Superuser", "Hot Standby"]);
    const entries = lines.map((line) => line.split("\t"));
    requireGuard(entries.every((row) => row.length === 2 && names.has(row[0])) && new Set(entries.map((row) => row[0])).size === entries.length,
      "preflight", "client_conninfo_shape");
    const fields = Object.fromEntries(entries);
    requireGuard(fields.Database === "postgres" && fields["Client User"] === connection.user && fields.Host === connection.host && fields["Server Port"] === connection.port,
      "preflight", "client_conninfo_target");
    requireGuard(fields["SSL Connection"] === "true" && protocol(fields["SSL Protocol"]) && cipher(fields["SSL Cipher"]), "preflight", "client_tls_required");
    return { clientTlsVerified: true, format: "psql18-tabular" };
  }
  requireGuard(lines.length === 2, "preflight", "client_conninfo_shape");
  const target = /^You are connected to database "([^"]+)" as user "([^"]+)" on host "([^"]+)"(?: \(address "[^"]+"\))? at port "(\d+)"\.$/.exec(lines[0]);
  requireGuard(target && target[1] === "postgres" && target[2] === connection.user && target[3] === connection.host && target[4] === connection.port,
    "preflight", "client_conninfo_target");
  const ssl = /^SSL connection \(protocol: ([A-Za-z0-9.]+), cipher: ([A-Za-z0-9_-]+), (?:bits: [1-9]\d*, )?compression: (?:on|off)(?:, ALPN: [A-Za-z0-9_./-]+)?\)$/.exec(lines[1]);
  requireGuard(ssl && protocol(ssl[1]) && cipher(ssl[2]), "preflight", "client_tls_required");
  return { clientTlsVerified: true, format: "classic" };
}

export async function collectPreflight(psql, expected, connection, onClientTls = async () => {}) {
  const response = await psql("client-conninfo", ["--field-separator", "\t", "--pset=footer=off", "--command", "\\conninfo"]);
  // No SQL, including read-only metadata/snapshots, runs without client proof.
  const proof = parseClientTls(response.stdout, connection);
  await onClientTls(proof);
  const privilegeBytes = (await psql("privileges", [], ownershipSql(expected))).stdout;
  const privilege = parseJson(privilegeBytes, "preflight", "privileges_json");
  const checks = {
    identity: privilege?.format === "performance-release-privileges-v1" && privilege.currentUser === "postgres" && privilege.sessionUser === "postgres",
    clientTlsVerified: proof?.clientTlsVerified === true,
    backendSSL: privilege?.backendSSL === true,
    ...Object.fromEntries(PRIVILEGE_CHECKS.map((name) => [name, privilege?.checks?.[name] === true])),
  };
  return { proof, checks };
}

export function validatePreflight(collected) {
  requireGuard(collected.checks.clientTlsVerified, "preflight", "client_tls_required");
  requireGuard(collected.checks.identity, "preflight", "privileges_identity");
  for (const check of PRIVILEGE_CHECKS) requireGuard(collected.checks[check], "preflight", `privileges.${check}`);
  // backendSSL describes Supavisor -> PostgreSQL; it is diagnostic only.
}

export function classifyProcessFailure(stage, name, result) {
  const stderr = String(result.stderr || "");
  const sqlstate = /(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5})\b/.exec(stderr)?.[1];
  const line = /psql:[^\r\n]*:(\d+):\s+(?:ERROR|FATAL|PANIC):/.exec(stderr)?.[1];
  const classes = { "42P01": "relation", "42703": "column", "42883": "function", "42501": "permission", "23503": "constraint", "23505": "constraint", "23502": "column", "42P07": "relation", "42710": "schema_object" };
  const code = result.errorKind || sqlstate || "SUBPROCESS_EXIT";
  const detail = {
    ...(line && Number.isSafeInteger(Number(line)) ? { sqlLine: Number(line) } : {}),
    ...(classes[sqlstate] ? { schemaIdentifierClass: classes[sqlstate] } : {}),
  };
  return new GuardFailure(stage, name, code, detail);
}

export async function captureProcess(command, args, { cwd, env, input, timeout = 180000, limit = OUTPUT_LIMIT } = {}) {
  // No shell and no inherited stdio: even spawn errors can contain argv/URLs.
  return new Promise((resolve) => {
    let child, timer, killTimer, outputBytes = 0, errorKind = "";
    const stdout = [], stderr = [];
    const stop = (kind) => {
      if (!errorKind) errorKind = kind;
      child?.kill("SIGTERM");
      if (!killTimer) killTimer = setTimeout(() => child?.kill("SIGKILL"), 2000);
    };
    const collect = (chunks) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > limit) { stop("SUBPROCESS_OUTPUT_LIMIT"); return; }
      chunks.push(chunk);
    };
    try { child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { resolve({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), errorKind: "SUBPROCESS_SPAWN" }); return; }
    timer = setTimeout(() => stop("SUBPROCESS_TIMEOUT"), timeout);
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.stdout.on("error", () => stop("SUBPROCESS_STREAM"));
    child.stderr.on("error", () => stop("SUBPROCESS_STREAM"));
    child.on("error", () => { errorKind = "SUBPROCESS_SPAWN"; });
    child.stdin.on("error", () => { /* Exit status/error events remain authoritative. */ });
    child.on("close", (status) => {
      clearTimeout(timer); clearTimeout(killTimer);
      resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), errorKind });
    });
    child.stdin.end(input || undefined);
  });
}

async function regularFile(file, stage, check, limit = FILE_LIMIT) {
  let stat;
  try { stat = await lstat(file); } catch { reject(stage, check, "FILE_UNAVAILABLE"); }
  requireGuard(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, stage, check);
  return readFile(file);
}

export async function verifyBundle(bundle, root, read = regularFile) {
  const manifestBytes = await read(path.join(bundle, "release-manifest.json"), "bundle", "manifest_file");
  requireGuard(hash(manifestBytes) === HASHES["release-manifest.json"], "bundle", "manifest_sha256");
  const manifest = parseJson(manifestBytes, "bundle", "manifest_json");
  requireGuard(manifest.head === APPROVAL.implementationHead && manifest.expectedProjectRef === APPROVAL.projectRef &&
    Array.isArray(manifest.migrations) && manifest.migrations.length === 8, "bundle", "manifest_identity");
  const files = { ...HASHES };
  const versions = new Set();
  for (const [index, migration] of manifest.migrations.entries()) {
    requireGuard(migration.order === index + 1 && VERSION.test(migration.version) && !versions.has(migration.version) &&
      migration.file === `apps/${migration.app}/supabase/migrations/${migration.version}_${migration.name}.sql` &&
      ["finance", "knowledge", "hub"].includes(migration.app) && /^[a-z][a-z0-9_]*$/.test(migration.name) &&
      migration.applyFile === `${String(index + 1).padStart(2, "0")}-${migration.version}_${migration.name}.sql` &&
      SHA256.test(migration.sourceSha256) && SHA256.test(migration.applySha256), "bundle", "migration_manifest_shape");
    versions.add(migration.version);
    files[migration.applyFile] = migration.applySha256;
    const source = await read(path.join(root, migration.file), "bundle", "source_migration_file");
    const normalized = lf(source.toString("utf8"));
    requireGuard(hash(normalized) === migration.sourceSha256 && Buffer.byteLength(normalized) === migration.sourceBytes, "bundle", "source_migration_sha256");
  }
  for (const [name, expected] of Object.entries(files)) {
    const bytes = await read(path.join(bundle, name), "bundle", "bundle_file");
    requireGuard(hash(bytes) === expected, "bundle", "bundle_file_sha256");
    const migration = manifest.migrations.find((item) => item.applyFile === name);
    if (migration) requireGuard(bytes.length === migration.applyBytes, "bundle", "bundle_file_bytes");
  }
  const expected = parseJson(await read(path.join(bundle, "verification-expected.json"), "bundle", "verification_expected_file"), "bundle", "verification_expected_json");
  requireGuard(expected.sourceCommit === APPROVAL.implementationHead && expected.preservation?.tables?.length === 50 &&
    expected.functions?.length === 24 && expected.migrations?.length === 8, "bundle", "verification_expected_identity");
  for (const migration of manifest.migrations) {
    const item = expected.migrations.find((value) => value.version === migration.version);
    requireGuard(item?.path === migration.file && item.sqlLfSha256 === migration.sourceSha256 && item.name === migration.name, "bundle", "verification_migration_identity");
  }
  return { manifest, expected, files };
}

export function ownershipSql(expected) {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const tables = expected.preservation.tables.map((name) => {
    requireGuard(/^[a-z][a-z0-9_]*$/.test(name), "bundle", "ownership_table_identifier");
    return `(${literal(name)},to_regclass(${literal(`public.${name}`)}))`;
  }).join(",");
  const functions = expected.functions.filter((item) => item.expectedBeforePresent).map((item) => `(to_regprocedure(${literal(item.signature)}))`).join(",");
  requireGuard(functions.length > 0, "bundle", "ownership_function_identifiers");
  return `begin transaction isolation level repeatable read read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local search_path = pg_catalog, public;
with role_state as (select rolsuper,rolcanlogin,rolbypassrls from pg_roles where rolname=current_user),
table_owners as (select x.name,c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity from (values ${tables}) x(name,oid) left join pg_class c on c.oid=x.oid),
function_owners as (select p.oid,p.proowner from (values ${functions}) x(oid) left join pg_proc p on p.oid=x.oid)
select jsonb_build_object('format','performance-release-privileges-v1','currentUser',current_user,'sessionUser',session_user,
'backendSSL',coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false),
'checks',jsonb_build_object(
 'database',current_database()='postgres',
 'administratorRole',current_user='postgres' and session_user='postgres' and coalesce((select rolcanlogin from role_state),false),
 'readOnly',current_setting('transaction_read_only')='on' and current_setting('transaction_isolation')='repeatable read',
 'publicSchema',has_schema_privilege(current_user,'public','USAGE') and has_schema_privilege(current_user,'public','CREATE'),
 'extensionSchema',has_schema_privilege(current_user,'extensions','USAGE'),
 'historySchema',has_schema_privilege(current_user,'supabase_migrations','USAGE'),
 'historyPrivileges',has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT') and has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT'),
 'markerPrivileges',has_table_privilege(current_user,'public.dashboard_schema_versions','SELECT') and has_table_privilege(current_user,'public.dashboard_schema_versions','INSERT') and has_table_privilege(current_user,'public.dashboard_schema_versions','UPDATE'),
 'existingTableReadPrivileges',coalesce((select bool_and(oid is not null and has_table_privilege(current_user,oid,'SELECT')) from table_owners),false),
 'existingTableFullVisibility',coalesce((select bool_and(oid is not null and (coalesce((select rolsuper or rolbypassrls from role_state),false) or not relrowsecurity or (not relforcerowsecurity and pg_has_role(current_user,relowner,'USAGE')))) from table_owners),false),
 'ddlTableOwnership',coalesce((select bool_and(oid is not null and (coalesce((select rolsuper from role_state),false) or pg_has_role(current_user,relowner,'USAGE'))) from table_owners where name in (${DDL_EXISTING_TABLES.map(literal).join(",")})),false),
 'foreignKeyReferences',has_table_privilege(current_user,'public.review_queue','REFERENCES') and has_table_privilege(current_user,'public.review_batch_runs','REFERENCES') and has_table_privilege(current_user,'public.scheduled_actions','REFERENCES'),
 'replacementFunctionOwnership',coalesce((select bool_and(oid is not null and (coalesce((select rolsuper from role_state),false) or pg_has_role(current_user,proowner,'USAGE'))) from function_owners),false)
)) as privileges;
commit;
`;
}

export function validateSnapshot(value, phase, expected) {
  const snapshot = unwrap(value);
  requireGuard(snapshot?.format === expected.format && snapshot.phase === phase && snapshot.sourceCommit === APPROVAL.implementationHead,
    "verification", `${phase}.identity`);
  requireGuard(snapshot.environment?.transactionReadOnly === "on" && snapshot.environment?.isolation === "repeatable read" &&
    snapshot.environment?.database === "postgres" && snapshot.environment?.role === "postgres", "verification", `${phase}.readOnly`);
  for (const check of expected.expectedChecks[phase])
    requireGuard(snapshot.checks?.[check] === true, "verification", `${phase}.checks.${check}`);
  for (const key of [...expected.stateRules.alwaysZero, ...(phase === "after" ? expected.stateRules.afterZero : [])])
    requireGuard(get(snapshot, key) === 0, "verification", `${phase}.${key}`);
  const rows = snapshot.preservation;
  requireGuard(Array.isArray(rows) && rows.length === expected.preservation.tables.length && new Set(rows.map((row) => row.name)).size === rows.length,
    "verification", `${phase}.preservation_shape`);
  for (const name of expected.preservation.tables) {
    const row = rows.find((item) => item.name === name);
    requireGuard(row?.present === true && Number.isSafeInteger(row.row_count) && row.row_count >= 0 && SHA256.test(row.row_digest_sha256 || ""),
      "verification", `${phase}.preservation.${name}`);
  }
  return snapshot;
}

export function snapshotChecks(value, phase, expected) {
  const snapshot = unwrap(value);
  return {
    ...Object.fromEntries(expected.expectedChecks[phase].map((name) => [name, snapshot?.checks?.[name] === true])),
    ...Object.fromEntries([...expected.stateRules.alwaysZero, ...(phase === "after" ? expected.stateRules.afterZero : [])]
      .map((name) => [`zero.${name}`, get(snapshot, name) === 0])),
  };
}

export function validateGeneratedTypes(source, secrets) {
  requireGuard(typeof source === "string" && source.includes("export type Database = {") && source.includes("public: {") && source.includes("graphql_public: {"),
    "types", "generated_types_shape");
  requireGuard(!/sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\/|https?:\/\//.test(source) &&
    !secrets.some((secret) => secret && source.includes(secret)), "types", "generated_types_secret_guard");
  return normalizeTypes(source);
}

function safeComparisonName(name, expected) {
  const exact = new Set([
    "before.identity", "after.identity", "before.readOnly", "after.readOnly", "preservation.otherSchemaMarkers",
    "preservation.cronConfiguration", "preservation.otherMigrationHistory",
    ...expected.preservation.tables.map((table) => `preservation.${table}`),
    ...["before", "after"].flatMap((phase) => [
      ...expected.expectedChecks[phase].map((item) => `${phase}.checks.${item}`),
      ...expected.stateRules.alwaysZero.map((item) => `${phase}.${item}`),
    ]), ...expected.stateRules.afterZero.map((item) => `after.${item}`),
  ]);
  if (exact.has(name)) return name;
  if (typeof name === "string" && name.startsWith("preservation.dependency.")) return "preservation.dependency";
  return "comparison_unrecognized_failure";
}

export async function verifyGitContext(root, env, plan, git) {
  const head = await git("git-head", ["rev-parse", "HEAD"]);
  requireGuard(head.stdout.toString("utf8").trim() === env.GITHUB_SHA, "context", "checked_out_head");
  const top = await git("git-root", ["rev-parse", "--show-toplevel"]);
  requireGuard(path.resolve(top.stdout.toString("utf8").trim()) === root, "context", "repository_root");
  const origin = await git("git-origin", ["remote", "get-url", "origin"]);
  requireGuard([`https://github.com/${APPROVAL.repository}`, `https://github.com/${APPROVAL.repository}.git`, `git@github.com:${APPROVAL.repository}.git`].includes(origin.stdout.toString("utf8").trim()), "context", "git_origin");
  await git("git-ancestry", ["merge-base", "--is-ancestor", plan.implementationHead, "HEAD"]);
  const changes = await git("git-source-diff", ["diff", "--name-only", "-z", plan.implementationHead, "HEAD", "--"]);
  const changed = changes.stdout.toString("utf8").split("\0").filter(Boolean);
  requireGuard(changed.length > 0 && changed.every((name) => name === APPROVAL.workflow || name.startsWith(".release/")), "context", "source_diff_scope");
  const dirty = await git("git-working-tree", ["status", "--porcelain", "--untracked-files=no"]);
  requireGuard(dirty.stdout.length === 0, "context", "working_tree_clean");
}

export async function executePhase(plan, result, operations) {
  const { snapshot, apply, compare, generateTypes, publish, loadBefore, migrations, clock = Date.now } = operations;
  if (plan.phase === "preflight") {
    await snapshot("before");
    result.databaseVerificationPassed = true;
  } else if (plan.phase === "apply") {
    // A previous run's preflight is never used to authorize writes or a resume.
    const beforePath = await snapshot("before");
    for (const item of migrations) {
      requireGuard(clock() < Date.parse(plan.expiresAt), "context", "approval_expired_before_apply");
      await apply(item);
      result.appliedVersions.push(item.version);
      await publish();
    }
    const afterPath = await snapshot("after");
    await compare(beforePath, afterPath);
    result.databaseVerificationPassed = true;
    await publish();
    await generateTypes();
  } else if (plan.phase === "types") {
    await snapshot("after");
    result.databaseVerificationPassed = true;
    await generateTypes();
  } else {
    const beforePath = await loadBefore();
    const afterPath = await snapshot("after");
    await compare(beforePath, afterPath);
    result.databaseVerificationPassed = true;
  }
}

async function outputDirectory(target) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const stat = await lstat(target);
  requireGuard(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(target) === target, "output", "output_directory");
}

export async function runRunner({ bundle, before, root = process.cwd(), env = process.env, now = Date.now(), execute = captureProcess } = {}) {
  root = path.resolve(root);
  const publicDir = path.join(root, "result-output"), privateDir = path.join(root, "private-output");
  const secrets = secretVariants(env.SUPABASE_DB_URL);
  const result = {
    passed: false, phase: "unknown", databaseVerificationPassed: false, typesGenerated: false, typesMatch: false,
    head: APPROVAL.implementationHead, projectRef: APPROVAL.projectRef, opsCommit: SHA.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null,
    versions: [], appliedVersions: [], privilegeChecks: {}, snapshotChecks: { before: {}, after: {} }, failures: [],
  };
  let outputsReady = false;
  const privateWrite = async (name, value) => {
    requireGuard(/^[a-z0-9][a-z0-9_.-]*$/.test(name), "output", "private_filename");
    const target = path.join(privateDir, name);
    try { const stat = await lstat(target); requireGuard(stat.isFile() && !stat.isSymbolicLink(), "output", "private_file_type"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await writeFile(target, redact(value, secrets), { mode: 0o600 });
  };
  const publish = async () => {
    if (!outputsReady) return;
    const target = path.join(publicDir, "release-result.json");
    const temporary = path.join(publicDir, ".release-result.json.tmp");
    for (const file of [target, temporary]) {
      try { const stat = await lstat(file); requireGuard(stat.isFile() && !stat.isSymbolicLink(), "output", "public_file_type"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, target);
  };
  const command = async (stage, name, executable, args, options = {}, allowFailure = false) => {
    const response = await execute(executable, args, { cwd: root, env: baseChildEnv(env), ...options });
    await privateWrite(`${name}.stderr.log`, response.stderr);
    await privateWrite(`${name}.stdout.log`, response.stdout);
    if (!allowFailure && (response.status !== 0 || response.errorKind)) throw classifyProcessFailure(stage, name, response);
    return response;
  };
  try {
    await outputDirectory(publicDir); await outputDirectory(privateDir); outputsReady = true;
    // Remove only our own previous schema export. A failed run must not upload a stale success.
    const typesOutput = path.join(publicDir, "generated-database.types.ts");
    try { const stat = await lstat(typesOutput); requireGuard(stat.isFile() && !stat.isSymbolicLink(), "output", "types_output_file"); await unlink(typesOutput); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    requireGuard(typeof bundle === "string", "context", "bundle_argument");
    bundle = path.resolve(root, bundle);
    requireGuard(bundle === path.join(root, APPROVAL.bundle) && await realpath(bundle) === bundle && await realpath(root) === root,
      "context", "bundle_path");
    requireGuard(fileURLToPath(import.meta.url) === path.join(bundle, "ci-runner.mjs"), "context", "runner_location");
    const plan = parsePlan(parseJson(await regularFile(path.join(bundle, "runner-plan.json"), "context", "plan_file"), "context", "plan_json"), now);
    result.phase = plan.phase;
    requireGuard((plan.phase === "verify") === Boolean(before), "context", "before_argument_phase");
    const event = parseJson(await regularFile(env.GITHUB_EVENT_PATH || "", "context", "event_file"), "context", "event_json");
    validateDispatch(env, event, plan);
    const gitEnv = { ...baseChildEnv(env), GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" };
    const git = (name, args, allowFailure = false) => command("context", name, "git", ["--no-replace-objects", ...args], { env: gitEnv, timeout: 30000 }, allowFailure);
    await verifyGitContext(root, env, plan, git);
    const release = await verifyBundle(bundle, root);
    result.versions = release.manifest.migrations.map((item) => ({ version: item.version, sourceSha256: item.sourceSha256, applySha256: item.applySha256 }));
    const names = [...Object.keys(release.files), "ci-runner.mjs", "runner-plan.json"].sort();
    const actual = await readdir(bundle, { withFileTypes: true });
    requireGuard(actual.every((item) => item.isFile() && !item.isSymbolicLink()) && JSON.stringify(actual.map((item) => item.name).sort()) === JSON.stringify(names), "bundle", "bundle_exact_files");
    await git("git-bundle-tracked", ["ls-files", "--error-unmatch", "--", ...names.map((name) => `${APPROVAL.bundle}/${name}`)]);
    for (const item of release.manifest.migrations) {
      const committed = await git(`git-source-${item.version}`, ["show", `${plan.implementationHead}:${item.file}`]);
      requireGuard(hash(lf(committed.stdout.toString("utf8"))) === item.sourceSha256, "bundle", "approved_source_sha256");
    }
    // No database child process is possible until all context and frozen-file guards pass.
    const connection = parseDatabaseUrl(env.SUPABASE_DB_URL, plan.expectedProjectRef);
    for (const secret of secretVariants(connection.cliUrl)) if (!secrets.includes(secret)) secrets.push(secret);
    secrets.sort((left, right) => right.length - left.length);
    const pgEnv = libpqEnvironment(connection, env);
    const psql = (name, args = [], input) => command("database", name, "psql",
      ["-X", "--no-password", "--quiet", "--no-align", "--tuples-only", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate", "--set=SHOW_CONTEXT=never", ...args],
      { env: pgEnv, input, timeout: 240000 });
    result.privilegeChecks = { clientTlsVerified: false };
    const collected = await collectPreflight(psql, release.expected, connection, async (proof) => {
      result.privilegeChecks.clientTlsVerified = true;
      await privateWrite("client-tls-proof.json", JSON.stringify(proof));
    });
    result.privilegeChecks = collected.checks;
    const snapshot = async (phase, name = phase) => {
      const response = await psql(`snapshot-${name}`, ["--file", path.join(bundle, `verify-${phase}.sql`)]);
      const value = parseJson(response.stdout, "verification", `${phase}.json`);
      const target = path.join(privateDir, `${name}.json`);
      await privateWrite(`${name}.json`, response.stdout);
      // Publish every known bool before either validator can reject its first
      // failure. No arbitrary server keys, counts, row values, or error text.
      result.snapshotChecks[phase] = snapshotChecks(value, phase, release.expected);
      await publish();
      validateSnapshot(value, phase, release.expected);
      validatePreflight(collected);
      return target;
    };
    const compare = async (beforePath, afterPath) => {
      const comparisonPath = path.join(privateDir, "verification-comparison.json");
      const response = await command("verification", "comparison", process.execPath,
        [path.join(bundle, "compare-verification-snapshots.mjs"), beforePath, afterPath, comparisonPath], {}, true);
      // The pinned comparator contains only row hashes/counts, but redact before preserving it too.
      const comparisonBytes = await regularFile(comparisonPath, "verification", "comparison_file");
      await privateWrite("verification-comparison.json", comparisonBytes);
      const comparison = parseJson(comparisonBytes, "verification", "comparison_json");
      requireGuard(comparison.sourceCommit === APPROVAL.implementationHead && Array.isArray(comparison.failures), "verification", "comparison_identity");
      if (response.status !== 0 || response.errorKind || comparison.failed !== 0 || comparison.failures.length) {
        for (const name of comparison.failures) result.failures.push({ stage: "verification", check: safeComparisonName(name, release.expected), code: "COMPARISON_FAILED" });
        reject("verification", "preservation_comparison", "COMPARISON_FAILED");
      }
    };
    const generateTypes = async () => {
      const cliEnv = baseChildEnv(env);
      const version = await command("types", "supabase-version", "supabase", ["--version"], { env: cliEnv, timeout: 30000 });
      requireGuard(version.stdout.toString("utf8").trim() === APPROVAL.cliVersion, "types", "supabase_cli_version");
      const generated = await command("types", "generated-types", "supabase",
        ["gen", "types", "typescript", "--db-url", connection.cliUrl, "--schema", "public,graphql_public"], { env: cliEnv, timeout: 300000 });
      const types = validateGeneratedTypes(generated.stdout.toString("utf8"), secrets);
      const reference = await regularFile(path.join(root, "packages/database-types/database.types.ts"), "types", "committed_types_file");
      result.typesMatch = types === normalizeTypes(reference.toString("utf8"));
      await writeFile(typesOutput, types, { mode: 0o600 });
      result.typesGenerated = true;
    };
    const loadBefore = async () => {
      const beforePath = path.resolve(root, before);
      requireGuard(inside(path.join(root, "private-input"), beforePath) || inside(privateDir, beforePath), "verification", "before_private_path");
      const bytes = await regularFile(beforePath, "verification", "before_file", OUTPUT_LIMIT);
      validateSnapshot(parseJson(bytes, "verification", "before.json"), "before", release.expected);
      // The existing comparator receives only redacted private files, never credentials.
      await privateWrite("verification-before.json", bytes);
      return path.join(privateDir, "verification-before.json");
    };
    await executePhase(plan, result, { snapshot, compare, generateTypes, publish, loadBefore,
      migrations: release.manifest.migrations,
      apply: (item) => psql(`apply-${item.version}`, ["--file", path.join(bundle, item.applyFile)]),
    });
    result.passed = true;
  } catch (error) {
    const safe = error instanceof GuardFailure ? error : new GuardFailure("runner", "unexpected_failure", "INTERNAL_FAILURE");
    result.failures.push({ stage: safe.stage, check: safe.check, code: safe.code,
      ...(safe.sqlLine === undefined ? {} : { sqlLine: safe.sqlLine }),
      ...(safe.schemaIdentifierClass ? { schemaIdentifierClass: safe.schemaIdentifierClass } : {}) });
  }
  try { await publish(); }
  catch { result.passed = false; result.failures.push({ stage: "output", check: "result_publication", code: "OUTPUT_FAILED" }); }
  // A fixed schema prevents accidental exception/child output from reaching logs.
  return result;
}

export async function selfTest() {
  // Frozen public inputs and mocked subprocesses only. Never read a secret,
  // real Git state, or a database; no output file is created by this mode.
  const tests = [];
  const pass = async (name, run) => { await run(); tests.push(name); };
  const now = Date.parse("2026-10-26T07:00:00Z");
  const plan = { format: "performance-release-runner-v1", phase: "preflight", implementationHead: APPROVAL.implementationHead,
    expectedProjectRef: APPROVAL.projectRef, branch: APPROVAL.branch, expiresAt: APPROVAL.expiresAt };
  const mustReject = (run, check) => assert.throws(run, (error) => error instanceof GuardFailure && error.check === check);
  await pass("plan_identity_expiry_and_extra_fields", () => {
    assert.equal(parsePlan(plan, now).phase, "preflight");
    mustReject(() => parsePlan({ ...plan, implementationHead: "a".repeat(40) }, now), "plan_approval_identity");
    mustReject(() => parsePlan(plan, Date.parse(APPROVAL.expiresAt)), "approval_expired");
    mustReject(() => parsePlan({ ...plan, unexpected: true }, now), "plan_shape");
  });
  const ref = `refs/heads/${APPROVAL.branch}`, ops = "a".repeat(40);
  const dispatchEnv = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: APPROVAL.repository,
    GITHUB_REF: ref, GITHUB_REF_TYPE: "branch", GITHUB_SHA: ops, GITHUB_WORKFLOW_REF: `${APPROVAL.repository}/${APPROVAL.workflow}@${ref}` };
  const event = { repository: { full_name: APPROVAL.repository }, ref, inputs: { approved_ops_sha: ops } };
  await pass("dispatch_reviewed_sha_ref_and_event", () => {
    validateDispatch(dispatchEnv, event, plan);
    mustReject(() => validateDispatch({ ...dispatchEnv, GITHUB_EVENT_NAME: "push" }, event, plan), "workflow_dispatch_required");
    mustReject(() => validateDispatch({ ...dispatchEnv, GITHUB_REF: "refs/heads/main" }, event, plan), "workflow_repository_ref");
    mustReject(() => validateDispatch(dispatchEnv, { ...event, inputs: { approved_ops_sha: "b".repeat(40) } }, plan), "dispatch_approved_ops_sha");
  });
  const fakePassword = "Mock@password/only?2026";
  const fakeUrl = `postgresql://postgres.${APPROVAL.projectRef}:${encodeURIComponent(fakePassword)}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`;
  await pass("target_url_rejects_other_project_host_port_and_ssl", () => {
    assert.equal(parseDatabaseUrl(fakeUrl, APPROVAL.projectRef).host, "aws-0-ap-northeast-1.pooler.supabase.com");
    mustReject(() => parseDatabaseUrl(fakeUrl.replace(APPROVAL.projectRef, "a".repeat(20)), APPROVAL.projectRef), "database_project_user");
    mustReject(() => parseDatabaseUrl(fakeUrl.replace("ap-northeast-1", "us-east-1"), APPROVAL.projectRef), "database_host");
    mustReject(() => parseDatabaseUrl(fakeUrl.replace(":5432/", ":6543/"), APPROVAL.projectRef), "database_port_name");
    mustReject(() => parseDatabaseUrl(fakeUrl.replace("sslmode=require", "sslmode=disable"), APPROVAL.projectRef), "database_ssl_required");
    mustReject(() => parseDatabaseUrl(fakeUrl + "&options=unsafe", APPROVAL.projectRef), "database_ssl_required");
    const noQuery = parseDatabaseUrl(fakeUrl.split("?")[0], APPROVAL.projectRef);
    assert.equal(noQuery.sslmode, "require"); assert.match(noQuery.cliUrl, /\?sslmode=require$/);
    const direct = `postgresql://postgres:${encodeURIComponent(fakePassword)}@db.${APPROVAL.projectRef}.supabase.co:5432/postgres`;
    assert.equal(parseDatabaseUrl(direct, APPROVAL.projectRef).user, "postgres");
    mustReject(() => parseDatabaseUrl(direct.replace("//postgres:", `//postgres.${APPROVAL.projectRef}:`), APPROVAL.projectRef), "database_project_user");
  });
  await pass("credential_redaction_and_libpq_separation", () => {
    const secrets = secretVariants(fakeUrl);
    const redacted = redact([fakeUrl, decodeURIComponent(fakeUrl), fakePassword, encodeURIComponent(fakePassword)].join("\n"), secrets);
    assert.ok(secrets.every((secret) => !redacted.includes(secret)));
    const childEnv = libpqEnvironment(parseDatabaseUrl(fakeUrl, APPROVAL.projectRef), { PATH: "/mock", BACKUP_PASSPHRASE: "do-not-inherit", PGOPTIONS: "unsafe", SUPABASE_DB_URL: fakeUrl, LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8", LC_MESSAGES: "ja_JP.UTF-8" });
    assert.equal(childEnv.PGPASSWORD, fakePassword);
    assert.equal(childEnv.PGOPTIONS, undefined); assert.equal(childEnv.BACKUP_PASSPHRASE, undefined); assert.equal(childEnv.SUPABASE_DB_URL, undefined);
    for (const name of ["SUPABASE_TELEMETRY_DISABLED", "DO_NOT_TRACK", "SUPABASE_NO_KEYRING"]) assert.equal(childEnv[name], "1");
    for (const name of ["LANG", "LC_ALL", "LC_MESSAGES"]) assert.equal(childEnv[name], "C");
    assert.equal(redact("[REDACTED]", ["REDACTED"]).includes("REDACTED"), false);
  });
  const connection = parseDatabaseUrl(fakeUrl, APPROVAL.projectRef);
  const tabularConninfo = [
    "Database\tpostgres", `Client User\t${connection.user}`, `Host\t${connection.host}`, "Host Address\t192.0.2.1", "Server Port\t5432",
    "Options\t", "Protocol Version\t3.0", "Password Used\ttrue", "GSSAPI Authenticated\tfalse", "Backend PID\t123",
    "SSL Connection\ttrue", "SSL Library\tOpenSSL", "SSL Protocol\tTLSv1.3", "SSL Key Bits\t256", "SSL Cipher\tTLS_AES_256_GCM_SHA384",
    "SSL Compression\tfalse", "ALPN\tpostgresql", "Superuser\toff", "Hot Standby\toff",
  ].join("\n") + "\n";
  const classicTarget = `You are connected to database "postgres" as user "${connection.user}" on host "${connection.host}" (address "192.0.2.1") at port "5432".`;
  const classicConninfo = `${classicTarget}\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: postgresql)\n`;
  await pass("client_tls_pg18_tabular_and_older_classic_formats", () => {
    assert.deepEqual(parseClientTls(tabularConninfo, connection), { clientTlsVerified: true, format: "psql18-tabular" });
    assert.deepEqual(parseClientTls(classicConninfo.replaceAll("\n", "\r\n"), connection), { clientTlsVerified: true, format: "classic" });
    assert.equal(parseClientTls(classicConninfo.replace(" (address \"192.0.2.1\")", "").replace(", ALPN: postgresql", ""), connection).clientTlsVerified, true);
    mustReject(() => parseClientTls(tabularConninfo.replace("SSL Connection\ttrue", "SSL Connection\tfalse"), connection), "client_tls_required");
    mustReject(() => parseClientTls(tabularConninfo.replace("SSL Connection\ttrue", "SSL Connection\tt"), connection), "client_tls_required");
    mustReject(() => parseClientTls(tabularConninfo + "SSL Connection\ttrue\n", connection), "client_conninfo_shape");
    mustReject(() => parseClientTls(tabularConninfo.replace("Server Port\t5432", "Server Port\t6543"), connection), "client_conninfo_target");
    mustReject(() => parseClientTls(classicConninfo.replace("TLSv1.3", "unknown"), connection), "client_tls_required");
    mustReject(() => parseClientTls("SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)\n", connection), "client_conninfo_shape");
  });
  await pass("private_error_classification_excludes_message", () => {
    const error = classifyProcessFailure("database", "apply-fixed", { stderr: `psql:/private/fixed.sql:19: ERROR: 42501\n${fakeUrl}\nprivate row body` });
    assert.deepEqual({ check: error.check, code: error.code, line: error.sqlLine, type: error.schemaIdentifierClass }, { check: "apply-fixed", code: "42501", line: 19, type: "permission" });
    assert.ok(!JSON.stringify(error).includes(fakePassword));
  });
  await pass("type_output_secret_and_url_guards", () => {
    const types = "export type Database = {\npublic: {\n}\ngraphql_public: {\n}\n}\n";
    assert.equal(validateGeneratedTypes(types, secretVariants(fakeUrl)), types);
    mustReject(() => validateGeneratedTypes(types + fakeUrl, secretVariants(fakeUrl)), "generated_types_secret_guard");
    mustReject(() => validateGeneratedTypes(types + " https://private.invalid", []), "generated_types_secret_guard");
  });
  await pass("subprocess_mock_captures_without_inherited_output", async () => {
    const calls = [];
    const mock = async (executable, args, options) => { calls.push({ executable, args, options }); return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(fakeUrl) }; };
    const connection = parseDatabaseUrl(fakeUrl, APPROVAL.projectRef);
    const args = ["-X", "--no-password", "--file", "/mock/fixed.sql"];
    const response = await mock("psql", args, { env: libpqEnvironment(connection, {}) });
    assert.ok(!JSON.stringify(calls[0].args).includes(fakePassword) && !JSON.stringify(calls[0].args).includes(fakeUrl));
    assert.ok(!redact(response.stderr, secretVariants(fakeUrl)).includes(fakePassword));
    assert.equal(classifyProcessFailure("database", "fixed", response).code, "SUBPROCESS_EXIT");
  });
  await pass("git_mock_rejects_head_scope_dirty_and_ancestry", async () => {
    const mockRoot = path.resolve("mock-workspace");
    const outputs = {
      "git-head": ops, "git-root": mockRoot, "git-origin": `https://github.com/${APPROVAL.repository}.git`,
      "git-ancestry": "", "git-source-diff": `${APPROVAL.workflow}\0${APPROVAL.bundle}/runner-plan.json\0`, "git-working-tree": "",
    };
    const run = async (overrides = {}) => {
      const calls = [];
      const git = async (name, args) => {
        calls.push({ name, args });
        const value = { ...outputs, ...overrides }[name];
        if (value instanceof GuardFailure) throw value;
        return { status: 0, stdout: Buffer.from(value), stderr: Buffer.alloc(0) };
      };
      await verifyGitContext(mockRoot, dispatchEnv, plan, git);
      return calls;
    };
    assert.equal((await run()).length, 6);
    await assert.rejects(run({ "git-head": "b".repeat(40) }), (error) => error.check === "checked_out_head");
    await assert.rejects(run({ "git-source-diff": "apps/hub/public/hub.js\0" }), (error) => error.check === "source_diff_scope");
    await assert.rejects(run({ "git-working-tree": " M file" }), (error) => error.check === "working_tree_clean");
    await assert.rejects(run({ "git-ancestry": new GuardFailure("context", "git-ancestry", "SUBPROCESS_EXIT") }), (error) => error.check === "git-ancestry");
  });
  const frozenBase = path.dirname(fileURLToPath(import.meta.url));
  const frozenManifest = await regularFile(path.join(frozenBase, "release-manifest.json"), "selftest", "frozen_manifest");
  const frozen = new Map([["release-manifest.json", frozenManifest]]);
  const manifest = parseJson(frozenManifest, "selftest", "frozen_manifest_json");
  for (const name of [...Object.keys(HASHES).filter((name) => name !== "release-manifest.json"), ...manifest.migrations.map((item) => item.applyFile)])
    frozen.set(name, await regularFile(path.join(frozenBase, name), "selftest", "frozen_bundle_file"));
  const sourceFiles = new Map(manifest.migrations.map((item) => {
    const marker = `$performance_source_${item.version}$`;
    return [item.file, Buffer.from(frozen.get(item.applyFile).toString("utf8").split(marker)[1])];
  }));
  const mockBundle = path.resolve("mock-bundle"), mockSource = path.resolve("mock-source");
  const mockRead = (overrides = new Map()) => async (file) => {
    if (overrides.has(file)) return overrides.get(file);
    const relative = path.relative(mockSource, file).replaceAll(path.sep, "/");
    if (sourceFiles.has(relative)) return sourceFiles.get(relative);
    const value = frozen.get(path.basename(file));
    if (!value) throw new GuardFailure("selftest", "unrecognized_mock_file");
    return value;
  };
  const release = await verifyBundle(mockBundle, mockSource, mockRead());
  const snapshotFixture = (phase = "before") => {
    const value = {
      format: release.expected.format, phase, sourceCommit: APPROVAL.implementationHead,
      environment: { transactionReadOnly: "on", isolation: "repeatable read", database: "postgres", role: "postgres" },
      checks: Object.fromEntries(release.expected.expectedChecks[phase].map((name) => [name, true])),
      preservation: release.expected.preservation.tables.map((name) => ({ name, present: true, row_count: 0, row_digest_sha256: hash("") })),
    };
    for (const name of [...release.expected.stateRules.alwaysZero, ...(phase === "after" ? release.expected.stateRules.afterZero : [])]) {
      const parts = name.split(".");
      let target = value;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = 0;
    }
    return value;
  };
  await pass("client_tls_failure_stops_before_any_metadata_snapshot_or_ddl", async () => {
    for (const output of ["", "You are currently not connected to a database.\n", tabularConninfo.replace("SSL Connection\ttrue", "SSL Connection\tfalse"), `${classicTarget}\nSSL is not in use\n`]) {
      const calls = [];
      const psql = async (name, args, input) => {
        calls.push({ name, args, input });
        assert.equal(name, "client-conninfo");
        assert.deepEqual(args, ["--field-separator", "\t", "--pset=footer=off", "--command", "\\conninfo"]);
        return { stdout: Buffer.from(output) };
      };
      await assert.rejects(collectPreflight(psql, release.expected, connection), GuardFailure);
      assert.equal(calls.length, 1); assert.equal(calls[0].input, undefined);
    }
  });
  await pass("client_tls_true_backend_ssl_false_is_diagnostic_and_all_gate_bools_are_safe", async () => {
    const privilege = {
      format: "performance-release-privileges-v1", currentUser: "postgres", sessionUser: "postgres", backendSSL: false,
      checks: { ...Object.fromEntries(PRIVILEGE_CHECKS.map((name) => [name, true])), arbitraryServerKey: "private row text" },
    };
    const calls = [];
    const psql = async (name) => {
      calls.push(name);
      return { stdout: Buffer.from(name === "client-conninfo" ? tabularConninfo : JSON.stringify(privilege)) };
    };
    const collected = await collectPreflight(psql, release.expected, connection);
    assert.deepEqual(calls, ["client-conninfo", "privileges"]);
    assert.equal(collected.checks.clientTlsVerified, true); assert.equal(collected.checks.backendSSL, false);
    assert.equal(collected.checks.arbitraryServerKey, undefined); assert.ok(Object.values(collected.checks).every((item) => typeof item === "boolean"));
    validatePreflight(collected);
    privilege.checks.publicSchema = false; privilege.checks.historyPrivileges = false;
    const denied = await collectPreflight(psql, release.expected, connection);
    const snapshot = snapshotFixture();
    snapshot.checks.arbitraryServerKey = "private row text";
    const diagnostic = { privilegeChecks: denied.checks, snapshotChecks: {} };
    let writes = 0;
    await assert.rejects(executePhase({ ...plan, phase: "apply" }, { appliedVersions: [] }, {
      migrations: release.manifest.migrations, clock: () => now,
      snapshot: async (phase) => {
        diagnostic.snapshotChecks[phase] = snapshotChecks(snapshot, phase, release.expected);
        validateSnapshot(snapshot, phase, release.expected); validatePreflight(denied); return phase;
      },
      apply: async () => { writes++; }, publish: async () => {}, compare: async () => {}, generateTypes: async () => {},
    }), (error) => error.check === "privileges.publicSchema");
    assert.equal(writes, 0); assert.equal(diagnostic.privilegeChecks.publicSchema, false); assert.equal(diagnostic.privilegeChecks.historyPrivileges, false);
    assert.ok(Object.values(diagnostic.snapshotChecks.before).every((item) => item === true));
    assert.ok(!JSON.stringify(diagnostic).includes("private row text"));
    for (const phase of ["before", "after"]) {
      const value = snapshotFixture(phase);
      value.checks.requiredExtensionsPresent = false; value.checks.roleConfigurationMatches = "true";
      value.operationalState.review.activeQueueDuplicateKnowledge = "0";
      const checks = snapshotChecks(value, phase, release.expected);
      assert.equal(checks.requiredExtensionsPresent, false); assert.equal(checks.roleConfigurationMatches, false);
      assert.equal(checks["zero.operationalState.review.activeQueueDuplicateKnowledge"], false);
      assert.ok(Object.values(checks).every((item) => typeof item === "boolean"));
      mustReject(() => validateSnapshot(value, phase, release.expected), `${phase}.checks.requiredExtensionsPresent`);
    }
  });
  await pass("frozen_bundle_mock_rejects_manifest_apply_source_and_expected_tampering", async () => {
    for (const [file, check] of [
      [path.join(mockBundle, "release-manifest.json"), "manifest_sha256"],
      [path.join(mockBundle, manifest.migrations[0].applyFile), "bundle_file_sha256"],
      [path.join(mockBundle, "verification-expected.json"), "bundle_file_sha256"],
      [path.join(mockSource, manifest.migrations[0].file), "source_migration_sha256"],
    ]) await assert.rejects(verifyBundle(mockBundle, mockSource, mockRead(new Map([[file, Buffer.from("tampered")]]))), (error) => error.check === check);
    const firstSource = manifest.migrations[0];
    const crlf = new Map([[path.join(mockSource, firstSource.file), Buffer.from(sourceFiles.get(firstSource.file).toString("utf8").replaceAll("\n", "\r\n"))]]);
    assert.equal((await verifyBundle(mockBundle, mockSource, mockRead(crlf))).manifest.migrations.length, 8);
  });
  await pass("readonly_preflight_sql_and_snapshot_fail_closed", () => {
    const sql = ownershipSql(release.expected);
    assert.match(sql, /^begin transaction isolation level repeatable read read only;/);
    assert.ok(!/\b(?:create|alter|drop)\s+(?:table|function|schema|index)\b/i.test(sql));
    assert.ok(!/\b(?:insert\s+into|update\s+public\.|delete\s+from)\b/i.test(sql));
    assert.ok(!sql.includes("'SELECT,INSERT'"));
    assert.ok(!sql.includes("historyOwnership"));
    assert.ok(sql.includes("'public.review_batch_runs','REFERENCES'"));
    const snapshot = snapshotFixture();
    validateSnapshot(snapshot, "before", release.expected);
    const denied = structuredClone(snapshot); denied.checks.beforeHistoryAbsent = false;
    mustReject(() => validateSnapshot(denied, "before", release.expected), "before.checks.beforeHistoryAbsent");
    const writable = structuredClone(snapshot); writable.environment.transactionReadOnly = "off";
    mustReject(() => validateSnapshot(writable, "before", release.expected), "before.readOnly");
  });
  await pass("phase_mock_exact_order_partial_recording_and_no_ddl_in_preflight", async () => {
    const run = async (phase, failVersion) => {
      const state = { databaseVerificationPassed: false, typesGenerated: false, typesMatch: false, appliedVersions: [] };
      const calls = [], published = [];
      const operations = {
        migrations: release.manifest.migrations, clock: () => now,
        snapshot: async (value) => { calls.push(`snapshot:${value}`); return value; },
        apply: async (item) => {
          calls.push(`apply:${item.version}`);
          if (item.version === failVersion) throw classifyProcessFailure("database", `apply-${item.version}`, { status: 1, stderr: "ERROR: 42501" });
        },
        compare: async (a, b) => { calls.push(`compare:${a}:${b}`); },
        generateTypes: async () => { calls.push("types"); state.typesGenerated = true; state.typesMatch = false; },
        publish: async () => { published.push([...state.appliedVersions]); },
        loadBefore: async () => { calls.push("external-before"); return "external"; },
      };
      let failure;
      try { await executePhase({ ...plan, phase }, state, operations); } catch (error) { failure = error; }
      return { state, calls, published, failure };
    };
    const preflight = await run("preflight");
    assert.deepEqual(preflight.calls, ["snapshot:before"]);
    assert.equal(preflight.state.databaseVerificationPassed, true);
    const failed = await run("apply", manifest.migrations[2].version);
    assert.deepEqual(failed.state.appliedVersions, manifest.migrations.slice(0, 2).map((item) => item.version));
    assert.equal(failed.failure.code, "42501"); assert.equal(failed.state.databaseVerificationPassed, false);
    assert.equal(failed.calls.length, 4); assert.ok(!failed.calls.includes("types"));
    assert.equal(failed.published.length, 2);
    const applied = await run("apply");
    assert.deepEqual(applied.calls, ["snapshot:before", ...manifest.migrations.map((item) => `apply:${item.version}`), "snapshot:after", "compare:before:after", "types"]);
    assert.equal(applied.state.databaseVerificationPassed, true); assert.equal(applied.state.typesGenerated, true); assert.equal(applied.state.typesMatch, false);
    const types = await run("types"); assert.deepEqual(types.calls, ["snapshot:after", "types"]);
    const verify = await run("verify"); assert.deepEqual(verify.calls, ["external-before", "snapshot:after", "compare:external:after"]);
  });
  await pass("phase_mock_expiry_before_failure_comparison_and_types_failure", async () => {
    const run = async (failure) => {
      const state = { databaseVerificationPassed: false, typesGenerated: false, typesMatch: false, appliedVersions: [] };
      const calls = [];
      const operations = {
        migrations: release.manifest.migrations,
        clock: () => failure === "expiry" ? Date.parse(APPROVAL.expiresAt) : now,
        snapshot: async (phase) => { calls.push(`snapshot:${phase}`); if (failure === "before" && phase === "before") throw new GuardFailure("verification", "before.checks.beforeHistoryAbsent"); return phase; },
        apply: async (item) => { calls.push(`apply:${item.version}`); },
        compare: async () => { calls.push("compare"); if (failure === "comparison") throw new GuardFailure("verification", "preservation_comparison"); },
        generateTypes: async () => { calls.push("types"); if (failure === "types") throw new GuardFailure("types", "generated_types_secret_guard"); state.typesGenerated = true; },
        publish: async () => {},
      };
      await assert.rejects(executePhase({ ...plan, phase: "apply" }, state, operations), GuardFailure);
      return { state, calls };
    };
    for (const failure of ["expiry", "before"]) {
      const checked = await run(failure);
      assert.deepEqual(checked.calls, ["snapshot:before"]); assert.deepEqual(checked.state.appliedVersions, []);
    }
    const comparison = await run("comparison");
    assert.equal(comparison.state.appliedVersions.length, 8); assert.equal(comparison.state.databaseVerificationPassed, false); assert.ok(!comparison.calls.includes("types"));
    const types = await run("types");
    assert.equal(types.state.appliedVersions.length, 8); assert.equal(types.state.databaseVerificationPassed, true); assert.equal(types.state.typesGenerated, false);
  });
  return { passed: true, tests };
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === "--self-test") return { selfTest: true };
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    requireGuard(["--bundle", "--before"].includes(args[index]) && typeof args[index + 1] === "string" &&
      !args[index + 1].startsWith("--") && result[args[index].slice(2)] === undefined, "context", "arguments");
    result[args[index].slice(2)] = args[index + 1];
  }
  requireGuard(typeof result.bundle === "string", "context", "bundle_argument");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = args.selfTest ? await selfTest() : await runRunner(args);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch {
    // Never print Error objects, their messages, commands, arguments, or stacks.
    console.log(JSON.stringify({ passed: false, failures: [{ stage: "runner", check: "startup_rejected", code: "GUARD_REJECTED" }] }));
    process.exitCode = 1;
  }
}
