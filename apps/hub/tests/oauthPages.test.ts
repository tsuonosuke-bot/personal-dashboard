import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public OAuth pages explain Calendar data use and link the required disclosures", async () => {
  const [home, privacy, terms] = await Promise.all([
    readFile(new URL("../public/oauth/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/oauth/privacy/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/oauth/terms/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(home, /Google Calendarに登録/);
  assert.match(home, /href="\/oauth\/privacy\/"/);
  assert.match(home, /href="\/oauth\/terms\/"/);
  assert.match(privacy, /更新トークンはAES-GCMで暗号化/);
  assert.match(privacy, /Claudeを含む生成AIサービスへGoogle Calendarのデータや認証情報を送信しません/);
  assert.match(privacy, /myaccount\.google\.com\/permissions/);
  assert.match(terms, /本アプリはGoogleが提供・保証するサービスではありません/);
  assert.doesNotMatch(`${home}\n${privacy}\n${terms}`, /GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION_KEY/);
});
