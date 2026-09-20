# Personal Hub

家計簿、ナレッジ、Compass（Inbox / Wants）を束ねる個人用Hubです。ルートに全体サマリーを表示し、既存のCompass画面は `/compass/` で利用できます。

- Production: https://personal-dashboard-7md.pages.dev/

## セキュリティ構成

```text
Browser
  └─ Basic authentication または Cloudflare Access
      └─ Cloudflare Pages + Functions
          ├─ /api/dashboard
          ├─ /api/inbox (POST / PATCH)
          ├─ /api/wants (POST / PATCH)
          └─ SUPABASE_SECRET_KEY (Cloudflare environment only)
              └─ Supabase REST API
```

- 初期状態は静的ファイルとAPIを含む全リクエストをBasic認証で保護
- `AUTH_MODE=access` ではCloudflare Access JWTの署名・issuer・audienceを検証
- `DASHBOARD_PASSWORD` 未設定時は503でフェイルクローズ
- Supabase URLとsecret keyはPages Functionsだけが参照
- 新形式のSupabase secret keyはサーバーから `apikey` ヘッダーだけで送信
- ブラウザは同一オリジンの `/api/dashboard`、`/api/inbox`、`/api/wants` だけを呼び出す
- APIレスポンス、URL、Viteバンドルへsecret keyを含めない
- `Cache-Control: private, no-store`、CSP、`X-Frame-Options: DENY`、`X-Robots-Tag` を適用
- Inbox登録は同一オリジン・専用ヘッダー・入力文字数を検証し、`pending` として保存
- Inbox更新はIDと編集前の値を条件にし、別画面で更新済みの場合は409で拒否

## Hubの機能

- Compass、家計簿、ナレッジへの入口
- 今月支出、復習期限、未整理Inboxのスナップショット
- Knowledge Dashboardの復習開始画面へのショートカット
- 新しいActive Wantsを最大3件表示
- 直近5件の家計簿レコード
- 苦手を最大2件、復習期限、新規を混ぜたナレッジ候補
- 一部の接続先が失敗しても、取得できたセクションは表示を継続

## Compassの機能

- Inbox総数・未整理件数
- Active Wants
- Inbox / Wantsの切り替え
- Inboxの新規登録
- Inboxの本文・ステータス・整理結果を編集
- Wantsの本文・ステータスを編集
- InboxからWantを追加すると元のInboxを処理済み（処理結果: Wantsに登録）にする
- 検索、ステータス絞り込み、詳細ドロワー、再読込
- `/api/health` による接続状態確認
- Hub、Knowledge DB、Financialへのダッシュボードスイッチャー

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
| `DASHBOARD_PASSWORD` | Basic時 | Basic認証パスワード |
| `AUTH_MODE` | Optional | `basic`（既定）または `access` |
| `TEAM_DOMAIN` | Access時 | `https://<team>.cloudflareaccess.com` |
| `POLICY_AUD` | Access時 | Access Application Audience tag |
| `SUPABASE_URL` | Required | SupabaseプロジェクトURL |
| `SUPABASE_SECRET_KEY` | Required | Pages Functions専用のsecret key |
| `HUB_SERVICE_TOKEN` | Required | 家計簿・ナレッジの読取専用APIを呼ぶ共有secret |
| `SSO_SHARED_SECRET` | Recommended | Hubから各サイトへ認証を引き継ぐ共有secret（32文字以上） |
| `SESSION_TTL_DAYS` | Optional | 引き継いだセッションの日数。既定30、最大365 |
| `NAV_KNOWLEDGE_URL` | Optional | Knowledge DBダッシュボードURL |
| `NAV_FINANCIAL_URL` | Optional | FinancialダッシュボードURL |
| `NAV_TASK_BOARD_URL` | Optional | Task Board URL |

`SUPABASE_SECRET_KEY`、`HUB_SERVICE_TOKEN`、`SSO_SHARED_SECRET` はCloudflare側の暗号化されたSecretとして登録し、GitHubやフロントエンド環境変数（`VITE_*`）には登録しません。Hubは家計簿・ナレッジの各Pages Functionが公開する読取専用APIを呼ぶため、別プロジェクトのSupabaseキーを複製しません。

## 検証

```powershell
npm test
npm run check
npm run build
```

WindowsでNodeのテスト分離プロセスが制限される環境を考慮し、`--test-isolation=none` を使用しています。

## 1回の認証で3画面を使う

`AUTH_MODE=basic` のままでも、3サイトへ同じ `SSO_SHARED_SECRET` を設定すると、Hubでの認証成功時に30日間のHttpOnlyセッションを作り、詳細サイトへは60秒だけ有効な署名付き引き継ぎURLで移動します。URLは移動直後に除去され、署名は対象ホストに固定されます。

`AUTH_MODE=access` または `SSO_SHARED_SECRET` 未設定時は、各ダッシュボード自身の認証に委ねる安全な直接遷移へフォールバックします。

より標準化されたSSOへ移行する場合はCloudflare Accessも利用できます。3ホストを同じAccess applicationとAllow policyで保護し、各Pages環境の `AUTH_MODE=access`、`TEAM_DOMAIN`、`POLICY_AUD` を設定します。設定が欠けた場合は503、不正JWTは403でフェイルクローズします。
