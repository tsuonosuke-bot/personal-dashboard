# Personal Dashboard — Compass

Supabaseの `idea_inbox`、`wants`、`next_actions` を1画面で確認する個人用Webダッシュボードです。Knowledge DBダッシュボードと同じく、Cloudflare Pages FunctionsをBasic認証とSupabase RESTの境界として使用します。

- Production: Cloudflare Git integration setup in progress

## セキュリティ構成

```text
Browser
  └─ Basic authentication
      └─ Cloudflare Pages + Functions
          ├─ /api/dashboard
          └─ SUPABASE_SECRET_KEY (Cloudflare environment only)
              └─ Supabase REST API
```

- 静的ファイルとAPIを含む全リクエストをBasic認証で保護
- `DASHBOARD_PASSWORD` 未設定時は503でフェイルクローズ
- Supabase URLとsecret keyはPages Functionsだけが参照
- 新形式のSupabase secret keyはサーバーから `apikey` ヘッダーだけで送信
- ブラウザは同一オリジンの `/api/dashboard` だけを呼び出す
- APIレスポンス、URL、Viteバンドルへsecret keyを含めない
- `Cache-Control: private, no-store`、CSP、`X-Frame-Options: DENY`、`X-Robots-Tag` を適用
- 初版は読み取り専用で、Supabase変更APIを持たない

## 機能

- Inbox総数・未整理件数
- Active Wants
- 次のアクションがないWants
- Open Actions
- Inbox / Wants / Next Actionsの切り替え
- 検索、ステータス絞り込み、詳細ドロワー、再読込
- `/api/health` による接続状態確認
- Knowledge DB、Financial、Task Boardへの将来の画面遷移を考慮したダッシュボードスイッチャー

画面遷移先は環境変数で変更できるため、各ダッシュボードを再ビルドせずにURLを差し替えられます。

## ローカル確認

1. `.dev.vars.example` を `.dev.vars` にコピーします。
2. ローカル用の値を設定します。
3. 次を実行します。

```powershell
npm install
npm run dev:pages
```

- URL: `http://127.0.0.1:4183`
- Basic認証は `.dev.vars` の `DASHBOARD_USER` / `DASHBOARD_PASSWORD`
- ローカル変数ファイルはGit管理対象外

## Cloudflare Pages設定

Build settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

PreviewとProductionの両方に、次の環境変数を設定します。

| Variable | Required | Purpose |
| --- | --- | --- |
| `DASHBOARD_USER` | Optional | Basic認証ユーザー。既定値は `admin` |
| `DASHBOARD_PASSWORD` | Required | Basic認証パスワード |
| `SUPABASE_URL` | Required | SupabaseプロジェクトURL |
| `SUPABASE_SECRET_KEY` | Required | Pages Functions専用のsecret key |
| `NAV_KNOWLEDGE_URL` | Optional | Knowledge DBダッシュボードURL |
| `NAV_FINANCIAL_URL` | Optional | FinancialダッシュボードURL |
| `NAV_TASK_BOARD_URL` | Optional | Task Board URL |

`SUPABASE_SECRET_KEY` はCloudflare側の暗号化されたSecretとして登録し、GitHubやフロントエンド環境変数（`VITE_*`）には登録しません。

## 検証

```powershell
npm test
npm run check
npm run build
```

WindowsでNodeのテスト分離プロセスが制限される環境を考慮し、`--test-isolation=none` を使用しています。

## 将来の統合方針

ダッシュボードスイッチャーの共通化を想定しています。各サイトが別ドメインのままでも遷移できますが、Basic認証セッションはオリジンごとに独立します。将来的に1回の認証で3画面を移動したい場合は、共通カスタムドメイン配下への統合またはCloudflare Accessへの移行を検討します。
