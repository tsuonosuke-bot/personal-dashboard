# knowledge-dashboard

Supabase のナレッジDBを自分専用で管理するダッシュボード
（Vite + React + TypeScript + Cloudflare Pages Functions）。
ナレッジの追加・編集・アーカイブ、問題キューによる復習、学習ログ、問い・示唆・タグの整理、
復習とは独立した英会話練習を扱う。

ブラウザはSupabaseへ直接接続しない。全リクエストをHTTP Basic認証またはCloudflare Accessで保護し、
認証後の `/api/*` だけがCloudflare Pages FunctionsからSupabaseを読み書きする。

```text
Browser --Basic認証 / Cloudflare Access--> Cloudflare Pages Functions --Secret key--> Supabase REST API
```

設計上の決まりごと（DBスキーマ、出題・採点の品質、画面の約束）は [`CLAUDE.md`](CLAUDE.md) が正本。
このREADMEは使い方と全体像だけを書く。

## セットアップ

モノレポのルートで `npm install` を1回実行してから、このディレクトリで作業する。

```bash
cp .dev.vars.example .dev.vars
# .dev.vars の必須項目を記入
npm run dev:pages
```

`npm run dev:pages` は本番ビルド後、Functionsを含めて
`http://localhost:8788` で起動する。単体の `npm run dev` はUI開発用で、
Viteだけを起動するため `/api/*` は利用できない。

`.dev.vars` はGit管理外。実際のキーやパスワードをコミットしないこと。

## 画面

| URL | 内容 |
| --- | --- |
| `/` | 今日の復習キュー、統計・グラフ、ナレッジ一覧 |
| `/?view=quiz` | 復習。問題キューの上から30問ずつ受け取って解き続け、いつでも終えられる。回答直後に答え合わせを出す |
| `/?view=quiz&mode=daily` | 上と同じ画面を、開始ボタンを押さずに始める。Personal Hubの「今日の復習」はSSO引き継ぎ後にここを開く |
| `/?view=log` | 学習ログ。採点待ちの回答、問題を作れなかったカード、AIの採点と講評、英会話練習の履歴 |
| `/?view=organize` | 問い・示唆・タグの整理（`tab=questions`・`insights`・`tags`） |
| `/?view=speaking` | 英会話練習。英語ナレッジからAIが瞬間英作文と短いビジネス英文を作り、3回音読と自己評価を専用履歴へ記録する。音声は保存せず、習熟度や次回復習日も変えない |
| `/?knowledge=<id>` | ナレッジの詳細 |

## 復習の流れ

1. 生成バッチ（pg_cronで30分ごと）が、期限が来た（または30分以内に来る）カードの問題をClaude APIで作り、
   問題キュー（`review_queue`）へ入れる。条件を満たさない問題はその場で1回だけ作り直し、それでもだめなカードは
   2時間・6時間・24時間と時間を置いて再挑戦する（学習ログの「問題を作れなかったカード」に出る）
2. 復習画面はAIを呼ばずにキューから出題する。四択と無回答はその場で記録し、それ以外は採点待ちにする
3. 採点バッチ（1時間ごと）がAIで採点し、DB関数が次回の復習時刻を決める。結果と講評は学習ログで見る

チャットの knowledge-quiz スキル（`skills/knowledge-quiz/`）も同じキューから出題し、採点結果を同じ履歴へ残す。

## 実行時の環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Basic時 | 閲覧用パスワード（ASCIIのみ） |
| `DASHBOARD_USER` | 任意 | 閲覧用ユーザー名。既定は `admin` |
| `AUTH_MODE` | 任意 | `basic`（既定）または `access` |
| `TEAM_DOMAIN` | Access時 | `https://<team>.cloudflareaccess.com` |
| `POLICY_AUD` | Access時 | Access Application Audience tag |
| `HUB_SERVICE_TOKEN` | Hub連携時 | Hubから一覧・復習キューの件数・JSON書き出し・接続状態のGETだけを許可する共有secret |
| `SSO_SHARED_SECRET` | Hub連携時 | Hubからの署名付き認証引き継ぎを検証する共有secret |
| `SESSION_TTL_DAYS` | 任意 | 引き継いだセッションの日数。既定30 |
| `SUPABASE_URL` | 必須 | SupabaseプロジェクトURL |
| `SUPABASE_SECRET_KEY` | 必須 | サーバー専用の `sb_secret_...` キー |
| `ANTHROPIC_API_KEY` | 必須 | 出題・採点・示唆のまとめ・英会話の例文で使うサーバー専用キー |
| `REVIEW_BATCH_TOKEN` | 定期実行時 | pg_cronから生成・採点・embeddingバッチを呼ぶ32文字以上の合言葉。SupabaseのVault `review_batch_token` と同じ値。未設定なら画面からの手動実行だけになる |
| `VOYAGE_API_KEY` | 意味検索時 | ナレッジ・示唆・日記の意味検索に使うVoyage AIのサーバー専用キー。未設定ならembeddingを付けず、検索は503 |

`SUPABASE_SECRET_KEY` はRLSを迂回できる強い権限を持つ。Cloudflareでは
暗号化されたSecretとして登録し、ブラウザ用の `VITE_` 変数、ソースコード、
ログには入れない。ダッシュボード専用キーを発行しておくと個別にローテーションできる。

## スクリプト

- `npm run dev` — UIのみのVite開発サーバー
- `npm run dev:pages` — ビルド後、Pages Functionsを含めたローカルサーバー
- `npm run build` — 型チェック + 本番ビルド
- `npm run preview` — ビルド結果のプレビュー（Functionsなし）
- `npm run typecheck` — 型チェックのみ
- `npm test` — ロジック、API、認証、入力・応答検証の自動テスト（Node 23以降）
- `npm run theme` / `npm run theme:check` — ダークテーマのCSSを生成・検査する

## API

取得列、並び順、ページ上限と編集可能項目はサーバー側で固定している。詳細は CLAUDE.md の「DBアクセス」。

- ナレッジ: `GET /api/knowledge`（`status=active|archived|all`）、`POST /api/knowledge`、
  `PATCH /api/knowledge/:id`（本文は `{ expected_version, changes }`。別画面で更新済みなら409）
- 履歴: `GET /api/quiz-log`、`GET /api/mastery-history`
- 復習: `GET /api/review-queue/status`・`pending`・`generation-holds`、
  `POST /api/review-queue/serve`・`answer`・`retry`・`discard`・`confirm`、`POST /api/review-batch/generate`・`grade`
- 日次の復習状況: `GET /api/review/queue` — 今日の回答数・残り・期限超過・新規の保留を返す（トップの「今日の復習キュー」が使う）
- 示唆と問い: `GET/POST /api/insights`、`PATCH/DELETE /api/insights/:id`、`POST /api/insights/analyze`、
  `GET/POST /api/insight-groups`、`PATCH/DELETE /api/insight-groups/:id`、`GET/POST/DELETE /api/insight-group-members`
- 英会話練習: `GET/POST /api/speaking-practice`、`POST /api/speaking-practice/start`
- 意味検索: `POST /api/semantic-search`、`GET /api/semantic-search/status`、`POST /api/embedding-batch`
- その他: `POST /api/inbox`（採点結果の「あとで深掘り」を `idea_inbox` へ登録）、
  `GET /api/export`（読み取り専用JSON）、`GET /api/status`（接続状態）

AIは `claude-sonnet-5-5` を使う。問題文と講評の質が成果物そのものなので、コスト目的で軽量モデルへ落とさない。

一覧APIは `limit`（1〜1,000、既定500）と `offset`（0以上、既定0）を受け付け、
`{ items, total, limit, offset }` を返す。画面は必要なページをすべて取得するため、
2,000件／5,000件を超えても累計値や履歴を黙って切り捨てない。

書き込みはBasic認証に加えて、同一オリジン、専用ヘッダー、JSON、25,000文字以下の本文を
必須とする。サーバー側で許可するのはタイトル、説明、出典メモ、カテゴリ、習熟度、優先度、タグ、
次回復習日、アーカイブ状態だけで、ID・作成日時・学習統計は変更できない。
更新には一覧取得時の `content_version` が必要で、競合時は上書きせず再読み込みを促す。
アーカイブ直後は画面上で取り消せるほか、「アーカイブ済み」一覧から復元できる。
DB接続設定がない場合は503、Supabase通信失敗は502を返す。HTMLや壊れたJSONなど想定外のAPI応答は、ブラウザ内部の解析エラーをそのまま出さず利用者向けの再試行メッセージへ変換する。各グラフには、合計・最大区分・正答率などを短く伝える表示テキストを付け、スクリーンリーダーとタッチ操作だけでも要点を確認できる。

### ナレッジ優先度と復習間隔

各ナレッジには `最高` / `高` / `中` / `低` / `最低` の優先度を設定できる。
優先度は同じ期限に到来した問題の出題順と、q4・q5で決まる次回までの間隔を調整する。
間隔の倍率は最高0.5・高1・中1.5・低2・最低3倍。定着間隔（`stability_hours`）そのものには掛けないため、
優先度を後から変えると、その時点の予定を計算した時刻（`scheduled_from_at`）から次回時刻を再計算する。
再学習中の段階別時刻には掛けない。
再学習内では失敗度、優先度、弱さ、期限の順に出す。1回に受け取る問題（画面は30問）のうち、
通常の期限到来問題が5件以上あれば少なくとも5件は通常の問題にし、古い問題が再学習だけで押し出されるのを防ぐ。

q別の基準間隔は q0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上。
q0〜q3は再学習へ入り、過去の定着間隔をそれぞれ40%・55%・70%・85%残す。この減衰と
習熟度の降格は1回の再学習エピソードにつき1回だけ行う。q0〜q2は四択の再認から始め、
正解後は一問一答の自由想起へ進む。四択正解はq4が上限で、習熟度の昇格には数えない。

通常の期限到来で自由記述にq4なら定着間隔を2倍、q5なら2.8倍へ伸ばす（最大365日）。
学習中から習得中は強い想起3回かつ3日以上、習得中から定着はさらに3回かつ30日以上が条件。
定着後も期限が来れば周期的に出題する。期限前のq4・q5は履歴には残すが、予定・定着間隔・
昇格実績を動かさない。

未出題の新規カードの問題を作るのは1日10件まで（`review_new_cards_per_day()`）。
日本時間の当日に初回回答したカードと、キューで出題を待っている新規カードが枠を使う。
優先度が高い順、次に登録が古い順に選び、超えた分は「今すぐ」の残数に数えず翌日以降に回す。

## 構成

ディレクトリごとの役割は CLAUDE.md の「構成」を参照。主な置き場所は次のとおり。

- `src/` — 画面（React）。データ取得とフィルタ計算は `hooks/`、表示は `components/`
- `functions/` — Cloudflare Pages Functions（認証ミドルウェア、API、出題・採点・バッチの共通処理は `_shared/`）
- `skills/knowledge-quiz/` — チャット用の knowledge-quiz スキル（claude.ai のスキル設定へアップロードする正本）
- `supabase/migrations/` — 本番DBの関数・表の変更SQL（一覧は `supabase/migrations/README.md`）
- `supabase/archive/` — 削除したDB関数・表の最後の定義（参照用。そのまま適用しない）
- `tests/` — 自動テストと、DB関数の統合テスト（`reviewScheduler.integration.sql`）

## デプロイ（Cloudflare Pages）

モノレポ `personal-dashboard` の `apps/knowledge` をGitHub連携でビルド・公開する。
mainへのpushで本番が更新される。ビルド設定（Root directory、Build command、Build watch paths）は
ルートの [`README.md`](../../README.md) を参照。

公開URL: https://knowledge-50b.pages.dev

Cloudflare Pages の **Settings → Variables and Secrets** で、Production と Preview の
両方へ必要な環境変数を登録する。少なくとも `DASHBOARD_PASSWORD`、
`SUPABASE_SECRET_KEY`、`ANTHROPIC_API_KEY`、`REVIEW_BATCH_TOKEN` は必ずSecretとして保存し、
設定後に再デプロイする。`REVIEW_BATCH_TOKEN` は SupabaseのVault `review_batch_token` と同じ値にする。

ブラウザからSupabaseへ直接接続しないため、`VITE_SUPABASE_URL` と
`VITE_SUPABASE_ANON_KEY` は設定しない。

### 閲覧制限

`functions/_middleware.ts` が静的アセットとAPIを含む全リクエストに
HTTP Basic認証をかける。`DASHBOARD_PASSWORD` が未設定だとサイト全体が503を返す
フェイルクローズ設計。認証後のレスポンスもキャッシュおよび検索エンジン登録を禁止する。
CSPは外部のスクリプトとスタイルを禁止し、rechartsに必要なstyle属性だけを許可する。

`AUTH_MODE=access` ではCloudflare Access JWTの署名・issuer・audienceを検証する。
Personal Hub、家計簿、ナレッジを同じAccess applicationで保護すると、1回のログインで3画面を移動できる。

Basic認証を継続する場合も、3サイトへ同じ `SSO_SHARED_SECRET` を設定すれば、Hubからの署名付き引き継ぎで対象ホストに固定したHttpOnlyセッションを作成できる。`HUB_SERVICE_TOKEN` は `GET /api/knowledge`、`GET /api/review-queue/status`、`GET /api/export`、`GET /api/status` のみに使え、POST/PATCHや他のAPIは認証を迂回できない。
引き継ぎトークンのnonceはSupabaseで1回だけ消費されるため、同じURLの再利用は403になる。

生成・採点バッチへのPOSTだけは、Basic認証の代わりに `X-Review-Batch-Token`（`REVIEW_BATCH_TOKEN` と一致するもの）で受け付ける。

### DBマイグレーション

`supabase/migrations/` のSQLをファイル名順に適用してから、そのDB機能に依存するアプリを公開する。
各ファイルの内容と注意点は [`supabase/migrations/README.md`](supabase/migrations/README.md) にまとめている。
表を削除するなどデータが消えるマイグレーションは、内容を確認したうえで所有者が自分で適用する。
適用後は新しい列・トリガー・関数定義と実行権限を確認する。

ブラウザ直接接続（anon key）からの移行は完了している。`supabase/disable-anon-access.sql` を適用済みで、
anonロールからは `knowledge` や `quiz_log` を読めない（2026-10-04に確認）。
