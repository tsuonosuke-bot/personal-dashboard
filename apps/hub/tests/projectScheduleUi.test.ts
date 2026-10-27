import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const {
  createProjectScheduleController,
  projectScheduleCalendar,
  projectScheduleLinks,
  safeProjectCalendarUrl,
} = await import(new URL("../public/projects/schedule.js", import.meta.url).href);
const stamp = "2026-10-27T00:00:00.123456+00:00";
const later = "2026-10-27T00:01:00.654321+00:00";
const requestId = "a1b2c3d4-1234-4abc-8def-1234567890ab";
const action = {
  id: 11,
  content: "申し込む",
  status: "next",
  updatedAt: stamp,
  startOn: "2026-11-04",
  dueOn: null,
  linkedTodo: null,
};
const project = {
  id: 1,
  title: "試験",
  outcome: "受験する",
  status: "active",
  updatedAt: stamp,
  actions: [action],
  nextAction: action,
};
const calendar = {
  allDay: false,
  date: "2026-11-04",
  startTime: "09:00",
  endTime: "10:00",
  timeZone: "Asia/Tokyo",
};
function operation(stage = "planned", overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    actionId: action.id,
    projectId: project.id,
    actionUpdatedAt: stamp,
    projectUpdatedAt: stamp,
    content: action.content,
    calendar,
    stage,
    eventId: `pc${requestId.replace(/-/g, "")}`,
    calendarUrl: null,
    calendarEtag: null,
    todoId: ["todo_created", "linked"].includes(stage) ? 71 : null,
    errorCode: null,
    ...overrides,
  };
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function setup(
  responder: (url: string, init?: RequestInit) => Promise<unknown> = async () => ({
    operation: null,
  }),
  extra: Record<string, unknown> = {},
) {
  const saved = storage();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const controller = createProjectScheduleController({
    project,
    action,
    storage: saved,
    refreshProject: async () => project,
    request: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return responder(url, init);
    },
    randomUUID: () => requestId,
    ...extra,
  });
  return { controller, state: controller.state, saved, calls };
}
const failure = (message: string, payload?: unknown) =>
  Object.assign(new Error(message), { payload });

test("予定モーダルの初期化・キャンセル相当ではGETだけ、下書きは再訪問でも保持", async () => {
  const { controller, saved, calls } = setup();
  await controller.load();
  assert.equal(controller.state.draft.content, action.content);
  assert.equal(controller.state.draft.date, action.startOn);
  controller.setDraft({ content: "フォームを書く", startTime: "13:00", endTime: "14:00" });
  const reopened = setup(undefined, { storage: saved }).controller;
  await reopened.load();
  assert.equal(reopened.state.draft.content, "フォームを書く");
  assert.equal(reopened.state.draft.startTime, "13:00");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(reopened.locked(), false);
});

test("初回GET失敗・不正応答では新規POSTできず、入力を保持したGET再試行で回復", async () => {
  let failed = true;
  const { controller, calls } = setup(async () => {
    if (failed) throw new Error("login required");
    return { operation: null };
  });
  controller.setDraft({ content: "入力を保持" });
  assert.equal(await controller.load(), false);
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(calls.length, 1);
  assert.equal(controller.state.draft.content, "入力を保持");
  failed = false;
  assert.equal(await controller.load(), true);
  assert.equal(controller.state.consent, false);
  const invalid = setup(async () => ({})).controller;
  assert.equal(await invalid.load(), false);
  assert.equal(invalid.state.checked, false);
});

test("明示確認・正しいJST時刻が揃うまで保存せず、送信前に同じ要求を永続化", async () => {
  let sawPendingBeforePost = false;
  const { controller, saved, calls } = setup(async (_url, init) => {
    if (!init?.method) return { operation: null };
    sawPendingBeforePost = [...saved.values.values()].some(
      (value) => JSON.parse(value).pending?.requestId === requestId,
    );
    const body = JSON.parse(String(init.body));
    assert.equal(body.actionUpdatedAt, stamp);
    assert.equal(body.projectUpdatedAt, stamp);
    assert.equal(body.requestId, requestId);
    assert.deepEqual(body.calendar, calendar);
    assert.equal(
      (init.headers as Record<string, string>)["X-Dashboard-Action"],
      "project-schedule-create",
    );
    return { operation: operation("linked") };
  });
  await controller.load();
  assert.equal(await controller.submit(), false);
  assert.equal(calls.length, 1);
  controller.setDraft({ endTime: "08:00" });
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(calls.length, 1);
  controller.setDraft({ endTime: "10:00" });
  assert.equal(controller.state.consent, false);
  controller.setConsent(true);
  assert.equal(await controller.submit(), true);
  assert.equal(sawPendingBeforePost, true);
  assert.equal(saved.values.size, 0);
  assert.equal(controller.state.operation.stage, "linked");
});

test("送信応答喪失・ログイン切れでは同じ要求を凍結し、GET確認後だけ同じキーで再送", async () => {
  let postCount = 0;
  const bodies: string[] = [];
  const { controller, saved, calls } = setup(async (_url, init) => {
    if (!init?.method) return { operation: null };
    bodies.push(String(init.body));
    postCount++;
    if (postCount === 1) throw new Error("認証の有効期限が切れました。");
    return { operation: operation("linked") };
  });
  await controller.load();
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(controller.state.checked, false);
  assert.equal(controller.state.resultUnknown, true);
  controller.setDraft({ content: "別の予定に変更" });
  assert.equal(controller.state.draft.content, action.content);
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(postCount, 1);
  await controller.load();
  controller.setConsent(true);
  assert.equal(await controller.submit(), true);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 2);
  assert.equal(saved.values.size, 0);
});

test("結果不明のまま閉じて再訪問してもrequestId/content/calendarと元snapshotを保持", async () => {
  const original = setup(async (_url, init) => {
    if (init?.method) throw new Error("timeout");
    return { operation: null };
  });
  await original.controller.load();
  original.controller.setConsent(true);
  await original.controller.submit();
  const pending = structuredClone(original.controller.state.pending);
  const reopened = setup(undefined, { storage: original.saved }).controller;
  assert.deepEqual(reopened.state.pending, pending);
  await reopened.load();
  assert.deepEqual(reopened.state.pending, pending);
  assert.equal(reopened.locked(), true);
  assert.equal(reopened.state.resultUnknown, true);
});

test("Calendar部分成功は単なる未保存に戻さず保存済み内容を固定しToDo/Calendarへ案内", async () => {
  const op = operation("todo_created", {
    calendarUrl: "https://calendar.google.com/calendar/event?eid=test",
    calendarEtag: '"etag"',
  });
  const { controller } = setup(async (_url, init) => {
    if (!init?.method) return { operation: null };
    throw failure("紐づけに失敗", {
      error: { code: "TODO_ALREADY_LINKED", message: "紐づけに失敗" },
      operation: op,
      resultUnknown: false,
    });
  });
  await controller.load();
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(controller.state.operation.stage, "todo_created");
  assert.equal(controller.state.pending.requestId, requestId);
  assert.equal(controller.state.needsRefresh, true);
  assert.equal(controller.state.resultUnknown, false);
  controller.setDraft({ date: "2026-12-01" });
  assert.equal(controller.state.draft.date, calendar.date);
  const links = projectScheduleLinks(controller.state);
  assert.match(links[0].href, /view=todos&id=71&history=1/);
  assert.match(links[1].href, /^https:\/\/calendar\.google\.com/);
});

test("同時編集後は明示的な最新取得と再確認が必要で、取得自体ではPOSTしない", async () => {
  const freshAction = { ...action, content: "変更後のAction", updatedAt: later };
  const freshProject = {
    ...project,
    updatedAt: later,
    actions: [freshAction],
    nextAction: freshAction,
  };
  const bodies: Array<Record<string, unknown>> = [];
  let refreshed = 0;
  const { controller, calls } = setup(
    async (_url, init) => {
      if (!init?.method) return { operation: operation() };
      bodies.push(JSON.parse(String(init.body)));
      return {
        operation: operation("linked", { actionUpdatedAt: later, projectUpdatedAt: later }),
      };
    },
    {
      project: freshProject,
      action: freshAction,
      refreshProject: async () => {
        refreshed++;
        return freshProject;
      },
    },
  );
  await controller.load();
  assert.equal(controller.state.needsRefresh, true);
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(bodies.length, 0);
  assert.equal(await controller.refresh(), true);
  assert.equal(refreshed, 1);
  assert.equal(calls.length, 1);
  assert.equal(controller.state.consent, false);
  assert.equal(controller.state.action.content, "変更後のAction");
  assert.equal(controller.state.draft.content, action.content);
  assert.equal(await controller.submit(), false);
  controller.setConsent(true);
  assert.equal(await controller.submit(), true);
  assert.equal(bodies[0].actionUpdatedAt, later);
  assert.equal(bodies[0].projectUpdatedAt, later);
  assert.equal(bodies[0].content, action.content);
  assert.equal(bodies[0].requestId, requestId);
});

test("最新取得が失敗・終了済み・別ToDoリンクの場合、作成を再開しない", async () => {
  for (const kind of ["failed", "closed", "linked"]) {
    const { controller, calls } = setup(async () => ({ operation: operation("todo_created") }), {
      refreshProject: async () => {
        if (kind === "failed") throw new Error("unavailable");
        const next = { ...action, linkedTodo: kind === "linked" ? { id: 99 } : null };
        return { ...project, status: kind === "closed" ? "completed" : "active", actions: [next] };
      },
    });
    await controller.load();
    assert.equal(await controller.refresh(), false);
    controller.setConsent(true);
    assert.equal(await controller.submit(), false);
    assert.equal(calls.length, 1);
    if (kind === "linked") assert.equal(projectScheduleLinks(controller.state).length, 2);
  }
});

test("送信中の二重保存を抑止し、応答喪失でもlinked確認済みなら保存成功と扱う", async () => {
  let release: (value: unknown) => void = () => {};
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const { controller, calls } = setup(async (_url, init) => {
    if (!init?.method) return { operation: null };
    return wait;
  });
  await controller.load();
  controller.setConsent(true);
  const first = controller.submit();
  assert.equal(controller.state.busy, true);
  assert.equal(await controller.submit(), false);
  controller.setDraft({ content: "ignored" });
  assert.equal(controller.state.draft.content, action.content);
  release({ operation: operation("linked") });
  assert.equal(await first, true);
  assert.equal(calls.length, 2);
  const lost = setup(async (_url, init) => {
    if (!init?.method) return { operation: null };
    throw failure("response lost", {
      error: { message: "response lost" },
      operation: operation("linked"),
      resultUnknown: false,
    });
  });
  await lost.controller.load();
  lost.controller.setConsent(true);
  assert.equal(await lost.controller.submit(), true);
  assert.equal(lost.saved.values.size, 0);
});

test("終日・不正日付と時刻を検証し、Calendarリンクの危険なURLを出さない", () => {
  assert.deepEqual(projectScheduleCalendar({ ...calendar, allDay: true }), {
    ...calendar,
    allDay: true,
    startTime: null,
    endTime: null,
  });
  for (const invalid of [
    { ...calendar, date: "2026-02-30" },
    { ...calendar, startTime: "25:00" },
    { ...calendar, endTime: "08:00" },
  ])
    assert.equal(projectScheduleCalendar(invalid), null);
  for (const url of [
    "javascript:alert(1)",
    "https://google.com.evil.example",
    "http://calendar.google.com",
    "https://user:pass@google.com",
    "//google.com",
    null,
  ])
    assert.equal(safeProjectCalendarUrl(url), null);
  assert.equal(
    safeProjectCalendarUrl("https://calendar.google.com/calendar/"),
    "https://calendar.google.com/calendar/",
  );
});

test("ブラウザ保存拒否でも同じ要求をメモリに保持し、linkedの再訪問では新規POSTしない", async () => {
  const refused = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const { controller, calls } = setup(async () => ({ operation: operation("linked") }), {
    storage: refused,
  });
  assert.equal(await controller.load(), true);
  assert.equal(controller.state.operation.stage, "linked");
  controller.setConsent(true);
  assert.equal(await controller.submit(), false);
  assert.equal(calls.length, 1);
});

test("dialogはCalendar効果・最新状態再確認・忙しい間の閉じ防止と保存後表示失敗を扱う", async () => {
  const source = await readFile(new URL("../public/projects/schedule.js", import.meta.url), "utf8");
  assert.match(source, /project-todo-dialog/);
  assert.match(source, /Google Calendarに予定を1件作成/);
  assert.match(source, /Asia\/Tokyo/);
  assert.match(source, /state\.busy\) event\.preventDefault/);
  assert.match(source, /予定と紐づけは保存済み/);
  assert.match(source, /await refreshProject\(project\.id\)/);
  assert.doesNotMatch(source, /method:\s*["'](?:PATCH|DELETE)["']/);
});
