import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Knowledge・FinanceのFunctionsはHubの functions/knowledge・functions/finance に統合した。
const apps = ["hub"];
const requested = process.argv.slice(2);
for (const app of requested) {
  if (!apps.includes(app)) {
    console.error(`Unknown app: ${app}. Choose ${apps.join(", ")}.`);
    process.exit(1);
  }
}

// Resolve the installed package from its declaring workspace, whether npm hoists it or not.
// Invoking its declared bin with Node also works on Windows, without a shell or npx download.
const require = createRequire(join(root, "apps/hub/package.json"));
const wranglerPackagePath = require.resolve("wrangler/package.json");
const wranglerPackage = JSON.parse(readFileSync(wranglerPackagePath, "utf8"));
const bin =
  typeof wranglerPackage.bin === "string" ? wranglerPackage.bin : wranglerPackage.bin.wrangler;
const wrangler = resolve(dirname(wranglerPackagePath), bin);

for (const app of requested.length ? requested : apps) {
  const output = mkdtempSync(join(tmpdir(), `dashboard-functions-${app}-`));
  try {
    console.log(`Building ${app} Pages Functions with Wrangler ${wranglerPackage.version}`);
    const result = spawnSync(
      process.execPath,
      [wrangler, "pages", "functions", "build", "--outdir", output],
      {
        cwd: join(root, "apps", app),
        stdio: "inherit",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}
