import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationTrend } from "../src/lib/registrationTrend.ts";

test("日別集計はcreated_atをJSTの日付として扱い、0件の日も補完する", () => {
  const knowledge = [
    { created_at: "2026-09-21T14:59:00Z" }, // JST 9/21
    { created_at: "2026-09-21T15:01:00Z" }, // JST 9/22
    { created_at: "2026-09-22T03:00:00Z" }, // JST 9/22
  ];

  assert.deepEqual(
    buildRegistrationTrend(knowledge, "day", new Date("2026-09-23T03:00:00Z"), 3),
    [
      { key: "2026-09-21", label: "9/21", count: 1 },
      { key: "2026-09-22", label: "9/22", count: 2 },
      { key: "2026-09-23", label: "9/23", count: 0 },
    ],
  );
});

test("週別集計は月曜始まりで直近週を連続表示する", () => {
  const knowledge = [
    { created_at: "2026-09-07T00:00:00Z" },
    { created_at: "2026-09-13T14:59:00Z" },
    { created_at: "2026-09-14T00:00:00Z" },
    { created_at: "2026-09-22T00:00:00Z" },
  ];

  assert.deepEqual(
    buildRegistrationTrend(knowledge, "week", new Date("2026-09-23T03:00:00Z"), 3),
    [
      { key: "2026-09-07", label: "9/7週", count: 2 },
      { key: "2026-09-14", label: "9/14週", count: 1 },
      { key: "2026-09-21", label: "9/21週", count: 1 },
    ],
  );
});

test("期間外・未来・不正な登録日時を除外する", () => {
  const knowledge = [
    { created_at: "2026-08-01T00:00:00Z" },
    { created_at: "2026-09-24T00:00:00Z" },
    { created_at: "not-a-date" },
  ];

  assert.equal(
    buildRegistrationTrend(knowledge, "day", new Date("2026-09-23T03:00:00Z"), 30)
      .reduce((sum, point) => sum + point.count, 0),
    0,
  );
});
