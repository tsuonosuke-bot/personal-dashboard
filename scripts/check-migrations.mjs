import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { validateBaselineLedger } from "./migration-baselines.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(
  await readFile(new URL("./migration-catalog.json", import.meta.url), "utf8"),
);
const exceptions = new Map(catalog.map((item) => [item.path, item]));
if (exceptions.size !== catalog.length) throw new Error("Duplicate migration catalog entries.");
const seen = new Set();
for (const app of ["hub", "knowledge", "finance"]) {
  const base = resolve(root, "apps", app, "supabase");
  const looseSql = (await readdir(base)).filter((name) => name.endsWith(".sql"));
  if (looseSql.length) throw new Error(`${app}: SQL outside migrations: ${looseSql.join(", ")}`);
  const migrationDir = resolve(base, "migrations");
  const files = await readdir(migrationDir, { recursive: true, withFileTypes: true });
  for (const item of files) {
    if (!item.isFile() || !item.name.endsWith(".sql")) continue;
    const path = resolve(item.parentPath, item.name);
    const key = relative(root, path).replaceAll("\\", "/");
    const exception = exceptions.get(key);
    if (exception) {
      const body = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
      const digest = createHash("sha256").update(body).digest("hex");
      if (digest !== exception.sha256)
        throw new Error(`${key}: historical SQL changed; add a new migration.`);
      seen.add(key);
    } else {
      if (item.parentPath !== migrationDir || !/^\d{14}_[a-z][a-z0-9_]*\.sql$/.test(item.name)) {
        throw new Error(
          `${key}: new migration requires YYYYMMDDHHmmss_description.sql at migrations root.`,
        );
      }
    }
  }
}
for (const key of exceptions.keys()) {
  if (!seen.has(key)) throw new Error(`${key}: historical migration is missing or renamed.`);
}
const baselineCount = validateBaselineLedger(
  catalog,
  JSON.parse(await readFile(new URL("./migration-baselines.json", import.meta.url), "utf8")),
);
console.log(
  `Migration locations/names, ${seen.size} historical snapshots and ${baselineCount} baseline history assessments verified (offline; no DB connection).`,
);
