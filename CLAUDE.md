# CLAUDE.md

npm workspacesのモノレポ。アプリごとの規約は各アプリのドキュメントに従う。

- `apps/hub`: `apps/hub/AGENTS.md`
- `apps/knowledge`: `apps/knowledge/CLAUDE.md`
- `apps/finance`: `apps/finance/README.md`
- `packages/dashboard-auth`（`@personal-dashboards/auth`）: 3アプリのPages Functionsが共有する、Cloudflare AccessのJWT検証・
  SSO引き継ぎとセッション・Basic認証のミドルウェア・Supabase RESTの共通部分。トークン形式とCookie名（`personal_hub_session`）は
  3アプリで揃える必要があるため、直すときはここ1か所を直す。アプリごとに違うもの（CSP、Hubが読めるパス、nonceを消費するRPC、
  引き継ぎ後の遷移先）は、各アプリの `functions/_middleware.ts` と `functions/_shared/sessionAuth.ts` から渡す

- 依存の追加は `npm install <pkg> -w apps/<app>`。アプリ配下に `package-lock.json` を作らない
- 変更したアプリで最低限 `npm run typecheck -w apps/<app>` を通す
- 3アプリは別々のCloudflare Pagesプロジェクト。共通コードをアプリ間で `import` する場合は、
  Pagesのビルドが通ることを確認してから入れる。Functionsは `vite build` ではバンドルされないので、
  `cd apps/<app> && node ../hub/node_modules/wrangler/bin/wrangler.js pages functions build --outdir <tmp>` で確かめる
  （Build commandがルートで `npm ci` するので、`@personal-dashboards/auth` はnode_modulesのリンクとして解決される）
