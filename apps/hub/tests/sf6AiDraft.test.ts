import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSf6AiDraft, readSf6AiDraftInput, validateSf6AiDraftRequest } from "../functions/_shared/sf6AiDraft.ts";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/sf6/ai-draft", {
    method: "POST",
    headers: { Origin: "https://example.test", "X-Dashboard-Action": "sf6-ai-draft", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("AI下書きのリクエストは同一オリジンと専用ヘッダーを要求する", () => {
  assert.equal(validateSf6AiDraftRequest(request({})), null);
  assert.equal(validateSf6AiDraftRequest(request({}, { Origin: "https://evil.test" }))?.status, 403);
  assert.equal(validateSf6AiDraftRequest(request({}, { "X-Dashboard-Action": "sf6" }))?.status, 403);
});

test("AI下書きの入力はキャラと、文章か画像のどちらかを要求する", async () => {
  assert.equal((await readSf6AiDraftInput(request({ character: "豪鬼", text: "中K > 強P" }))).ok, true);
  assert.equal((await readSf6AiDraftInput(request({ character: "", text: "中K" }))).ok, false);
  assert.equal((await readSf6AiDraftInput(request({ character: "豪鬼" }))).ok, false);
  assert.equal((await readSf6AiDraftInput(request({ character: "豪鬼", image: { mediaType: "image/gif", data: "AAAA" } }))).ok, false);
  assert.equal((await readSf6AiDraftInput(request({ character: "豪鬼", image: { mediaType: "image/jpeg", data: "AAAA" } }))).ok, true);
  assert.equal((await readSf6AiDraftInput(request({ character: "豪鬼", text: "x", extra: 1 }))).ok, false);
});

test("AIの出力はフォームに入る範囲へ収め、レシピが空の下書きは捨てる", () => {
  const result = normalizeSf6AiDraft({
    drafts: [
      { title: " 中K始動 ", notation: "2中K  >  DR\n5中P", startup: 120, drive_cost: 3.3, sa_cost: 9, note: "" },
      { title: "空", notation: "  ", startup: 5, drive_cost: 0, sa_cost: 0, note: "" },
    ],
    unclear: ["", "2文字目が読めない"],
  });
  assert.equal(result.drafts.length, 1);
  assert.deepEqual(result.drafts[0], { title: "中K始動", notation: "2中K > DR 5中P", startup: null, driveCost: 3.5, saCost: 4, note: "" });
  assert.deepEqual(result.unclear, ["2文字目が読めない"]);
  assert.throws(() => normalizeSf6AiDraft({ drafts: "x" }));
});
