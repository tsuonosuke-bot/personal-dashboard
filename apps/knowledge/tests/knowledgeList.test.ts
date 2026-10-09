import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FILTERS, DEFAULT_SORT, listStatePath, parseListState } from "../src/lib/listState.ts";
import { dashboardRoutePath, parseDashboardRoute } from "../src/lib/dashboardRoute.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const knowledgeId = "123e4567-e89b-42d3-a456-426614174000";

test("一覧の条件・並び順・ページをURLへ書き、同じURLから復元する", () => {
  const state = {
    filters: { search: "英語 時制", category: "英文法", mastery: "学習中", priority: "高", review: "overdue" as const },
    sort: { key: "next_review_on" as const, direction: "asc" as const },
    page: 3,
    pageSize: 30,
  };
  const path = listStatePath("https://knowledge.example/", state);
  assert.equal(path, "/?q=%E8%8B%B1%E8%AA%9E+%E6%99%82%E5%88%B6&category=%E8%8B%B1%E6%96%87%E6%B3%95&mastery=%E5%AD%A6%E7%BF%92%E4%B8%AD&priority=%E9%AB%98&review=overdue&sort=next_review_on&dir=asc&page=3&size=30");
  assert.deepEqual(parseListState(`https://knowledge.example${path}`), state);
});

test("既定値はURLに書かず、不正な値は既定に戻す", () => {
  assert.equal(listStatePath("https://knowledge.example/", { filters: DEFAULT_FILTERS, sort: DEFAULT_SORT, page: 1, pageSize: 15 }), "/");
  assert.deepEqual(parseListState("https://knowledge.example/?mastery=x&priority=y&review=z&sort=evil&page=0&size=999"), {
    filters: DEFAULT_FILTERS, sort: DEFAULT_SORT, page: 1, pageSize: 15,
  });
});

test("詳細を開いても一覧の条件はURLに残り、閉じる・戻るで同じ一覧になる", () => {
  const list = "/?q=tense&page=2";
  const detail = dashboardRoutePath(`https://knowledge.example${list}`, { kind: "knowledge", knowledgeId });
  assert.equal(parseDashboardRoute(`https://knowledge.example${detail}`).kind, "knowledge");
  assert.equal(parseListState(`https://knowledge.example${detail}`).filters.search, "tense");
  assert.equal(parseListState(`https://knowledge.example${detail}`).page, 2);
  const back = dashboardRoutePath(`https://knowledge.example${detail}`, { kind: "dashboard" });
  assert.equal(back, list);
  // 一覧の書き込みは画面・ナレッジのパラメータを消さない
  assert.match(listStatePath(`https://knowledge.example${detail}`, parseListState(`https://knowledge.example${detail}`)), new RegExp(`knowledge=${knowledgeId}`));
});

test("App は一覧状態をURLから初期化し、replaceStateで書き、戻る操作で復元する", async () => {
  const app = await read("../src/App.tsx");
  assert.match(app, /useState\(\(\) => parseListState\(window\.location\.href\)\)/);
  assert.match(app, /window\.history\.replaceState\(window\.history\.state, "", path\)/);
  assert.match(app, /if \(!sameListState\(urlList, listStateRef\.current\)\) applyListState\(urlList\)/);
});

test("絞り込みは各入力に見えるラベルを持ち、適用中の条件チップと一括クリアがある", async () => {
  const bar = await read("../src/components/FilterBar.tsx");
  for (const label of ["検索", "カテゴリ", "習熟度", "優先度", "復習日"]) {
    assert.match(bar, new RegExp(`<label className="filter-field[^"]*">\\s*<span>${label}</span>`));
  }
  assert.match(bar, /aria-label="適用中の条件"/);
  assert.match(bar, /の条件を外す/);
  assert.match(bar, /条件をクリア/);
  assert.match(bar, /aria-live="polite"/);
});

test("スマホの一覧はカード表示で、並び順を選択欄で変えられる", async () => {
  const [table, styles] = await Promise.all([read("../src/components/KnowledgeTable.tsx"), read("../src/index.css")]);
  assert.match(table, /className="table-mobile-sort"/);
  assert.match(table, /data-label="次回復習"/);
  assert.match(table, /className="cell-action"/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.knowledge-table thead \{ display: none; \}/);
  assert.match(styles, /\.knowledge-table \.cell-review \{ grid-column: 1 \/ 2; \}/);
  assert.match(styles, /\.knowledge-table \.cell-action \{ grid-column: 2 \/ 3;/);
});
