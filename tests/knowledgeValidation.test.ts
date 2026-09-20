import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REQUEST_CHARS,
  isUuid,
  readJsonBody,
  validateKnowledgeInput,
  validateKnowledgeUpdateEnvelope,
  validateMutationRequest,
} from "../functions/_shared/knowledgeValidation.ts";
import { requestSupabaseRows } from "../functions/_shared/supabaseRest.ts";

function mutationRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://dashboard.example/api/knowledge", {
    method: "POST",
    headers: {
      Origin: "https://dashboard.example",
      "Content-Type": "application/json",
      "X-Dashboard-Action": "knowledge-write",
      ...headers,
    },
    body,
  });
}

test("新規ナレッジを検証し、文字列とタグを正規化する", () => {
  const result = validateKnowledgeInput({
    title: "  タイトル  ",
    category: " 技術 ",
    mastery: "習得中",
    priority: "最高",
    explanation: " 説明 ",
    source_note: " ",
    tags: ["API", " API ", "Cloudflare"],
    next_review_on: "2026-09-30",
  }, "create");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    title: "タイトル",
    category: "技術",
    mastery: "習得中",
    priority: "最高",
    explanation: "説明",
    source_note: null,
    tags: ["API", "Cloudflare"],
    next_review_on: "2026-09-30",
  });
});

test("必須・許可項目・日付・文字数を厳格に検証する", () => {
  assert.equal(validateKnowledgeInput({ category: "技術" }, "create").ok, false);
  assert.equal(validateKnowledgeInput({ title: "a", category: "b", id: "x" }, "create").ok, false);
  assert.equal(validateKnowledgeInput({ next_review_on: "2026-02-30" }, "update").ok, false);
  assert.equal(validateKnowledgeInput({ title: "x".repeat(201) }, "update").ok, false);
  assert.equal(validateKnowledgeInput({ priority: "最優先" }, "update").ok, false);
  assert.deepEqual(validateKnowledgeInput({ archived: true }, "update"), {
    ok: true,
    value: { archived: true },
  });
});

test("更新要求は期待バージョンと変更内容を組で検証する", () => {
  assert.deepEqual(
    validateKnowledgeUpdateEnvelope({ expected_version: 3, changes: { archived: true } }),
    { ok: true, expectedVersion: 3, changes: { archived: true } },
  );
  assert.equal(validateKnowledgeUpdateEnvelope({ changes: { archived: true } }).ok, false);
  assert.equal(validateKnowledgeUpdateEnvelope({ expected_version: 0, changes: { archived: true } }).ok, false);
  assert.equal(validateKnowledgeUpdateEnvelope({ expected_version: 1, changes: {} }).ok, false);
  assert.equal(
    validateKnowledgeUpdateEnvelope({ expected_version: 1, changes: { archived: true }, extra: true }).ok,
    false,
  );
});

test("書き込み要求は同一オリジン・専用ヘッダー・JSONを必須にする", () => {
  assert.equal(validateMutationRequest(mutationRequest("{}")), null);
  const wrongOrigin = mutationRequest("{}", { Origin: "https://attacker.example" });
  assert.equal(validateMutationRequest(wrongOrigin)?.status, 403);
  const noAction = mutationRequest("{}", { "X-Dashboard-Action": "" });
  assert.equal(validateMutationRequest(noAction)?.status, 403);
  const wrongType = mutationRequest("{}", { "Content-Type": "text/plain" });
  assert.equal(validateMutationRequest(wrongType)?.status, 415);
});

test("JSON本文の構文と実サイズを検証する", async () => {
  const valid = await readJsonBody(mutationRequest('{"title":"ok"}'));
  assert.equal(valid.ok, true);
  const malformed = await readJsonBody(mutationRequest("{"));
  assert.deepEqual(malformed, { ok: false, status: 400, error: "JSONの形式が正しくありません。" });
  const oversized = await readJsonBody(mutationRequest(`"${"x".repeat(MAX_REQUEST_CHARS)}"`));
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.status, 413);
});

test("UUIDを検証する", () => {
  assert.equal(isUuid("123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isUuid("not-a-uuid"), false);
});

test("Supabase書き込みはSecretをヘッダーだけに付与する", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return Response.json([{ id: "123e4567-e89b-42d3-a456-426614174000" }]);
  };
  try {
    const result = await requestSupabaseRows(
      { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-test-key" },
      {
        table: "knowledge",
        params: new URLSearchParams({ select: "id" }),
        method: "POST",
        body: { title: "test" },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(seenUrl.includes("secret-test-key"), false);
    assert.equal(seenInit?.method, "POST");
    assert.equal((seenInit?.headers as Record<string, string>).apikey, "secret-test-key");
    assert.equal((seenInit?.headers as Record<string, string>).Prefer, "return=representation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
