# CLAUDE.md

Supabase のナレッジDB（学習カード + クイズ履歴）を自分専用で閲覧する
読み取り専用ダッシュボード。Vite + React + TypeScript、グラフは recharts。
ブラウザはSupabaseへ直接接続せず、Basic認証済みのCloudflare Pages Functions APIを使う。

## コマンド

```bash
npm install
npm run dev        # UIのみのVite開発サーバー（APIなし）
npm run dev:pages  # ビルド + Functions込み (http://localhost:8788)
npm run build      # tsc -b + vite build
npm run typecheck  # 型チェックのみ
npm run preview    # ビルド結果のプレビュー（Functionsなし）
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
- `mastery` は `未学習` / `学習中` / `定着` の3種。この語彙を変えない
- 他: `title`, `explanation`, `category`, `tags`, `accuracy`,
  `next_review_on`, `archived`, `created_at`
- 一覧は `archived = false` のみ対象

### `quiz_log`

- `verdict` は `正解` / `不正解` / `部分正解` の3種
- 正答率は `正解` だけを分子とし、`部分正解` は含めない
- 他: `knowledge_id`, `asked_on`, `quality`, `format`, `note`

### DBアクセス

Cloudflare APIはSecret keyでSupabase REST APIを呼ぶが、許可するのは次だけ。

- `GET /api/knowledge`: 明示した列、`archived = false`、最大2,000件
- `GET /api/quiz-log`: 明示した列、最大5,000件

GET以外や任意テーブル・任意クエリを受け付けてはいけない。このアプリに書き込み機能を
追加してはいけない。移行完了後、`supabase/disable-anon-access.sql` でanon権限を外す。

## 構成

```text
src/
  App.tsx                   画面の組み立て、フィルタとページ番号の状態
  constants.ts              習熟度の色・並び順、円グラフ配色、PAGE_SIZE
  types.ts                  Knowledge / QuizLog / Filters
  lib/api.ts                同一オリジンの読み取り専用APIクライアント
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度での絞り込み
  components/               表示コンポーネント
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST API呼び出し
  api/knowledge.ts          ナレッジ読み取りAPI
  api/quiz-log.ts           クイズ履歴読み取りAPI
```

- データ取得とフィルタ計算はhooksに置き、componentsは表示に徹する。
- 習熟度の色と並び順は `constants.ts` に集約する。
- `index.css` はクラス名ベース。CSS ModulesやTailwindは使わない。
- rechartsの親要素には高さが必要（`.chart-box` は `height: 240px`）。
- フィルタ変更時と更新時はページ番号を1へ戻す。

## デプロイと閲覧制限

Cloudflare PagesにGitHub連携でデプロイしている。mainへのpushで本番が更新される。
本番: https://knowledge-dashboard-27t.pages.dev

Functionsの環境変数はCloudflareのVariables and SecretsでProduction/Preview双方に設定し、
値を変更したら再デプロイする。

`functions/_middleware.ts` は静的アセットと `/api/*` の全リクエストにBasic認証をかける。
パスワード未設定時は503を返すフェイルクローズ設計を変えない。

`functions/` はtsconfigのincludeに入っており、`npm run typecheck` の対象。
ローカル統合確認は `.dev.vars` を用意して `npm run dev:pages` を使う。

グラフを非表示ブラウザで確認すると、`requestAnimationFrame` が止まって初回アニメーションが
進まず、棒・円グラフが空に見えることがある。実際に表示されたブラウザでも確認する。

## Git運用

`claude/*` ブランチを切ってPRを作る。mainへの直接コミットは避ける。
