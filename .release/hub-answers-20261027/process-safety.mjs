import { spawn } from 'node:child_process';
export const PROJECT_REF = 'plwlxwidpqbunugfxjhp';
const MAX_BYTES = 32 * 1024 * 1024;
const freeze = Object.freeze;
export class GuardFailure extends Error { constructor(check,code='GUARD_REJECTED') { super(check); this.check=check; this.code=code; } }
export const guard = (value,check) => { if (!value) throw new GuardFailure(check); };
export const lf = value => String(value).replace(/\r\n/g,'\n');
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
      PGAPPNAME: "hub-answers-release-20261027",
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
