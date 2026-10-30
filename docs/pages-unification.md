# 3アプリを1つのPagesプロジェクトにまとめる

方針: Hubを土台に、Knowledge・Financeを `/knowledge/`・`/finance/` 配下へ寄せる。旧URLはリダイレクト。

## 済み（このブランチ）

- Knowledge・FinanceのFunctionsを `apps/hub/functions/{knowledge,finance}/` へ移した（`_shared` と `api`）。
  Hubの旧リバースプロキシ（`functions/{knowledge,finance}/[[path]].ts`）と、各アプリの `_middleware.ts`・SSO引き継ぎは廃止。
- 認証は `apps/hub/functions/_middleware.ts` の1本。CSPはパスで切り替える（`/knowledge`・`/finance` 配下だけ `style-src-attr 'unsafe-inline'`、
  マイクを止めるPermissions-Policyも付けない）。
- 合言葉（`REVIEW_BATCH_TOKEN`）とHubサービストークンの許可パスは `/knowledge/api/...`・`/finance/api/...` に変えた。
- `npm run build:pages -w apps/hub` がHubと両アプリを `apps/hub/dist` に出力する（Vite `base: "./"` のまま動く）。
- `scripts/build-functions.mjs` とCIはHubだけを確かめる。
- Hubの読み取り（`hubSources.ts`・`connectionStatus.ts`・`exportSnapshot.ts`）は、`NAV_KNOWLEDGE_URL`・`NAV_FINANCIAL_URL` が
  **未設定なら同じプロジェクトのハンドラを直接呼ぶ**（`_shared/dashboardInternal.ts`。サービストークン不要）。
  設定されていれば従来どおりそのURLへHTTPで取りに行く。切り替え後は両方を**削除**する。

## 済み（続き）

- 画面内リンク: KnowledgeとFinanceの `https://personal-dashboard-7md.pages.dev/...` を `/...`（同一オリジン）に変えた。
  `tabbar.js` は元から、Hubと同じオリジンなら相対リンクにする。
- DBのcron: `apps/knowledge/supabase/migrations/20261029100000_review_batch_urls_for_hub.sql` が、
  `trigger_review_batch`・`trigger_embedding_batch` の呼び出し先を `/knowledge/api/...` に変える。**まだ適用していない**。

## 切り替え手順（この順に行う）

Cloudflareの設定は、コードからは変えられない。ダッシュボードで行う。

1. **Hubのプロジェクトに環境変数を足す**（Production・Preview）。
   - `REVIEW_BATCH_TOKEN`: 旧Knowledgeプロジェクトと同じ値（Supabase Vaultの `review_batch_token` と同じ）。
   - `VOYAGE_API_KEY`: 旧Knowledgeプロジェクトと同じ値。
   - `ANTHROPIC_API_KEY`・`SUPABASE_*`・`DASHBOARD_*`・`AUTH_MODE`・`HUB_SERVICE_TOKEN`・`SSO_SHARED_SECRET`: Hubに設定済みのはず。確認する。
   - `NAV_KNOWLEDGE_URL`・`NAV_FINANCIAL_URL`: **削除**する（残すと旧プロジェクトを読みに行く）。
2. **Hubのビルドコマンド**を `cd ../.. && npm ci && npm run build:pages -w apps/hub` に変える。Root directoryは `apps/hub` のままなので、
   先頭の `cd ../..` が要る（無いと `npm ci` が `apps/hub` の中で動き、`No workspaces found` で失敗する）。出力は `apps/hub/dist`。
3. このブランチをmainにマージする。Hubが自動でデプロイされる。
4. 動作確認（Hubのドメインで）: `/knowledge/`・`/finance/` が開く、Knowledgeで問題が出る、Financeで家計簿が出る、
   Hubのホームに家計簿・ナレッジの件数が出る、`/status/` の接続状態が3つ正常、英会話練習でマイクが使える。
5. **DBのcronを切り替える**: 上のmigrationを、[運用手順](../OPERATIONS.md#マイグレーション)に従って適用する。
   適用前に、Hubの `/knowledge/api/review-batch/grade` が合言葉付きのPOSTで応答することを確認する。
6. **Cloudflare Access**を使っている場合、HubのAccessアプリケーションが `/knowledge/*`・`/finance/*` を含むことを確認する。
   旧Knowledge・Financeのドメインは、手順7まで残す。
7. 旧Knowledge・Financeのプロジェクトを止め、旧URLからHubの `/knowledge/`・`/finance/` へリダイレクトする
   （Cloudflareのリダイレクトルールか、旧プロジェクトに `_redirects` だけを置いて公開する）。
8. cronが `/knowledge/api/...` を呼べていることを、数時間後に `cron.job_run_details` と `net._http_response` で確認する。

mainへのマージ（手順3）から手順5の間は、cronが旧URLを呼ぶ。旧Knowledgeプロジェクトは自動デプロイでFunctionsを失う
（`apps/knowledge/functions` を削除したため）ので、**手順3と5は続けて行う**。

## 残りの任意の整理

- `apps/knowledge`・`apps/finance` の `.dev.vars.example`・`wrangler` 周りは、ローカルでの単独起動用に残してある。
  使わなければ後で消す。
- `HUB_SERVICE_TOKEN`・`isHubServiceRequest` は、旧プロジェクトが生きている間のHTTP読み取りのために残してある。
  切り替え後に消せる。
