import assert from "node:assert/strict";
import test from "node:test";
import { compassHistoryPath, compassRouteAllowsClosed, compassRoutePath, parseCompassRoute } from "../public/compass-routing.js";

test("Compass direct route accepts a positive record id with an explicit view", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&id=42"), {
    view: "wants",
    id: 42,
    filter: null,
    error: null,
  });
});

test("Compass direct route accepts only the untriaged Wants filter", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&filter=untriaged"), {
    view: "wants",
    id: null,
    filter: "untriaged",
    error: null,
  });
  assert.equal(parseCompassRoute("https://hub.example/compass/?filter=untriaged").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&filter=unknown").error, "invalid-target");
});

test("Compass direct route accepts ToDo records and timing filters", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=todos&id=7"), {
    view: "todos",
    id: 7,
    filter: null,
    error: null,
  });
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=todos&filter=overdue"), {
    view: "todos",
    id: null,
    filter: "overdue",
    error: null,
  });
  assert.equal(compassRoutePath("https://hub.example/compass/", "todos", null, "today"), "/compass/?view=todos&filter=today");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=todos&filter=knowledge").error, "invalid-target");
});

test("Compass direct route accepts Knowledge and GitHub pending filters for Wants", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&filter=knowledge"), {
    view: "wants",
    id: null,
    filter: "knowledge",
    error: null,
  });
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&filter=github"), {
    view: "wants",
    id: null,
    filter: "github",
    error: null,
  });
  assert.equal(parseCompassRoute("https://hub.example/compass/?filter=knowledge").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=bogus&filter=knowledge").error, "invalid-target");
  assert.equal(
    compassRoutePath("https://hub.example/compass/", "wants", null, "knowledge"),
    "/compass/?view=wants&filter=knowledge",
  );
  assert.equal(
    compassRoutePath("https://hub.example/compass/", "wants", null, "github"),
    "/compass/?view=wants&filter=github",
  );
});

test("Compass direct route rejects unsafe or incomplete targets", () => {
  assert.equal(parseCompassRoute("https://hub.example/compass/?id=42").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&id=-1").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&id=1.5").error, "invalid-target");
});

test("Compass route paths preserve unrelated callback parameters", () => {
  assert.equal(
    compassRoutePath("https://hub.example/compass/?calendar=connected", "wants", 42),
    "/compass/?calendar=connected&view=wants&id=42",
  );
  assert.equal(
    compassRoutePath("https://hub.example/compass/?view=wants&id=42", "wants"),
    "/compass/?view=wants",
  );
  assert.equal(
    compassRoutePath("https://hub.example/compass/", "wants", null, "untriaged"),
    "/compass/?view=wants&filter=untriaged",
  );
});

test("Inboxの詳細URLはviewを付けて書き、そのまま開き直せる", () => {
  const path = compassRoutePath("https://hub.example/compass/", "inbox", 192);
  assert.equal(path, "/compass/?view=inbox&id=192");
  assert.deepEqual(parseCompassRoute(`https://hub.example${path}`), { view: "inbox", id: 192, filter: null, error: null });
  assert.equal(compassRoutePath(`https://hub.example${path}`, "inbox"), "/compass/");
});

test("明示的な相互リンクだけが整理済みInboxと完了・見送りToDoの詳細を開く", () => {
  for (const view of ["inbox", "todos"] as const) {
    const path = compassHistoryPath(view, 12);
    assert.equal(path, `/compass/?view=${view}&id=12&history=1`);
    const route = parseCompassRoute(`https://hub.example${path}`);
    assert.deepEqual(route, { view, id: 12, filter: null, error: null, history: true });
    for (const status of view === "inbox" ? ["done", "skipped", "completed", "closed", "cancelled"] : ["completed", "skipped"]) {
      assert.equal(compassRouteAllowsClosed(route, status), true);
      assert.equal(compassRouteAllowsClosed(parseCompassRoute(`https://hub.example/compass/?view=${view}&id=12`), status), false,
        "従来のHub/Todayリンクは完了後に一覧へ戻る");
    }
    assert.equal(compassRouteAllowsClosed(route, "archived"), false, "アーカイブの新しい再開導線へ広げない");
  }
});

test("履歴指定は有効なInbox/ToDo詳細に限り、Wants・一覧・壊れた値には適用しない", () => {
  for (const query of ["history=1", "view=inbox&history=1", "view=todos&filter=today&history=1", "view=wants&id=12&history=1",
    "view=unknown&id=12&history=1", "view=inbox&id=-1&history=1", "view=inbox&id=12&history=true", "view=inbox&id=12&history=0"]) {
    const route = parseCompassRoute(`https://hub.example/compass/?${query}`);
    assert.equal(route.error, "invalid-target", query);
    assert.equal(compassRouteAllowsClosed(route, "done"), false);
  }
  assert.throws(() => compassHistoryPath("inbox", 0), /Invalid history/);
});

test("詳細を閉じたりタブ・条件を変えると履歴指定を除き、無関係なcallback値を保つ", () => {
  const href = "https://hub.example/compass/?calendar=connected&view=todos&id=12&history=1#source";
  assert.equal(compassRoutePath(href, "todos"), "/compass/?calendar=connected&view=todos#source");
  assert.equal(compassRoutePath(href, "inbox", 15), "/compass/?calendar=connected&view=inbox&id=15#source");
  assert.equal(compassRoutePath(href, "todos", null, "today"), "/compass/?calendar=connected&view=todos&filter=today#source");
  assert.equal(compassRoutePath(href, "todos", 12, null, true), "/compass/?calendar=connected&view=todos&id=12&history=1#source");
});
