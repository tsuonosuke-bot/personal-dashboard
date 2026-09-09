# knowledge-dashboard

Supabase のナレッジDBを自分専用で閲覧するダッシュボード
（Vite + React + TypeScript + Cloudflare Pages Functions）。

ブラウザはSupabaseへ直接接続しない。全リクエストをHTTP Basic認証で保護し、
認証後の `/api/*` だけがCloudflare Pages FunctionsからSupabaseを読み書きする。

```text
Browser --Basic認証--> Cloudflare Pages Functions --Secret key--> Supabase REST API
```

## セットアップ

```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars の必須3項目を記入
npm run dev:pages
```

`npm run dev:pages` は本番ビルド後、Functionsを含めて
`http://localhost:8788` で起動する。単体の `npm run dev` はUI開発用で、
Viteだけを起動するため `/api/*` は利用できない。

`.dev.vars` はGit管理外。実際のキーやパスワードをコミットしないこと。

## 実行時の環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | 必須 | 閲覧用パスワード（ASCIIのみ） |
| `DASHBOARD_USER` | 任意 | 閲覧用ユーザー名。既定は `admin` |
| `SUPABASE_URL` | 必須 | SupabaseプロジェクトURL |
| `SUPABASE_SECRET_KEY` | 必須 | サーバー専用の `sb_secret_...` キー |

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
- `PATCH /api/knowledge/:id` — 許可項目の編集、アーカイブまたは復元
- `GET /api/quiz-log` — クイズ履歴を新しい順に取得

一覧APIは `limit`（1〜1,000、既定500）と `offset`（0以上、既定0）を受け付け、
`{ items, total, limit, offset }` を返す。画面は必要なページをすべて取得するため、
2,000件／5,000件を超えても累計値や履歴を黙って切り捨てない。

書き込みはBasic認証に加えて、同一オリジン、専用ヘッダー、JSON、25,000文字以下の本文を
必須とする。サーバー側で許可するのはタイトル、説明、出典メモ、カテゴリ、習熟度、タグ、
次回復習日、アーカイブ状態だけで、ID・作成日時・学習統計は変更できない。
アーカイブ直後は画面上で取り消せるほか、「アーカイブ済み」一覧から復元できる。
DB接続設定がない場合は503、Supabase通信失敗は502を返す。

## 構成

```text
src/
  App.tsx                   画面全体の組み立てとフィルタ/ページ状態
  constants.ts             習熟度の色・並び順、配色、ページサイズ
  types.ts                 knowledge / quiz_log の型
  lib/api.ts               同一オリジンAPIクライアント、全ページ取得
  lib/apiValidation.ts     API応答の実行時検証
  lib/knowledge.ts         絞り込み・並び替え・復習分析
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度による絞り込み
    useModalDialog.ts       モーダルのフォーカス管理
  components/              統計、グラフ、編集、アーカイブ復元、一覧
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST APIのサーバー専用クライアント
  _shared/knowledgeValidation.ts 書き込み防御と入力検証
  api/knowledge.ts          ナレッジ一覧・新規登録API
  api/knowledge/[id].ts     ナレッジ編集・アーカイブ・復元API
  api/quiz-log.ts           クイズ履歴読み取りAPI
supabase/
  disable-anon-access.sql   移行完了後にanon権限を外すSQL
```

グラフは [recharts](https://recharts.org/)。

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
両方へ必須3つの環境変数を登録する。`DASHBOARD_PASSWORD` と
`SUPABASE_SECRET_KEY` は必ずSecretとして保存し、設定後に再デプロイする。

ブラウザからSupabaseへ直接接続しないため、`VITE_SUPABASE_URL` と
`VITE_SUPABASE_ANON_KEY` は設定しない。

### 閲覧制限

`functions/_middleware.ts` が静的アセットとAPIを含む全リクエストに
HTTP Basic認証をかける。`DASHBOARD_PASSWORD` が未設定だとサイト全体が503を返す
フェイルクローズ設計。認証後のレスポンスもキャッシュおよび検索エンジン登録を禁止する。
CSPは外部のスクリプトとスタイルを禁止し、rechartsに必要なstyle属性だけを許可する。

Cloudflare Access（Zero Trust）は $0 プランでもカード登録が必要なため採用していない。

## 既存のブラウザ直接接続からの移行

現在公開中のバージョンを停止させないため、次の順番を守る。

1. Supabaseでダッシュボード専用Secret keyを発行する。
2. Cloudflare Previewへ必須3つの環境変数を設定してPreviewデプロイを確認する。
3. Productionへ同じ構成を設定し、このバージョンをデプロイする。
4. Basic認証後に実データが表示されることを確認する。
5. 最後に `supabase/disable-anon-access.sql` をSupabase SQL Editorで実行する。
6. 公開サイトを再確認し、旧anon/publishable keyで直接SELECTできないことを確認する。

SQLを先に実行すると、移行前の公開サイトがデータを取得できなくなる。
