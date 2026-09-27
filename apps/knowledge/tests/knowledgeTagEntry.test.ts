import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("タグ入力は余分な空白と大文字小文字の重複を除き、既存タグの表記を使う", async () => {
  const source = await readFile(new URL("../src/components/KnowledgeFormModal.tsx", import.meta.url), "utf8");
  const helpers = source.slice(source.indexOf("function tagKey("));
  const compiled = ts.transpileModule(
    `${helpers}\nglobalThis.appendUniqueTags = appendUniqueTags;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText;
  const context: { appendUniqueTags?: (current: string[], entries: string[], suggestions?: string[]) => string[] } = {};
  runInNewContext(compiled, context);
  assert.ok(context.appendUniqueTags);

  const tags = context.appendUniqueTags(
    ["読書"],
    [" API ", "api", " 仕事 ", "", " 読書 ", "仕事"],
    ["API", "読書"],
  );
  assert.deepEqual(Array.from(tags), ["読書", "API", "仕事"]);
});
