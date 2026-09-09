# knowledge-dashboard

Supabase のナレッジDBを自分専用で閲覧するダッシュボード
（Vite + React + TypeScript + Cloudflare Pages Functions）。

ブラウザはSupabaseへ直接接続しない。全リクエストをHTTP Basic認証で保護し、
認証後の `/api/*` だけがCloudflare Pages FunctionsからSupabaseを読み取る。

```text
Browser --Basic認証--> Cloudflare Pages Functions --Secret key--> Supabase REST API
```

## セットアップ

```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars の4項目を記入
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

## API

APIは次のGETだけを提供する。取得列、並び順、上限はサーバー側で固定している。

- `GET /api/knowledge` — 未アーカイブのナレッジ、最大2,000件
- `GET /api/quiz-log` — クイズ履歴、最大5,000件

GET以外は405。DB接続設定がない場合は503、Supabase取得失敗は502を返す。
Basic認証は静的アセットとAPIの両方に適用される。

## 構成

```text
src/
  App.tsx                   画面全体の組み立てとフィルタ/ページ状態
  constants.ts             習熟度の色・並び順、配色、ページサイズ
  types.ts                 knowledge / quiz_log の型
  lib/api.ts               同一オリジンの読み取り専用APIクライアント
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度による絞り込み
  components/              統計、グラフ、フィルタ、一覧、ページ送り
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST APIのサーバー専用クライアント
  api/knowledge.ts          ナレッジ読み取りAPI
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
両方へ4つの環境変数を登録する。`DASHBOARD_PASSWORD` と
`SUPABASE_SECRET_KEY` は必ずSecretとして保存し、設定後に再デプロイする。

### 閲覧制限

`functions/_middleware.ts` が静的アセットとAPIを含む全リクエストに
HTTP Basic認証をかける。`DASHBOARD_PASSWORD` が未設定だとサイト全体が503を返す
フェイルクローズ設計。認証後のレスポンスもキャッシュおよび検索エンジン登録を禁止する。

Cloudflare Access（Zero Trust）は $0 プランでもカード登録が必要なため採用していない。

## 既存のブラウザ直接接続からの移行

現在公開中のバージョンを停止させないため、次の順番を守る。

1. Supabaseでダッシュボード専用Secret keyを発行する。
2. Cloudflare Previewへ4つの環境変数を設定してPreviewデプロイを確認する。
3. Productionへ同じ構成を設定し、このバージョンをデプロイする。
4. Basic認証後に実データが表示されることを確認する。
5. 最後に `supabase/disable-anon-access.sql` をSupabase SQL Editorで実行する。
6. 公開サイトを再確認し、旧anon/publishable keyで直接SELECTできないことを確認する。

SQLを先に実行すると、移行前の公開サイトがデータを取得できなくなる。
