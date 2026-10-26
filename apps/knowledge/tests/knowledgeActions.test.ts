import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useKnowledgeActions } from "../src/hooks/useKnowledgeActions.ts";
import type { Knowledge } from "../src/types.ts";

type Options = Parameters<typeof useKnowledgeActions>[0];

function captureActions(overrides: Partial<Options> = {}) {
  const events: unknown[] = [];
  const options = {
    data: {
      createKnowledge: async () => { events.push("create"); },
      updateKnowledge: async (...args: unknown[]) => { events.push(args); return { id: "card", content_version: 8, archived: true }; },
      removeAutoTag: async () => {}, reload: async () => null,
    },
    navigation: {
      replaceRoute: (route: unknown) => events.push(route),
      setOrganize: () => {}, setShowSearch: () => {}, setShowHelp: () => {},
      setSelected: (value: unknown) => events.push(["selected", value]),
      setPage: (page: number) => events.push(["page", page]),
    },
    setNotice: (notice: unknown) => events.push(["notice", notice]),
    setActionError: (error: unknown) => events.push(["error", error]),
    ...overrides,
  } as Options;
  let actions: ReturnType<typeof useKnowledgeActions> | undefined;
  function Capture({ onActions }: { onActions: (value: ReturnType<typeof useKnowledgeActions>) => void }) {
    onActions(useKnowledgeActions(options));
    return null;
  }
  renderToStaticMarkup(createElement(Capture, { onActions: (value) => { actions = value; } }));
  assert.ok(actions);
  return { actions, events, options };
}

function withConfirmation(confirmed: boolean, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => confirmed } });
  return run().finally(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
}

const item = { id: "card", title: "対象", content_version: 7 } as Knowledge;

test("archive cancellation never calls the update API or clears the current screen", async () => {
  const { actions, events } = captureActions();
  await withConfirmation(false, () => actions.archiveKnowledge(item));
  assert.deepEqual(events, []);
});

test("archive and undo use the expected versions and navigate only after a successful update", async () => {
  const { actions, events } = captureActions();
  await withConfirmation(true, () => actions.archiveKnowledge(item));
  assert.deepEqual(events[0], ["error", null]);
  assert.deepEqual(events[1], ["card", 7, { archived: true }]);
  assert.deepEqual(events[2], { kind: "dashboard" });
  assert.ok(events.some((event) => JSON.stringify(event) === JSON.stringify(["selected", null])));
  // Undo receives the row returned by the archive response, including its incremented version.
  await actions.restoreKnowledge({ ...item, content_version: 8, archived: true });
  assert.ok(events.some((event) => JSON.stringify(event) === JSON.stringify(["card", 8, { archived: false }])));
  assert.deepEqual(events.at(-1), ["page", 1]);
});

test("a failed archive keeps the detail and route intact and exposes the conflict", async () => {
  const { options } = captureActions();
  const { actions, events } = captureActions({ data: {
    ...options.data,
    updateKnowledge: async () => { throw new Error("別の画面で更新されています。"); },
  } });
  await withConfirmation(true, () => actions.archiveKnowledge(item));
  assert.deepEqual(events, [["error", null], ["error", "別の画面で更新されています。"]]);
});

test("a failed new-card save does not announce success or reset the list", async () => {
  const { options } = captureActions();
  const { actions, events } = captureActions({ data: {
    ...options.data,
    createKnowledge: async () => { throw new Error("保存できません。"); },
  } });
  await actions.saveKnowledge({ title: "new" } as Parameters<typeof actions.saveKnowledge>[0]);
  assert.deepEqual(events, [["error", null], ["error", "保存できません。"]]);
});
