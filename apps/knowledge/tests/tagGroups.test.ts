import assert from "node:assert/strict";
import test from "node:test";
import { distinctTags, filterTagKnowledge, tagGroupsForKnowledge } from "../src/lib/tagGroups.ts";

type Item = {
  id: string;
  title: string;
  category: string;
  explanation: string | null;
  source_note: string | null;
  tags: string[];
};

function item(id: string, tags: string[], patch: Partial<Item> = {}): Item {
  return { id, title: id, category: "ビジネス", explanation: null, source_note: null, tags, ...patch };
}

test("タグ件数は同じナレッジを重複計上せず、タグなしも数える", () => {
  const knowledge = [
    item("a", [" WWI ", "WWI", "歴史"]),
    item("b", ["WWI"]),
    item("c", ["  "]),
    item("d", []),
  ];
  assert.deepEqual(distinctTags(knowledge[0].tags), ["WWI", "歴史"]);
  assert.deepEqual(tagGroupsForKnowledge(knowledge), [
    { kind: "tag", tag: "WWI", count: 2 },
    { kind: "tag", tag: "歴史", count: 1 },
    { kind: "untagged", count: 2 },
  ]);
});

test("タグは部分一致させず、複数タグとタグなしを正しく絞る", () => {
  const knowledge = [
    item("short", ["AI", "仕事"]),
    item("long", ["AI活用"]),
    item("case", ["ai"]),
    item("empty", []),
  ];
  assert.deepEqual(filterTagKnowledge(knowledge, { kind: "tag", tag: "AI" }, "", "").map((row) => row.id), ["short"]);
  assert.deepEqual(filterTagKnowledge(knowledge, { kind: "tag", tag: "仕事" }, "", "").map((row) => row.id), ["short"]);
  assert.deepEqual(filterTagKnowledge(knowledge, { kind: "untagged" }, "", "").map((row) => row.id), ["empty"]);
});

test("カテゴリと本文検索を併用し、タグ集計も選択カテゴリに合わせる", () => {
  const knowledge = [
    item("mail", ["仕事"], { title: "依頼メール", source_note: "交渉の本" }),
    item("meeting", ["仕事"], { title: "会議", explanation: "判断を説明する" }),
    item("home", ["仕事"], { category: "生活", title: "家事" }),
  ];
  const business = filterTagKnowledge(knowledge, { kind: "all" }, "ビジネス", "");
  assert.deepEqual(tagGroupsForKnowledge(business), [
    { kind: "tag", tag: "仕事", count: 2 },
    { kind: "untagged", count: 0 },
  ]);
  assert.deepEqual(filterTagKnowledge(knowledge, { kind: "tag", tag: "仕事" }, "ビジネス", "交渉").map((row) => row.id), ["mail"]);
  assert.deepEqual(filterTagKnowledge(knowledge, { kind: "tag", tag: "仕事" }, "ビジネス", "判断").map((row) => row.id), ["meeting"]);
});
