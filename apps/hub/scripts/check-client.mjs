import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const files = [];

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) await checkDirectory(path);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      execFileSync(process.execPath, ["--check", fileURLToPath(path)], { stdio: "inherit" });
      if (entry.name.endsWith(".js")) files.push(fileURLToPath(path));
    }
  }
}

await checkDirectory(new URL("../public/", import.meta.url));
await checkDirectory(new URL("./", import.meta.url));

// Strict browser typing is staged in tsconfig.client.json. For every file, check unresolved names, invalid imports and
// use-before-initialization: syntax and bundling alone cannot detect a moved closure's state.
const program = ts.createProgram(files, {
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, types: [],
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
});
const bindingErrors = new Set([2304, 2305, 2552, 18004, 2448, 2454, 2614, 2724]);
const diagnostics = ts.getPreEmitDiagnostics(program).filter(error => bindingErrors.has(error.code));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: name => name,
    getNewLine: () => "\n",
  }));
  process.exitCode = 1;
}
