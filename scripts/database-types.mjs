import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const output = fileURLToPath(
  new URL("../packages/database-types/database.types.ts", import.meta.url),
);
const args = process.argv.slice(2);
const check = args.includes("--check");
const inputIndex = args.indexOf("--input");
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--check") continue;
  if (args[index] === "--input" && args[index + 1] && !args[index + 1].startsWith("--")) {
    index++;
    continue;
  }
  throw new Error("Usage: node scripts/database-types.mjs [--input downloaded-types.ts] [--check]");
}

// --input supports the Dashboard export without handling a browser session token.
let source;
if (inputIndex >= 0) {
  source = await readFile(resolve(args[inputIndex + 1]), "utf8");
} else {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z]{20}$/.test(ref) || !token) {
    throw new Error(
      "Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN (database:read), or use --input.",
    );
  }
  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/types/typescript`);
  url.searchParams.set("included_schemas", "public,graphql_public");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  // Never print a management response body or authentication material.
  if (!response.ok) throw new Error(`Type generation failed (HTTP ${response.status}).`);
  source = (await response.json()).types;
}
if (
  typeof source !== "string" ||
  !source.includes("export type Database = {") ||
  !source.includes("public: {")
) {
  throw new Error("Expected Supabase generated TypeScript definitions. Output was not changed.");
}
// Type exports contain names/types, never rows, URLs, keys or connection strings.
if (
  /sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\/|https?:\/\//.test(source)
) {
  throw new Error(
    "Unexpected credential or URL in generated types. Review privately before importing.",
  );
}
const normalized = source.replace(/\r\n/g, "\n").trimEnd() + "\n";
if (check) {
  if ((await readFile(output, "utf8")).replace(/\r\n/g, "\n") !== normalized) {
    throw new Error(
      "Database types changed. Regenerate, review schema-only changes, and run typecheck.",
    );
  }
  console.log("Database type snapshot matches.");
} else {
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, normalized);
  await rename(temporary, output);
  console.log("Updated packages/database-types/database.types.ts (schema metadata only).");
}
