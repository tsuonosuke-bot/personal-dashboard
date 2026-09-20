# Personal Hub

家計簿、ナレッジ、Compass（Inbox / Wants）、Writing、Habits、Journalの振り返りを束ねる個人用Hubです。ルートに全体サマリーを表示し、Compassは `/compass/`、Writingは `/writing/`、Habitsは `/habits/` で利用できます。

- Production: https://personal-dashboard-7md.pages.dev/

## セキュリティ構成

```text
Browser
  └─ Basic authentication または Cloudflare Access
      └─ Cloudflare Pages + Functions
          ├─ /api/dashboard
          ├─ /api/inbox (POST / PATCH)
          ├─ /api/wants (POST / PATCH)
          ├─ /api/want-routes (POST)
          ├─ /api/focus (GET / PATCH)
          ├─ /api/writing (GET / PATCH)
          ├─ /api/want-suggestions (POST)
          ├─ /api/google-calendar-* (OAuth / status)
          ├─ /api/habits (GET / POST / PATCH)
          ├─ /api/habit-logs (PATCH)
          ├─ SUPABASE_SECRET_KEY (Cloudflare environment only)
          │   └─ Supabase REST API
          ├─ ANTHROPIC_API_KEY (Cloudflare environment only)
          │   └─ Claude Messages API
          └─ GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_TOKEN_ENCRYPTION_KEY
              └─ Google OAuth + Calendar API
```

- 初期状態は静的ファイルとAPIを含む全リクエストをBasic認証で保護
- Google OAuthの説明・プライバシー・利用条件ページだけは、Googleの外部向け本番アプリ要件を満たすため読取専用で公開
- `AUTH_MODE=access` ではCloudflare Access JWTの署名・issuer・audienceを検証
- `DASHBOARD_PASSWORD` 未設定時は503でフェイルクローズ
- Supabase URLとsecret keyはPages Functionsだけが参照
- 新形式のSupabase secret keyはサーバーから `apikey` ヘッダーだけで送信
- ブラウザは同一オリジンのPersonal Dashboard APIだけを呼び出す
- APIレスポンス、URL、Viteバンドルへsecret keyを含めない
- `Cache-Control: private, no-store`、CSP、`X-Frame-Options: DENY`、`X-Robots-Tag` を適用
- Inbox登録は同一オリジン・専用ヘッダー・入力文字数を検証し、`pending` として保存
- Inbox更新はIDと編集前の値を条件にし、別画面で更新済みの場合は409で拒否
- AI整理はユーザーがボタンを押した時だけ実行し、送信直前にWantが未変更かを再確認
- AIには外部サービスを操作するツールを渡さず、構造化された提案だけを受け取る

## Hubの機能

- Compass、Writing、Habits、家計簿、ナレッジへの入口
- 今日の復習進捗と開始導線、期限超過、未振り分けWantsのスナップショット
- Knowledge Dashboardの当日固定キューを直接開始するショートカット
- 未振り分けActive Wantsの件数と最古の滞留日数を表示
- 未振り分けを古い順で最大3件表示し、0件の時だけ振り分け済みActive Wantsへ切り替え
- 未振り分け件数と一覧からCompassの絞り込み表示へ直接移動
- Wantから選んだFocusを最大5件、指定順で固定表示
- Focusの言葉・補足の編集、表示解除／再表示、並び替え
- 直近5件の家計簿レコード
- 苦手を最大2件、今日の復習残件、期限超過、新規を組み合わせたナレッジ候補
- 1か月前・半年前・1年前の各基準日以前で最も近い `daily_journal` を表示
- Journalの要約・感情・気分・タグとNotion原文リンクを読み取り専用で表示
- 一部の接続先が失敗しても、取得できたセクションは表示を継続

## Habitsの機能

- Habit画面からの直接登録と、Wantから振り分けたHabitの一元表示
- 毎日・平日・毎週・頻度を固定しない、の4種類
- 毎週は月曜から日曜の間に1回で達成。曜日は固定しない
- 今日の実施記録を1タップで追加・取消
- 今日、今週、直近7日間の実施状況を表示
- 有効・休止・アーカイブの切り替え。休止後も過去の履歴を保持
- `updated_at` を使った編集競合の検知と、同日・同週の重複記録防止
- 未実施を罰則や連続日数として扱わず、自由頻度は残件数から除外

## Writingの機能

- CompassでWantを「掘り下げる → Writing」に振り分けるとテーマを作成
- アイデア・Pomeraで執筆中・書き上げ、の3状態だけを管理
- 本文と構成はPomeraを正本とし、Dashboardではタイトルと短い論点だけを編集
- 書き上げたテーマは進行中の一覧から外し、Writingとしての役目を終了
- 元Wantへのリンクを常に保持し、Writingの直リンクでも編集画面を復元
- `updated_at` を使って別画面からの上書きを409で防止

## Compassの機能

- Inbox総数・未整理件数
- Active Wants
- Inbox / Wantsの切り替え
- Inboxの新規登録
- Inboxの本文・ステータス・整理結果を編集
- Wantsの本文・ステータスを編集
- 未振り分けWantを1件ずつ「行動する・継続する・掘り下げる・残す・見送る」で整理
- 「AIに整理案を聞く」を押した時だけ、分類・登録先・下書きの提案を取得
- AIから確認質問がある場合は、回答後に明示的に再提案を依頼
- 振り分け内容をプレビューし、確定後に `want_routes` へ履歴を保存
- Writing・Habits・Focus・アーカイブはPersonal Dashboard内へ登録
- Google Calendarは接続状態と日時を確認し、明示的な「Google Calendarに登録」でメインカレンダーへ作成
- GitHub・Knowledge DB・Journalは未送信の計画として保存（接続は別途合意後）
- 一つのWantから複数の振り分けを作成可能。振り分け成功後も元Wantは自動完了しない
- InboxからWantを追加すると元のInboxを処理済み（処理結果: Wantsに登録）にする
- 検索、ステータス絞り込み、詳細ドロワー、再読込
- `/compass/?view=wants&filter=untriaged` で未振り分けActive Wantsへ直接移動
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

## Wantsの振り分け基盤

初回導入時は、アプリのデプロイより先に `supabase/migrations/202609200001_want_triage.sql` を対象のSupabaseへ適用します。既存の `wants` を着想の正本として残し、振り分け結果だけを `want_routes` に追加します。

Google Calendar連携を有効にする場合は、続けて `supabase/migrations/202609200002_google_calendar.sql` を適用します。更新トークンはPages FunctionでAES-GCM暗号化してから `integration_connections` に保存し、ブラウザ・Claude・APIレスポンスには返しません。

Habit MVPを有効にする場合は、続けて `supabase/migrations/202609200003_habits_mvp.sql` を適用します。これにより直接登録、開始日、日次・週次の冪等な記録キーが追加されます。

Focus管理を有効にする場合は `supabase/migrations/202609200004_focus_board.sql` も適用します。Active FocusはDBトリガーで5件までに制限し、並び替えは現在の順序を確認してから1トランザクションで更新します。

- `writing_topics`: 掘り下げたいエッセイ候補
- `habits` / `habit_logs`: 習慣の定義と実施記録
- `focus_items`: 継続して意識したい言葉
- `want_routes`: 上記および外部正本への振り分け履歴

Google Calendarだけ外部正本への登録処理を実装しています。GitHub・Knowledge DB・Journalの `planned` は「送信済み」を意味しません。元Wantとの競合検知と処理IDによる二重登録防止を行い、登録に失敗しても元Wantの状態は変更しません。

Focusの新規登録はCompassでWantを「残す → Focus」に明示確定した時だけ行います。HubではActive Focusを最大5件表示し、管理画面から編集、表示解除／再表示、並び替えができます。表示解除しても元Wantと振り分け履歴は残ります。

AI整理も提案専用です。Want登録時・画面表示時・定期処理では呼び出さず、「AIに整理案を聞く」または確認回答後の「回答をもとに再提案」を押した時だけClaude APIへ送信します。提案は自動保存されず、既存の編集・プレビュー・確定を経て初めて `want_routes` に保存されます。

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
| `ANTHROPIC_API_KEY` | AI整理時 | Pages Functions専用のAnthropic API key |
| `ANTHROPIC_MODEL` | Optional | Claudeモデル名。既定は `claude-sonnet-5` |
| `ANTHROPIC_WORKSPACE_ID` | 条件付き | 複数workspaceに属するAPI keyで利用するworkspace ID |
| `GOOGLE_OAUTH_CLIENT_ID` | Calendar連携時 | Google OAuth Web client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Calendar連携時 | Google OAuth Web client secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Calendar連携時 | 更新トークン暗号化用の32-byte base64url鍵 |
| `HUB_SERVICE_TOKEN` | Required | 家計簿・ナレッジの読取専用APIを呼ぶ共有secret |
| `SSO_SHARED_SECRET` | Recommended | Hubから各サイトへ認証を引き継ぐ共有secret（32文字以上） |
| `SESSION_TTL_DAYS` | Optional | 引き継いだセッションの日数。既定30、最大365 |
| `NAV_KNOWLEDGE_URL` | Optional | Knowledge DBダッシュボードURL |
| `NAV_FINANCIAL_URL` | Optional | FinancialダッシュボードURL |
| `NAV_TASK_BOARD_URL` | Optional | Task Board URL |

`SUPABASE_SECRET_KEY`、`ANTHROPIC_API_KEY`、`GOOGLE_OAUTH_CLIENT_SECRET`、`GOOGLE_TOKEN_ENCRYPTION_KEY`、`HUB_SERVICE_TOKEN`、`SSO_SHARED_SECRET` はCloudflare側の暗号化されたSecretとして登録し、GitHubやフロントエンド環境変数（`VITE_*`）には登録しません。`ANTHROPIC_MODEL`、`GOOGLE_OAUTH_CLIENT_ID`、必要な場合の `ANTHROPIC_WORKSPACE_ID` は通常のサーバー環境変数として設定できます。Hubは家計簿・ナレッジの各Pages Functionが公開する読取専用APIを呼ぶため、別プロジェクトのSupabaseキーを複製しません。

## Google Calendar接続

1. Google CloudでCalendar APIを有効にし、OAuth同意画面を設定します。
2. 種類「ウェブ アプリケーション」のOAuth clientを作成します。
3. 承認済みリダイレクトURIへ次を追加します。
   - Production: `https://personal-dashboard-7md.pages.dev/api/google-calendar-callback`
   - Preview: `https://want-triage-preview.personal-dashboard-7md.pages.dev/api/google-calendar-callback`
4. Preview / Productionそれぞれへ上記3つのGoogle環境変数を設定し、再デプロイします。
5. CompassでCalendarの振り分けを開き、「Google Calendarを接続」から一度だけ同意します。

外部向けOAuthアプリを「本番」にする場合、次の静的ページだけを認証なしで公開します。Dashboard、API、OAuth開始・callbackは従来どおり認証で保護されます。

- アプリ説明: `https://personal-dashboard-7md.pages.dev/oauth/`
- プライバシーポリシー: `https://personal-dashboard-7md.pages.dev/oauth/privacy/`
- 利用条件: `https://personal-dashboard-7md.pages.dev/oauth/terms/`

要求するGoogle scopeは予定の読取・作成・更新に限定した `https://www.googleapis.com/auth/calendar.events` です。予定は `primary` カレンダーへ `Asia/Tokyo` で作成し、作成直後に再取得してIDとリンクを確認します。日時変更・削除はGoogle Calendarを正本とし、初版ではDashboardからの更新同期は行いません。

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
