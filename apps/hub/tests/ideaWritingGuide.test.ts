import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readCompassScript } from "./compassScript.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Idea ToDoはスマホで検索とリスト／カレンダーを常設し、ステータスと予定を表示条件に収め、適用中の条件をチップで示す", async () => {
  const [html, script, styles] = await Promise.all([read("../public/compass/index.html"), readCompassScript(), read("../public/styles.css")]);
  assert.match(html, /id="todoConditionsToggle"[^>]*aria-expanded="false"[^>]*>表示条件 <b id="todoConditionsCount">/);
  assert.match(html, /id="todoActiveConditions" aria-label="適用中の表示条件"/);
  assert.match(script, /conditions\.push\(\{ key: "schedule", label: `予定: \$\{TODO_SCHEDULE_LABELS\[state\.metricFilter\]\}` \}\)/);
  assert.match(script, /els\.todoConditionsCount\.textContent = folded \? `\$\{folded\}件適用中` : ""/);
  assert.match(script, /data-clear-condition="\$\{condition\.key\}"/);
  assert.match(script, /if \(key === "schedule" \|\| key === "status"\) \{\n    setView\("todos", defaultStatusByView\.todos\)/);
  assert.match(styles, /\.workspace-tools\[data-view="todos"\]\[data-conditions="closed"\] #statusFilter,\n  \.workspace-tools\[data-view="todos"\]\[data-conditions="closed"\] \.todo-filter-group \{ display: none; \}/);
  // PCでは従来どおり全条件を出し、表示条件ボタンは出さない
  assert.match(styles, /@media \(min-width: 651px\) \{ \.todo-conditions-toggle \{ display: none !important; \} \}/);
});

test("Writingの追加ボタンは行き先が分かる名前で、執筆への振り分け手順を案内してからIdeaへ移る", async () => {
  const [html, script, compass] = await Promise.all([read("../public/writing/index.html"), read("../public/writing.js"), readCompassScript()]);
  assert.doesNotMatch(html, /<span>テーマを追加<\/span>/);
  assert.match(html, /id="addTopicButton"[^>]*aria-haspopup="dialog"[^>]*>.*<span>Ideaから追加<\/span>/);
  assert.match(html, /<h2 id="addGuideTitle">Ideaからテーマを追加<\/h2>/);
  assert.match(html, /振り分けで「執筆」を選ぶ/);
  assert.match(html, /href="\/compass\/\?view=wants&amp;from=writing">IdeaのWantsを開く →<\/a>/);
  assert.match(script, /els\.addTopicButton\.addEventListener\("click", \(\) => setAddGuideOpen\(true\)\)/);
  assert.match(compass, /if \(initialParameters\.get\("from"\) === "writing"\) \{\n  els\.writingRouteHint\.hidden = false;/);
});
