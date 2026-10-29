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

## 残り（切り替え前に必要）

1. **HubからKnowledge・Financeの読み取り**（`hubSources.ts`・`connectionStatus.ts`・`exportSnapshot.ts`）は、まだ `NAV_*_URL` へ
   `/api/...` をHTTPで取りに行く。同じプロジェクト内の呼び出しにする（ハンドラを直接呼ぶ）か、パスを `/knowledge/api/...` にする。
   自分自身へのfetchはPagesで失敗しうるので、直接呼ぶほうがよい。
2. **Hubの画面内リンク**（`tabbar.js` の `data-hub`、各画面の `← Hub`、`/go/*`）を新パスに合わせて確認する。
3. **DBのcronのURL**: `review_batch_trigger` と `semantic_embeddings` のマイグレーションが
   `https://knowledge-50b.pages.dev/api/...` を呼ぶ。切り替え時に `https://<Hub>/knowledge/api/...` へ更新する（本番DBへの適用は承認が要る）。
4. **Cloudflare側**（コードでは変えられない）:
   - Hubのプロジェクトのビルドコマンドを `npm ci && npm run build:pages -w apps/hub` にする。
   - 環境変数にKnowledgeの `REVIEW_BATCH_TOKEN`・`VOYAGE_API_KEY` を足す（他は共通）。
   - Cloudflare Accessのアプリケーションに `/knowledge/*`・`/finance/*` が含まれることを確認する。
   - 旧2プロジェクトを止め、旧URLからHubの新パスへリダイレクトする。
5. このブランチをmainにマージすると、旧Knowledge・Financeプロジェクトの自動デプロイは（Functionsが無くなるため）APIを失う。
   Cloudflareの切り替えと同じタイミングで行う。
