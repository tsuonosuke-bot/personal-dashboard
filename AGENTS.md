共通の開発・マイグレーション・環境変数の手順は [OPERATIONS.md](OPERATIONS.md) を参照。

# AGENTS.md

npm workspacesのモノレポ。アプリごとの規約は各アプリのドキュメントに従う。

- `apps/hub`: `apps/hub/AGENTS.md`
- `apps/knowledge`: `apps/knowledge/CLAUDE.md`
- `apps/finance`: `apps/finance/README.md`

統合の途中（[docs/pages-unification.md](docs/pages-unification.md)）。Knowledge・FinanceのFunctionsとサーバー側コードは
`apps/hub/functions/knowledge/`・`functions/finance/` にあり、画面（Vite）は各アプリに残る。
PagesプロジェクトはHubの1つで、`npm run build:pages -w apps/hub` が `/knowledge/`・`/finance/` を含む出力を作る。

- `packages/dashboard-auth`（`@personal-dashboards/auth`）: 3アプリのPages Functionsが共有する、Cloudflare AccessのJWT検証・
  SSO引き継ぎとセッション・Basic認証のミドルウェア・Supabase RESTの共通部分。トークン形式とCookie名（`personal_hub_session`）は
  3アプリで揃える必要があるため、直すときはここ1か所を直す。アプリごとに違うもの（CSP、Hubが読めるパス、nonceを消費するRPC、
  引き継ぎ後の遷移先）は、各アプリの `functions/_middleware.ts` と `functions/_shared/sessionAuth.ts` から渡す

- `packages/dashboard-shell`（`@personal-dashboards/shell`）: ダークテーマ生成スクリプト（`build-dark-theme.mjs`、3アプリ共通）と、KnowledgeとFinanceのヘッダー骨格CSS（sticky固定とiOSのsafe-area。各アプリの `index.css` から `@import` する）。色は各アプリのテーマに置く。Hubは静的CSS（`apps/hub/public/dashboard-shell.css`）なのでここは使わない

- 依存の追加は `npm install <pkg> -w apps/<app>`。アプリ配下に `package-lock.json` を作らない
- 変更したアプリで最低限 `npm run typecheck -w apps/<app>` を通す
- Functionsは `vite build` ではバンドルされないので、ルートの `npm run build:functions`（Hubのみ）で確かめる
  （Build commandがルートで `npm ci` するので、`@personal-dashboards/auth` はnode_modulesのリンクとして解決される）
