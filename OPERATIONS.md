# 開発・運用の共通手順

アプリ共通の手順はこのファイルを正本とする。画面固有の仕様は
[Hubの規約](apps/hub/AGENTS.md)、[Knowledgeの仕様](apps/knowledge/CLAUDE.md)、
[Financeの仕様](apps/finance/README.md)を参照する。

## 新機能・修正

1. Issueの目的・完了条件と影響するアプリを確認する。未コミット変更や並行作業が
   あれば隔離する。Knowledgeの変更を含むブランチは `claude/*` とする。
2. データ契約と認証の共有部分は `packages/dashboard-auth` に集約する。
   DBスキーマ由来の型は `packages/database-types/database.types.ts` を参照する。
   正本のアプリは `apps/hub`・`apps/knowledge`・`apps/finance`。
3. 小さい単位で実装・関連テスト・独立レビューを往復する。認証・競合検出・
   再実行時の動作を保持する。型はJSONの実行時検証を置き換えない。
4. ルートで `npm ci`、`npm run lint`、`npm run typecheck`、`npm test`、
   `npm run theme:check`、`npm run build`、`npm run build:functions` を確認する。
   Functionsはフロントのビルドとは別に3アプリをバンドルする。
   UI変更はPC幅とスマートフォン幅で関連操作を確認する。
5. CSSはライト側だけ編集し、対象アプリの `npm run theme -w apps/<app>` で
   ダーク側を生成する。`*.dark.css` は直接編集しない。
   Hubのブラウザ型検査は `apps/hub/tsconfig.client.json` の対象を段階的に増やす。
6. `npm run format` / `npm run format:check` は共通Prettier設定を使う。
   既存ソースには書式差分が残るためフォーマット全件合格は現在のCI条件ではない。
   修正ファイルだけなら `npm exec prettier -- --write <file>` を使い、生成物と既存SQLの不要な整形は避ける。
7. push・PR・merge・本番適用・Issueクローズは依頼で認められた範囲を守る。
   ローカル検証、CI、Preview、本番の通常URL/API確認は別々に記録する。
   共通パッケージ変更時は3アプリのPages反映も個別に確認する。

## マイグレーション

SQLの正本は `apps/<app>/supabase/migrations/`。
[履歴と命名規則](docs/migrations.md)に従い、新しいファイルは
`YYYYMMDDHHmmss_description.sql`（UTC、14桁）とする。
既存の12桁版と取り込み済みの旧SQLは履歴を保つ例外として台帳に固定し、
名前を変更して未適用扱いに戻さない。

1. 適用先を確認し、[バックアップ](docs/supabase-backup.md)と復旧方針を準備する。
2. DBの `supabase_migrations.schema_migrations` と実際の列・関数・権限を照合する。
   `dashboard_schema_versions` はアプリの最新状態表示用で、全適用履歴ではない。
3. 適切なテストDBでSQL・RLS・RPC・再実行・既存データ維持を確認し、レビューする。
4. 承認された変更だけ適用する。SQL Editorでは古いSQLを消し、レビュー済み全文を
   入力して読み戻し一致を確認する。失敗時は原因と適用状況を確認してから再実行する。
5. 列・制約・関数定義・権限を確認し、履歴へ実際のversion/nameを記録する。
   旧SQLの移動だけではDB実行や履歴の書換えは行わない。
6. [DB型の再生成](packages/database-types/README.md)を行い、差分をレビューして型検査する。
   `npm run db:types:check` は認証済み環境でライブ型とのズレを検出する。
   通常CIは保存済み型との整合だけを検査し、DBへ接続しない。
7. 依存するアプリを反映し、通常URL、関連API、対象外データの維持を確認する。

## 環境変数

値はここに記載しない。ローカルはアプリの `.dev.vars.example` を
`.dev.vars` へコピーして設定する。CloudflareではProduction/Preview双方を確認し、
値を変更したら対象アプリを再デプロイする。機密情報はSecretとして設定し、
`VITE_` 変数・ブラウザ・ログ・コミットへ出さない。

| 名前                                                             | アプリ/用途                        | 必要な場合                   |
| ---------------------------------------------------------------- | ---------------------------------- | ---------------------------- |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD`                          | 全アプリ、Basic認証                | Basic使用時                  |
| `AUTH_MODE`                                                      | 全アプリ、認証方式                 | 任意                         |
| `TEAM_DOMAIN` / `POLICY_AUD`                                     | 全アプリ、Cloudflare Access        | Access使用時                 |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY`                           | 全アプリ、サーバーDB接続           | 必須                         |
| `HUB_SERVICE_TOKEN`                                              | 全アプリ、Hubの限定読取            | アプリ間連携時               |
| `SSO_SHARED_SECRET` / `SESSION_TTL_DAYS`                         | 全アプリ、SSO引継ぎ/セッション     | SSO使用時                    |
| `ANTHROPIC_API_KEY`                                              | Hub・Knowledge、AI処理             | AI機能使用時                 |
| `ANTHROPIC_MODEL` / `ANTHROPIC_WORKSPACE_ID`                     | Hub、モデル/ワークスペース選択     | 任意                         |
| `REVIEW_BATCH_TOKEN`                                             | Knowledge、定期生成/採点呼出し     | 定期実行時、Vaultと一致      |
| `VOYAGE_API_KEY`                                                 | Knowledge、意味検索/embedding      | 意味検索使用時               |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`          | Hub、Google連携                    | Calendar使用時               |
| `GOOGLE_TOKEN_ENCRYPTION_KEY`                                    | Hub、トークン暗号化                | Calendar使用時               |
| `NAV_KNOWLEDGE_URL` / `NAV_FINANCIAL_URL` / `NAV_TASK_BOARD_URL` | Hub、画面遷移先                    | 必要に応じて                 |
| `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN`                 | 開発/信頼済みCI、型生成            | 型生成時、アプリへ配置しない |
| `SUPABASE_DB_URL` / `BACKUP_PASSPHRASE`                          | GitHub Actions、暗号化バックアップ | バックアップ時               |

正確な必須条件・既定値・共有secretの範囲は各アプリの仕様と
`.dev.vars.example` を参照する。バックアップの設定・復元は
[Supabaseバックアップ](docs/supabase-backup.md)へ。
