# CLAUDE.md

npm workspacesのモノレポ。アプリごとの規約は各アプリのドキュメントに従う。

- `apps/hub`: `apps/hub/AGENTS.md`
- `apps/knowledge`: `apps/knowledge/CLAUDE.md`
- `apps/finance`: `apps/finance/README.md`

- 依存の追加は `npm install <pkg> -w apps/<app>`。アプリ配下に `package-lock.json` を作らない
- 変更したアプリで最低限 `npm run typecheck -w apps/<app>` を通す
- 3アプリは別々のCloudflare Pagesプロジェクト。共通コードをアプリ間で `import` する場合は、
  Pagesのビルドが通ることを確認してから入れる
