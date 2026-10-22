#!/usr/bin/env node
// SF6の技データ（1キャラ1ファイルのJSON。1件の形は public/sf6-frames.d.ts の MoveInput）から、
// sf6_move_sets / sf6_moves を入れ替えるSQLを標準出力に出す。データ本体（公式のフレームデータ）はリポジトリに入れない。
// counterOverride / punishCounterOverride は適用条件を含む40字以内の文字列（例「追撃可能（地上のみ）」）。
//
//   node scripts/sf6-moves-sql.mjs <character>.json > <character>.sql
//   node scripts/sf6-moves-sql.mjs --dry-run <character>.json   # 最後に件数つきの例外を投げて、全部ロールバックする
//
// 1回の execute_sql で流す（1トランザクションになる）。検証で問題があれば一覧を出して終了コード1で止まる。
// 警告（標準エラー）：パレットで読めずに文字のまま表示されるコマンドと、カテゴリ別の件数。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CATEGORIES, toMoveRow } from "../public/sf6-frames.js";
import { parseNotation } from "../public/sf6-notation.js";

const COLUMNS = [
  "sort_order", "category", "name", "command", "startup_text", "active_text", "recovery_text", "hit_text", "block_text",
  "cancel_text", "damage_text", "scaling_text", "drive_gain_text", "drive_loss_text", "sa_gain_text", "attribute_text", "notes",
  "startup", "on_hit", "hit_knockdown", "on_block", "counter_override", "punish_counter_override",
];

function literal(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** JSONを検証して、SQLと警告を返す。問題があれば errors に入れる（sql は null）。 */
export function buildMovesSql(input, { dryRun = false } = {}) {
  const errors = [];
  const warnings = [];
  const character = typeof input?.character === "string" ? input.character.trim() : "";
  if (!character || [...character].length > 40) errors.push("character は1〜40字にしてください");
  if (typeof input?.dataVersion !== "string" || !input.dataVersion.trim() || [...input.dataVersion.trim()].length > 40) {
    errors.push("dataVersion は1〜40字にしてください（例：Ver.2.0200.001、版がなければ「公式サイト 2026-10-12時点」）");
  }
  if (typeof input?.sourceUrl !== "string" || !input.sourceUrl.startsWith("https://www.streetfighter.com/")) {
    errors.push("sourceUrl は https://www.streetfighter.com/ の公式ページにしてください");
  }
  if (typeof input?.checkedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn)) errors.push("checkedOn は YYYY-MM-DD にしてください");
  const moves = Array.isArray(input?.moves) ? input.moves : [];
  if (!moves.length || moves.length > 500) errors.push("moves は1〜500件にしてください");

  const rows = moves.map((move, index) => {
    const { row, errors: problems } = toMoveRow(move, index + 1);
    errors.push(...problems);
    const unreadable = row.command ? parseNotation(row.command).filter((part) => part.type === "text").map((part) => part.text) : [];
    if (unreadable.length) warnings.push(`${row.name}: コマンド「${row.command}」の ${unreadable.join("・")} は文字のまま表示されます`);
    return row;
  });
  const counts = CATEGORIES.map((category) => `${category} ${rows.filter((row) => row.category === category).length}`);
  warnings.push(`カテゴリ別：${counts.join(" / ")}（計${rows.length}）`);
  if (errors.length) return { sql: null, errors, warnings };

  const name = literal(character);
  const sql = [
    `-- ${character}: ${input.dataVersion.trim()} (${input.checkedOn}) ${rows.length} moves`,
    `insert into public.sf6_move_sets (character, data_version, source_url, checked_on, move_count)`,
    `values (${name}, ${literal(input.dataVersion.trim())}, ${literal(input.sourceUrl)}, ${literal(input.checkedOn)}, ${rows.length})`,
    `on conflict (character) do update set data_version = excluded.data_version, source_url = excluded.source_url,`,
    `  checked_on = excluded.checked_on, move_count = excluded.move_count, updated_at = now();`,
    `delete from public.sf6_moves where character = ${name};`,
    `insert into public.sf6_moves (character, ${COLUMNS.join(", ")}) values`,
    `${rows.map((row) => `  (${[name, ...COLUMNS.map((column) => literal(row[column]))].join(", ")})`).join(",\n")};`,
    ...(dryRun
      ? [`do $$ begin raise exception 'DRYRUN: % moves', (select count(*) from public.sf6_moves where character = ${name}); end $$;`]
      : []),
  ].join("\n");
  return { sql: `${sql}\n`, errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    console.error("使い方: node scripts/sf6-moves-sql.mjs [--dry-run] <character>.json");
    process.exit(2);
  }
  const { sql, errors, warnings } = buildMovesSql(JSON.parse(readFileSync(path, "utf8")), { dryRun });
  warnings.forEach((warning) => console.error(`warning: ${warning}`));
  if (!sql) {
    errors.forEach((error) => console.error(`error: ${error}`));
    process.exit(1);
  }
  process.stdout.write(sql);
}
