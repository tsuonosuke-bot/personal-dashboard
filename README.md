# knowledge-dashboard

Supabase のナレッジDBを自分専用で閲覧するダッシュボード
（Vite + React + TypeScript + Cloudflare Pages Functions）。

ブラウザはSupabaseへ直接接続しない。全リクエストをHTTP Basic認証またはCloudflare Accessで保護し、
認証後の `/api/*` だけがCloudflare Pages FunctionsからSupabaseを読み書きする。

```text
Browser --Basic認証 / Cloudflare Access--> Cloudflare Pages Functions --Secret key--> Supabase REST API
```

## セットアップ

```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars の必須項目を記入
npm run dev:pages
```

`npm run dev:pages` は本番ビルド後、Functionsを含めて
`http://localhost:8788` で起動する。単体の `npm run dev` はUI開発用で、
Viteだけを起動するため `/api/*` は利用できない。

`/?view=quiz` で任意条件の復習クイズ設定を、`/?view=quiz&mode=daily` で
当日の復習キューを直接開始できる。日次キューの15件は1日の上限ではなく1回の
出題数で、復習対象が残っている限り次のバッチを続けられる。Personal Hubの「今日の復習」は、
SSO引き継ぎ後に日次キューへ遷移する。

`/?view=speaking` は復習とは別の英会話練習。英語ナレッジから瞬間英作文と
3回音読を行い、元ナレッジ・練習種別・自己評価・回数を専用履歴へ記録する。
音声データは保存せず、習熟度や次回復習日も変更しない。

`.dev.vars` はGit管理外。実際のキーやパスワードをコミットしないこと。

## 実行時の環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Basic時 | 閲覧用パスワード（ASCIIのみ） |
| `DASHBOARD_USER` | 任意 | 閲覧用ユーザー名。既定は `admin` |
| `AUTH_MODE` | 任意 | `basic`（既定）または `access` |
| `TEAM_DOMAIN` | Access時 | `https://<team>.cloudflareaccess.com` |
| `POLICY_AUD` | Access時 | Access Application Audience tag |
| `HUB_SERVICE_TOKEN` | Hub連携時 | Hubからナレッジ一覧と日次キュー状態のGETだけを許可する共有secret |
| `SSO_SHARED_SECRET` | Hub連携時 | Hubからの署名付き認証引き継ぎを検証する共有secret |
| `QUIZ_SIGNING_SECRET` | クイズ時 | 出題内容を採点まで改ざん不能に保つ32文字以上の署名secret |
| `SESSION_TTL_DAYS` | 任意 | 引き継いだセッションの日数。既定30 |
| `SUPABASE_URL` | 必須 | SupabaseプロジェクトURL |
| `SUPABASE_SECRET_KEY` | 必須 | サーバー専用の `sb_secret_...` キー |
| `ANTHROPIC_API_KEY` | 必須 | 復習クイズの出題・採点で使うサーバー専用キー |

`SUPABASE_SECRET_KEY` はRLSを迂回できる強い権限を持つ。Cloudflareでは
暗号化されたSecretとして登録し、ブラウザ用の `VITE_` 変数、ソースコード、
ログには入れない。ダッシュボード専用キーを発行しておくと個別にローテーションできる。

## スクリプト

- `npm run dev` — UIのみのVite開発サーバー
- `npm run dev:pages` — ビルド後、Pages Functionsを含めたローカルサーバー
- `npm run build` — 型チェック + 本番ビルド
- `npm run preview` — ビルド結果のプレビュー（Functionsなし）
- `npm run typecheck` — 型チェックのみ
- `npm test` — API入力検証・書き込み防御の自動テスト

## API

取得列、並び順、ページ上限と編集可能項目はサーバー側で固定している。

- `GET /api/knowledge` — ナレッジ一覧。`status=active|archived|all`（既定 `active`）
- `POST /api/knowledge` — ナレッジを新規登録
- `PATCH /api/knowledge/:id` — 許可項目の編集、アーカイブまたは復元。本文は
  `{ expected_version, changes }` とし、読み込み後に別画面で更新されていれば409を返す
- `GET /api/quiz-log` — クイズ履歴を新しい順に取得
- `POST /api/quiz/start` — 復習クイズを出題（`{ categories, limit }`。`categories` は登録済み
  カテゴリ名の配列で、空配列なら全カテゴリ）。DBの `pick_quiz` で候補を選び、カテゴリ・タグ・前回のつまずきメモを添えてClaude APIで問題文を
  生成する。応答は `{ id, question, format, choices, token }` の配列で、正解（タイトル・説明）は
  返さない。四択の正解は平文で含めず、回答照合用のHMACだけを`token`へ保存する。`token` は
  ID・問題文・形式・選択肢をサーバー署名した2時間有効の値
- `POST /api/quiz/grade` — 回答 `[{ token, answer }]` を採点。クライアント申告のID・問題文・形式は
  信用せず、署名済みトークンとDBから正解を復元する。四択の正誤は出題時のHMACとサーバー側で
  照合し、Claudeのq値より優先する。採点後は `record_answers_batch_once` RPCが行ロック下で
  署名済み出題nonceの重複を判定し、未記録分だけを原子的に状態更新・履歴登録する

出題・採点は `claude-sonnet-5` を使う。問題文と講評の質が成果物そのものなので、
コスト目的で軽量モデルへ落とさない。

一覧APIは `limit`（1〜1,000、既定500）と `offset`（0以上、既定0）を受け付け、
`{ items, total, limit, offset }` を返す。画面は必要なページをすべて取得するため、
2,000件／5,000件を超えても累計値や履歴を黙って切り捨てない。

書き込みはBasic認証に加えて、同一オリジン、専用ヘッダー、JSON、25,000文字以下の本文を
必須とする。サーバー側で許可するのはタイトル、説明、出典メモ、カテゴリ、習熟度、優先度、タグ、
次回復習日、アーカイブ状態だけで、ID・作成日時・学習統計は変更できない。
更新には一覧取得時の `content_version` が必要で、競合時は上書きせず再読み込みを促す。
アーカイブ直後は画面上で取り消せるほか、「アーカイブ済み」一覧から復元できる。
DB接続設定がない場合は503、Supabase通信失敗は502を返す。

### ナレッジ優先度と復習間隔

各ナレッジには `最高` / `高` / `中` / `低` / `最低` の優先度を設定できる。
優先度は同じ期限に到来した問題の出題順だけを調整し、復習時刻や定着間隔は変えない。
再学習内では失敗度、優先度、弱さ、期限の順に選ぶ。15件中、通常の期限到来問題が
5件以上あれば再学習は最大10件とし、古い問題が再学習だけで押し出されるのを防ぐ。

q別の基準間隔は q0=10分、q1=30分、q2=6時間、q3=12時間、q4=1日以上、q5=3日以上。
q0〜q3は再学習へ入り、過去の定着間隔をそれぞれ40%・55%・70%・85%残す。この減衰と
習熟度の降格は1回の再学習エピソードにつき1回だけ行う。q0〜q2は四択の再認から始め、
正解後は一問一答の自由想起へ進む。四択正解はq4が上限で、習熟度の昇格には数えない。

通常の期限到来で自由記述にq4なら定着間隔を1.4倍、q5なら1.8倍へ伸ばす（最大365日）。
学習中から習得中は強い想起3回かつ3日以上、習得中から定着はさらに3回かつ30日以上が条件。
定着後も期限が来れば周期的に出題する。期限前のq4・q5は履歴には残すが、予定・定着間隔・
昇格実績を動かさない。

## 構成

```text
src/
  App.tsx                   画面全体の組み立てとフィルタ/ページ状態
  constants.ts             習熟度・優先度の色と並び順、配色、ページサイズ
  types.ts                 knowledge / quiz_log の型
  lib/api.ts               同一オリジンAPIクライアント、全ページ取得
  lib/apiValidation.ts     API応答の実行時検証
  lib/knowledge.ts         絞り込み・並び替え・復習分析
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度・優先度による絞り込み
    useModalDialog.ts       モーダルのフォーカス管理
  components/              統計、グラフ、編集、アーカイブ復元、一覧
functions/
  _middleware.ts            Basic / Access認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST APIのサーバー専用クライアント
  _shared/knowledgeValidation.ts 書き込み防御と入力検証
  _shared/quizSession.ts      出題内容の署名と採点時の検証
  api/knowledge.ts          ナレッジ一覧・新規登録API
  api/knowledge/[id].ts     ナレッジ編集・アーカイブ・復元API
  api/quiz-log.ts           クイズ履歴読み取りAPI
  api/quiz/start.ts         復習クイズの出題API
  api/quiz/grade.ts         復習クイズの採点・記録API
public/
  manifest.webmanifest      PWAマニフェスト（ホーム画面から起動可能にする）
  sw.js                     最小限のService Worker
supabase/
  disable-anon-access.sql   移行完了後にanon権限を外すSQL
  migrations/               本番DB関数の基準版と順序付き変更SQL
```

グラフは [recharts](https://recharts.org/)。復習クイズの出題・採点にはClaude APIを使う。

## デプロイ（Cloudflare Pages）

GitHub 連携でビルド・公開する。

| 項目 | 値 |
| --- | --- |
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node バージョン | `.node-version`（22） |

公開URL: https://knowledge-dashboard-27t.pages.dev

Cloudflare Pages の **Settings → Variables and Secrets** で、Production と Preview の
両方へ必要な環境変数を登録する。少なくとも `DASHBOARD_PASSWORD`、
`SUPABASE_SECRET_KEY`、`ANTHROPIC_API_KEY`、`QUIZ_SIGNING_SECRET` は必ずSecretとして保存し、
設定後に再デプロイする。`QUIZ_SIGNING_SECRET` は `SSO_SHARED_SECRET` と別のランダム値にする。

ブラウザからSupabaseへ直接接続しないため、`VITE_SUPABASE_URL` と
`VITE_SUPABASE_ANON_KEY` は設定しない。

### 閲覧制限

`functions/_middleware.ts` が静的アセットとAPIを含む全リクエストに
HTTP Basic認証をかける。`DASHBOARD_PASSWORD` が未設定だとサイト全体が503を返す
フェイルクローズ設計。認証後のレスポンスもキャッシュおよび検索エンジン登録を禁止する。
CSPは外部のスクリプトとスタイルを禁止し、rechartsに必要なstyle属性だけを許可する。

`AUTH_MODE=access` ではCloudflare Access JWTの署名・issuer・audienceを検証する。
Personal Hub、家計簿、ナレッジを同じAccess applicationで保護すると、1回のログインで3画面を移動できる。

Basic認証を継続する場合も、3サイトへ同じ `SSO_SHARED_SECRET` を設定すれば、Hubからの署名付き引き継ぎで対象ホストに固定したHttpOnlyセッションを作成できる。`HUB_SERVICE_TOKEN` は `GET /api/knowledge` と `GET /api/review/queue` のみに使え、POST/PATCHや他のAPIは認証を迂回できない。
引き継ぎトークンのnonceはSupabaseで1回だけ消費されるため、同じURLの再利用は403になる。

### DBマイグレーション

`supabase/migrations/` のSQLをファイル名順に適用してから、そのDB機能に依存するアプリを公開する。
`20260920080000_version_quiz_functions.sql` は従来本番だけに存在したクイズ関数の基準版、
`20260920090000_review_fixes.sql` は編集競合、同日二重記録、項目別の直近メモ、SSOリプレイを
修正する。`20260920100000_knowledge_priority.sql` は優先度列、標準間隔列、優先度による日付再計算と
出題順を追加する。`20260920120000_daily_review_queue.sql` はJST日付ごとの固定上限キューと、
優先度・期限超過日数・正答率による決定的な選定、回復配分のプレビュー／明示適用を追加する。
回復プレビューは読み取り専用で、画面上の確認操作までは既存の復習期限を変更しない。
`20260921100000_continuous_review_queue.sql` は固定日次上限を連続バッチへ置き換え、
時刻単位の期限、保持型の定着間隔、再認→想起、段階昇格、通常問題を5件残す配分、
署名済み出題トークン単位の重複記録防止を追加する。
`20260921120000_daily_review_category_counts.sql` は、今すぐ復習できる残数を全アクティブカテゴリ別に集計し、
日次キューの全体残数と同じスナップショットで返す。
適用後は新しい列・トリガー・関数定義と実行権限を確認する。

## 既存のブラウザ直接接続からの移行

現在公開中のバージョンを停止させないため、次の順番を守る。

1. Supabaseでダッシュボード専用Secret keyを発行する。
2. Cloudflare Previewへ必須3つの環境変数を設定してPreviewデプロイを確認する。
3. Productionへ同じ構成を設定し、このバージョンをデプロイする。
4. Basic認証後に実データが表示されることを確認する。
5. 最後に `supabase/disable-anon-access.sql` をSupabase SQL Editorで実行する。
6. 公開サイトを再確認し、旧anon/publishable keyで直接SELECTできないことを確認する。

SQLを先に実行すると、移行前の公開サイトがデータを取得できなくなる。
