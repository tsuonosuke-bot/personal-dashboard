import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { demoFinanceOverview } from "../apps/finance/src/lib/financeOverview.ts";
import {
  matchingExpenses,
  emptyTransactionFilters,
} from "../apps/finance/src/lib/expensePaging.ts";
import { runCategoryBatches } from "../apps/finance/src/lib/bulkCategories.ts";
import { buildFlow } from "../apps/hub/public/sf6-graph.js";
import { renderSf6VisibleTab } from "../apps/hub/public/sf6/render.js";
const baseline = "d2146d4c545c3d094d24222ef9f2cfcdc60269dd";
const root = fileURLToPath(new URL("..", import.meta.url));
const before = (file) =>
  execFileSync("git", ["show", baseline + ":" + file], { cwd: root, encoding: "utf8" }).replaceAll(
    "\r\n",
    "\n",
  );
const row = (id, date) => ({
  id,
  transaction_date: date,
  amount: id % 3 === 0 ? -50 : 100,
  title: "合成明細" + id,
  category: id % 5 === 0 ? "80_給与" : "97_未分類",
  payer: id % 2 ? "A" : "B",
  memo: "合成のメモ".repeat(20),
  notion_url: null,
  notion_created_at: null,
  created_at: "2026-10-20T00:00:00Z",
  voided_at: null,
});
const scope = { month: "2026-10", categories: [], categoryMode: "include", payer: "" };
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const finance = [];
for (const history of [1000, 5000, 10000]) {
  const rows = [
    ...Array.from({ length: history }, (_, i) => row(i + 1, "2001-01-01")),
    ...Array.from({ length: 140 }, (_, i) => row(history + i + 1, "2026-10-20")),
  ];
  const overview = demoFinanceOverview(rows, [], scope);
  const pageRows = matchingExpenses(rows, scope, emptyTransactionFilters);
  const page = { items: pageRows.slice(0, 50), total: pageRows.length, limit: 50, offset: 0 };
  let oldBytes = bytes({ items: [], total: 0, limit: 1000, offset: 0 });
  for (let offset = 0; offset < rows.length; offset += 1000)
    oldBytes += bytes({
      items: rows.slice(offset, offset + 1000),
      total: rows.length,
      limit: 1000,
      offset,
    });
  finance.push({
    historicalRows: history,
    before: {
      requests: Math.ceil(rows.length / 1000) + 1,
      expenseBodies: rows.length,
      bytes: oldBytes,
    },
    after: { requests: 2, expenseBodies: 50, bytes: bytes(overview) + bytes(page) },
    allHistoricalMonths: overview.metadata.months,
  });
}
let saves = 0,
  updates = 0;
const targets = Array.from({ length: 80 }, (_, i) => ({
  ...row(i + 1, "2026-10-20"),
  category: "97_未分類",
}));
const bulk = await runCategoryBatches(
  targets,
  "10_食費",
  {
    shouldStop: () => false,
    onProgress: () => {},
    onUpdated: () => {
      updates++;
    },
  },
  async (chunk) => {
    saves++;
    return chunk.map((item) => ({
      id: item.id,
      status: "updated",
      item: { ...item, category: "10_食費" },
    }));
  },
);
assert.equal(bulk.updated.length, 80);
let oldGraph = before("apps/hub/public/sf6-graph.js");
oldGraph = oldGraph.replace(
  '"./sf6-plan.js"',
  JSON.stringify(new URL("../apps/hub/public/sf6-plan.js", import.meta.url).href),
);
const { buildFlow: baselineFlow } = await import(
  "data:text/javascript;base64," + Buffer.from(oldGraph).toString("base64")
);
const graphs = [];
for (const size of [100, 200, 400]) {
  const situations = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    name: "局面" + i,
    kind: "state",
    character: "リュウ",
    advantage: i,
    position: "anywhere",
    recovery: null,
  }));
  const input = (counter) =>
    Array.from({ length: size }, (_, i) => {
      const entry = {
        id: i + 1,
        title: "手順" + i,
        character: "リュウ",
        archived: false,
        results: [{ kind: "hit", nextSituationId: ((i + 1) % size) + 1 }],
      };
      Object.defineProperty(entry, "starts", {
        enumerable: true,
        get() {
          counter.value++;
          return [i + 1];
        },
      });
      return entry;
    });
  const oldCounter = { value: 0 },
    newCounter = { value: 0 };
  const args = { situations, character: "リュウ", resultLabel: (exit) => exit.kind };
  const old = baselineFlow({ ...args, sequences: input(oldCounter) }),
    current = buildFlow({ ...args, sequences: input(newCounter) });
  assert.deepEqual(current, old);
  for (const options of [{ startSituationId: 1 }, { collapsed: [1] }, { hideUnset: true }])
    assert.deepEqual(
      buildFlow({ ...args, ...options, sequences: input({ value: 0 }) }),
      baselineFlow({ ...args, ...options, sequences: input({ value: 0 }) }),
    );
  graphs.push({
    sequences: size,
    beforeStartReads: oldCounter.value,
    afterStartReads: newCounter.value,
    nodes: current.nodes.length,
    links: current.links.length,
    identicalOutput: true,
  });
}
const rootBefore = before("apps/hub/public/sf6.js");
const rootAfter = (
  await readFile(new URL("../apps/hub/public/sf6.js", import.meta.url), "utf8")
).replaceAll("\r\n", "\n");
function renderCounts(source) {
  const render = source.match(/function render\(\) \{[\s\S]*?\n\}/)?.[0];
  if (!render) throw Error("render function missing");
  const counts = Object.fromEntries(
    ["sequences", "situations", "frames", "drills", "matches", "sheet"].map((key) => [key, 0]),
  );
  const context = {
    state: {
      tab: "sequences",
      sheet: null,
      data: { sequences: [], situations: [], drills: [], matches: [] },
    },
    els: Object.fromEntries(
      ["countSequences", "countSituations", "countDrills", "countMatches", "characterOptions"].map(
        (key) => [key, {}],
      ),
    ),
    CHARACTERS: [],
    charactersIn: () => [],
    escapeHtml: (value) => value,
    renderTabs: () => {},
    renderSf6VisibleTab,
  };
  for (const key of Object.keys(counts))
    context["render" + key[0].toUpperCase() + key.slice(1)] = () => {
      counts[key]++;
    };
  const current = source.match(/function renderCurrentTab\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  vm.runInNewContext(render + "\n" + current + "\nrender();", context);
  return counts;
}
const tabBefore = renderCounts(rootBefore),
  tabAfter = renderCounts(rootAfter);
assert.equal(
  Object.values(tabBefore).reduce((sum, count) => sum + count, 0),
  5,
);
assert.equal(
  Object.values(tabAfter).reduce((sum, count) => sum + count, 0),
  1,
);
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        kind: "local synthetic operation counts and serialized JSON bytes; no production, browser timing or network latency",
      },
      baseline,
      finance,
      financeBulk80: {
        beforeRequests: 80,
        afterRequests: saves,
        beforeStateUpdates: 80,
        afterStateUpdates: updates,
      },
      sf6Graph: graphs,
      sf6TabRender: { before: tabBefore, after: tabAfter },
    },
    null,
    2,
  ),
);
