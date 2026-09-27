# Personal Hub

Finance、Knowledge、Idea（Inbox / Wants / ToDo）、Writing、Habits、Journalの振り返りを束ねる個人用Hubです。ルートに全体サマリーを表示し、Ideaは `/compass/`、Writingは `/writing/`、Habitsは `/habits/` で利用できます。

- Production: https://personal-dashboard-7md.pages.dev/

## セキュリティ構成

```text
Browser
  └─ Basic authentication または Cloudflare Access
      └─ Cloudflare Pages + Functions
          ├─ /api/dashboard
          ├─ /api/inbox (POST / PATCH)
          ├─ /api/wants (POST / PATCH)
          ├─ /api/want-routes (POST / PATCH)
          ├─ /api/scheduled-actions (GET / PATCH)
          ├─ /api/focus (GET / PATCH)
          ├─ /api/writing (GET / PATCH)
          ├─ /api/want-suggestions (POST)
          ├─ /api/google-calendar-* (OAuth / status)
          ├─ /api/habits (GET / POST / PATCH)
          ├─ /api/habit-logs (PATCH)
          ├─ /api/connection-status (GET)
          ├─ /api/export/snapshot (GET)
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

- Idea、Writing、Habits、Finance、Knowledgeへの入口
- 上部の「＋」からInbox追加、家計簿記録、Project作成、今日の復習へ直接移動
- Knowledge JSON、Finance CSV、個人データを束ねた全体スナップショットの読み取り専用書き出し
- Personal／Knowledge／Financeの認証方式・接続先・DB migration・最終成功時刻をまとめる接続状態画面
- HTMLや壊れたJSONなど想定外のAPI応答を、内部解析エラーではなく再試行可能な案内へ変換
- 今日の復習進捗と開始導線、期限超過、未整理Wantsのスナップショット
- Knowledge Dashboardの当日固定キューを直接開始するショートカット
- 未整理のActive Wantsの件数と最古の滞留日数を表示
- 未整理のActive Wantsを古い順で最大3件表示
- 未整理件数と一覧からIdeaの絞り込み表示へ直接移動
- Wantから選んだFocusを最大5件、指定順で固定表示
- Focusの言葉・補足の編集、表示解除／再表示、並び替え、満杯時の入れ替え（満杯中に追加したFocusは表示解除中に入る）
- 直近5件の家計簿レコード
- 苦手を最大2件、今日の復習残件、期限超過、新規を組み合わせたナレッジ候補
- 1か月前・半年前・1年前の各基準日以前で最も近い `daily_journal` を表示
- Journalの要約・感情・気分・タグとNotion原文リンクを読み取り専用で表示
- 直近90日の `daily_journal.mood`（−2〜＋2）を気分のバロメーターとして表示。未記録日は空白にし、日付ごとの記録を一覧でも確認可能
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

- IdeaでWantを「掘り下げる → Writing」に振り分けるとテーマを作成
- アイデア・完了、の2状態だけを管理
- 本文と構成はPomeraを正本とし、Dashboardではタイトルと短い論点だけを編集
- 完了したテーマはアイデアの一覧から外し、Writingとしての役目を終了
- 元Wantへのリンクを常に保持し、Writingの直リンクでも編集画面を復元
- `updated_at` を使って別画面からの上書きを409で防止

## Ideaの機能

- Inbox総数・未整理件数
- 未整理のActive Wants
- Inbox / Wants / ToDoの切り替え
- Inboxの新規登録
- Inboxの本文・ステータス・整理結果を編集
- Wantsの本文・ステータスを編集
- 未整理Inboxをカレンダー・Writing・Habits・Focus・Knowledge・寝かせるのクイック操作から直接整理
- 未整理Inboxまたは再訪で浮上したWantを1件ずつ「行動する・継続する・掘り下げる・残す・見送る」で整理
- 「AIに整理案を聞く」を押した時だけ、分類・登録先・下書きの提案を取得
- AIから確認質問がある場合は、回答後に明示的に再提案を依頼
- 振り分け内容をプレビューし、確定後に `want_routes` へ履歴を保存
- Writing・Habits・Focus・アーカイブはPersonal Dashboard内へ登録
- Google Calendarは接続状態と日時を確認し、明示的な「Google Calendarに登録」でメインカレンダーへ作成
- Calendar登録に成功した予定はToDoへ自動追加し、既存のCalendar振り分けも初回migrationで取り込む
- ToDoは未実施・完了・見送りを管理し、完了・見送りではGoogle Calendar予定を変更しない
- 過去日時の未実施ToDoを「実施確認待ち」として優先表示し、今日・今後でも絞り込み
- 「日程を決め直す」は同じGoogle Calendar予定をETag付きで更新し、別画面で変更済みなら上書きを拒否
- ToDo表示時はGoogle Calendarの現在日時・取消・削除を再確認し、予定時刻だけで自動完了しない
- Calendar予定が削除・取消済みなら、同じToDoから新しい予定を重複安全に再作成して再接続
- 完了・見送り済みToDoは未実施へ戻せる
- GitHub・Knowledge DB・Journalは未送信の計画として保存（接続は別途合意後）
- 振り分けの登録または計画保存に成功すると、元Wantを自動的に `completed` へ更新
- 振り分け先への登録に失敗した場合は元Wantを `active` のまま残し、同じ処理IDで安全に再試行
- Inboxから振り分けた場合は履歴用のWantを1件作成して `want_routes` へ紐付け、元のInboxを処理済み（処理結果: 振り分け先名）にする
- 「寝かせる」はWantsへ `revisit_on`（既定1ヶ月後・必須）付きで登録し、元のInboxを処理済み（処理結果: 寝かせる（再訪 日付））にする
- Inbox由来のWantは `source_inbox_id` で元のInboxと結び付け、一覧カードに振り分け先・再訪日を表示
- Knowledge・GitHub・Journalは計画保存のままのため「登録待ち」として区別し、「Knowledge登録待ち」で絞り込み（`?filter=knowledge`）
- ナレッジDBへ画面外（LLMとの会話など）で登録した候補は、Wantの振り分け履歴から「Knowledge登録済みにする」で登録待ちを解除（Knowledge IDを入力すると正本へのリンクも残る）
- GitHub Issueを画面外で作成した候補は、同じく「GitHub登録済みにする」で登録待ちを解除（Issue URLを入力すると正本へのリンクも残る）
- 検索、ステータス絞り込み、詳細ドロワー、再読込
- `/compass/?view=wants&filter=untriaged` で未整理のActive Wantsへ直接移動（既存URLとの互換名）
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

Focus管理を有効にする場合は `supabase/migrations/202609200004_focus_board.sql` も適用します。Active FocusはDBトリガーで5件までに制限し、並び替えは現在の順序を確認してから1トランザクションで更新します。満杯時の追加と入れ替えには `supabase/migrations/202609240001_focus_overflow_and_swap.sql` を適用します。（`202609240002` で作った `focus_knowledge_links` は `202609240003` で廃止しました。ナレッジごとの示唆はknowledge-dashboard側で管理します）

整理済みWantの自動完了を有効にする場合は、`supabase/migrations/202609200005_auto_complete_routed_wants.sql` まで適用します。既存の `planned` / `created` 振り分けがあるActive Wantを一度だけ `completed` に整合し、以後は成功した振り分けから同じ状態遷移を保証します。

Writingを2状態へ簡素化する場合は、続けて `supabase/migrations/202609220002_writing_two_statuses.sql` を適用します。既存の `completed` / `archived` は「完了」に、それ以外のWriting状態は「アイデア」に統合します。

Projectsを有効にする場合は、アプリのデプロイより先に `supabase/migrations/202609220003_projects_mvp.sql` を適用します。Inbox／Wantの正本は元テーブルに残し、`project_items`で1つのProjectへ関連づけます。Projectへの関連づけと元アイテムの整理済み化は同一トランザクションで行い、Projectごとの現在のNext Actionは最大1件に制限します。適用後は、別クエリとして `supabase/verification/202609220003_projects_mvp_verify.sql` を実行してオブジェクトと不変条件を確認してください。

Calendar予定の実施管理を有効にする場合は、`supabase/migrations/202609220004_scheduled_actions.sql` を適用します。既存の成功済みCalendar振り分けを `scheduled_actions` へ一度だけ移行し、以後はDBトリガーでToDoを自動作成します。

共通の接続状態画面を有効にする場合は、公開より先に `supabase/migrations/202609220005_connection_status.sql` を適用します。接続状態の確認用テーブルだけを作成し、ユーザーデータは変更しません。

- `writing_topics`: 掘り下げたいエッセイ候補
- `habits` / `habit_logs`: 習慣の定義と実施記録
- `focus_items`: 継続して意識したい言葉
- `want_routes`: 上記および外部正本への振り分け履歴
- `scheduled_actions`: Calendar化した予定の実施状態
- `scheduled_action_schedule_history`: Dashboardから実行した日程変更の履歴

Google Calendarだけ外部正本への登録処理を実装しています。GitHub・Knowledge DB・Journalの `planned` は「送信済み」を意味しませんが、振り分け方針は確定済みのため元Wantは完了します。元Wantとの競合検知と処理IDによる二重登録防止を行い、登録に失敗した場合だけ元WantをActiveのまま残します。振り分け成功後にWantの完了更新だけが失敗した場合も、同じ処理IDの再試行では正本を重複作成せず完了処理だけを再開します。

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

要求するGoogle scopeは予定の読取・作成・更新に限定した `https://www.googleapis.com/auth/calendar.events` です。予定は `primary` カレンダーへ `Asia/Tokyo` で作成し、作成直後に再取得してIDとリンクを確認します。日時はGoogle Calendarを正本とし、ToDo表示時に現在値を再取得します。Dashboardの「日程を決め直す」も同じGoogle予定を更新し、新しい予定は重複作成しません。

## 検証

```powershell
npm test
npm run check
npm run build
# 上記3つをまとめて実行
npm run predeploy:check
```

WindowsでNodeのテスト分離プロセスが制限される環境を考慮し、`--test-isolation=none` を使用しています。

## 1回の認証で3画面を使う

`AUTH_MODE=basic` のままでも、3サイトへ同じ `SSO_SHARED_SECRET` を設定すると、Hubでの認証成功時に30日間のHttpOnlyセッションを作ります。Finance と Knowledge は `/finance/`、`/knowledge/` から同一オリジンで中継し、中継サーバーが60秒だけ有効なホスト固定の署名を使って各サイトへ接続します。認証Cookieはブラウザへ転送しません。

`SSO_SHARED_SECRET` 未設定時は、中継先が受け付ける認証ヘッダーをそのまま利用します。3サイトで同じ `SSO_SHARED_SECRET` を設定する構成を推奨します。

## iOSホーム画面アプリ

Hubは `display: standalone`、`scope: /` のWeb App Manifestを配信します。iOSの「ホーム画面に追加」はPersonal Hubのトップページで行ってください。FinanceとKnowledgeへの導線はHubと同じオリジン配下にあるため、ホーム画面アプリ内でURLバーを表示せずに切り替わります。変更前に追加したアイコンで古い範囲が残る場合は、ホーム画面のアイコンを一度削除して追加し直します。

アイコンはiOS・Android・ブラウザとも黄色地（`#f3c218`）に緑（`#245949`）のPで揃えています。iOSは `apple-touch-icon` にSVGを使えないため、`public/static/apple-touch-icon.svg` を原本に180×180のPNG `/apple-touch-icon.png` を書き出して配信します。Android・デスクトップのインストールとブラウザのタブはmanifestの `/icon.svg`（`any`）と `/icon-maskable.svg`（`maskable`、円形マスクの内側にPが収まる配置）を使います。iOSとAndroidはアイコンを端末側にキャッシュするため、色を変えた後は一度ホーム画面から削除して追加し直します。

より標準化されたSSOへ移行する場合はCloudflare Accessも利用できます。3ホストを同じAccess applicationとAllow policyで保護し、各Pages環境の `AUTH_MODE=access`、`TEAM_DOMAIN`、`POLICY_AUD` を設定します。設定が欠けた場合は503、不正JWTは403でフェイルクローズします。
