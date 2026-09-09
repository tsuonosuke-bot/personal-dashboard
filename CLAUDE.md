# CLAUDE.md

Supabase のナレッジDB（学習カード + クイズ履歴）を自分専用で管理する
ダッシュボード。Vite + React + TypeScript、グラフは recharts。
ブラウザはSupabaseへ直接接続せず、Basic認証済みのCloudflare Pages Functions APIを使う。
ナレッジの追加・編集・アーカイブ・復元を行える。クイズ履歴と学習統計は読み取り専用。

## コマンド

```bash
npm install
npm run dev        # UIのみのVite開発サーバー（APIなし）
npm run dev:pages  # ビルド + Functions込み (http://localhost:8788)
npm run build      # tsc -b + vite build
npm run typecheck  # 型チェックのみ
npm run preview    # ビルド結果のプレビュー（Functionsなし）
npm test           # ロジック、API、認証、入力・応答検証
```

変更後は最低限 `npm run typecheck` を通すこと。ビルドまで通せるとなお良い。

## 実行時の環境変数

ローカルでは `.dev.vars.example` を `.dev.vars` へコピーする。
`.dev.vars` はgitignore済みで、実値をコミットしない。

- `DASHBOARD_PASSWORD`（必須、ASCII）
- `DASHBOARD_USER`（任意、既定 admin）
- `SUPABASE_URL`（必須）
- `SUPABASE_SECRET_KEY`（必須、CloudflareではSecretとして保存）

Secret keyはRLSを迂回するサーバー専用キー。`VITE_` 接頭辞を付けたり、ブラウザ、
ソース、ログへ出したりしてはいけない。実値がない環境でも型チェックとビルドは可能。
実データ確認が必要な作業では判断を仰ぐこと。

## DBスキーマ（実データに基づく事実）

Supabase project ref: `plwlxwidpqbunugfxjhp`

### `knowledge`

- `id` はuuid文字列
- `mastery` は `未学習` / `学習中` / `習得中` / `定着` の4種。この語彙を変えない
- 他: `title`, `explanation`, `category`, `tags`, `accuracy`,
  `next_review_on`, `archived`, `created_at`
- 通常一覧は `archived = false`、アーカイブ一覧は `archived = true` が対象

### `quiz_log`

- `verdict` は `正解` / `不正解` / `部分正解` の3種
- 正答率は `正解` だけを分子とし、`部分正解` は含めない
- 他: `knowledge_id`, `asked_on`, `quality`, `format`, `note`

### DBアクセス

Cloudflare APIはSecret keyでSupabase REST APIを呼ぶが、許可するのは次だけ。

- `GET /api/knowledge`: 明示した列。`status=active|archived|all` と制限付きページング
- `POST /api/knowledge`: 検証済みの編集可能項目だけで新規登録
- `PATCH /api/knowledge/:id`: UUIDで特定した1件の編集、アーカイブ、復元
- `GET /api/quiz-log`: 明示した列を新しい順に制限付きページング

一覧APIの `limit` は1〜1,000、`offset` は0以上に限定し、応答は
`{ items, total, limit, offset }` とする。ブラウザ側は全ページを取得し、固定件数で
黙って切り捨てない。任意テーブル、任意クエリ、クイズ履歴・学習統計の書き込みを
追加してはいけない。移行完了後、`supabase/disable-anon-access.sql` でanon権限を外す。

## 構成

```text
src/
  App.tsx                   画面の組み立て、フィルタとページ番号の状態
  constants.ts              習熟度の色・並び順、円グラフ配色、PAGE_SIZE
  types.ts                  Knowledge / QuizLog / Filters
  lib/api.ts                同一オリジンAPIクライアントと全ページ取得
  lib/apiValidation.ts      DB応答の実行時型検証
  lib/knowledge.ts          絞り込み・並び替え・復習分析
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度での絞り込み
    useModalDialog.ts       モーダルのフォーカス管理
  components/               表示、編集、詳細、アーカイブ復元
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST API呼び出し
  _shared/knowledgeValidation.ts 書き込み要求と入力の検証
  api/knowledge.ts          ナレッジ一覧・新規登録API
  api/knowledge/[id].ts     ナレッジ編集・アーカイブ・復元API
  api/quiz-log.ts           クイズ履歴読み取りAPI
```

- データ取得とフィルタ計算はhooksに置き、componentsは表示に徹する。
- 習熟度の色と並び順は `constants.ts` に集約する。
- `index.css` はクラス名ベース。CSS ModulesやTailwindは使わない。
- rechartsの親要素には高さが必要（`.chart-box` は `height: 240px`）。
- フィルタ変更時と更新時はページ番号を1へ戻す。
- モーダルはフォーカスを内部に保ち、閉じたら呼び出し元へ戻す。

## デプロイと閲覧制限

Cloudflare PagesにGitHub連携でデプロイしている。mainへのpushで本番が更新される。
本番: https://knowledge-dashboard-27t.pages.dev

Functionsの環境変数はCloudflareのVariables and SecretsでProduction/Preview双方に設定し、
値を変更したら再デプロイする。

`functions/_middleware.ts` は静的アセットと `/api/*` の全リクエストにBasic認証をかける。
パスワード未設定時は503を返すフェイルクローズ設計を変えない。
CSPは外部スクリプト・外部スタイルを禁止する。rechartsが生成するstyle属性だけは
`style-src-attr` で許可し、アプリ固有の色分けはCSSクラスで行う。

`functions/` はtsconfigのincludeに入っており、`npm run typecheck` の対象。
ローカル統合確認は `.dev.vars` を用意して `npm run dev:pages` を使う。

グラフを非表示ブラウザで確認すると、`requestAnimationFrame` が止まって初回アニメーションが
進まず、棒・円グラフが空に見えることがある。実際に表示されたブラウザでも確認する。

## Git運用

`claude/*` ブランチを切ってPRを作る。mainへの直接コミットは避ける。
