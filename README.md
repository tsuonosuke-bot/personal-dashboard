# knowledge-dashboard

Supabase のナレッジDBを閲覧するダッシュボード（Vite + React + TypeScript）。

## セットアップ

```bash
npm install
cp .env.example .env   # URL と anon key を記入
npm run dev
```

## 環境変数

| 変数 | 説明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase プロジェクトの URL |
| `VITE_SUPABASE_ANON_KEY` | anon (publishable) key |

`.env` は `.gitignore` 済み。

## スクリプト

- `npm run dev` — 開発サーバー
- `npm run build` — 型チェック + 本番ビルド
- `npm run preview` — ビルド結果のプレビュー
- `npm run typecheck` — 型チェックのみ

## 構成

```
src/
  App.tsx                  画面全体の組み立てとフィルタ/ページ状態
  constants.ts             習熟度の色・並び順、配色、ページサイズ
  types.ts                 knowledge / quiz_log の型
  lib/supabase.ts          Supabase クライアントと環境変数チェック
  hooks/
    useKnowledgeData.ts    knowledge / quiz_log の取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度による絞り込み
  components/
    StatsCards.tsx         統計カード
    ChartCard.tsx          グラフ用カードの枠
    CategoryChart.tsx      カテゴリ別分布（ドーナツ）
    MasteryChart.tsx       習熟度分布（棒）
    HistoryChart.tsx       日別出題数・正答率（2軸折れ線）
    FilterBar.tsx          検索・カテゴリ・習熟度フィルタ
    KnowledgeTable.tsx     一覧テーブル
    Pagination.tsx         ページネーション
```

グラフは [recharts](https://recharts.org/)。

## デプロイ（Cloudflare Pages）

GitHub 連携でビルド・公開する。設定値は以下。

| 項目 | 値 |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node バージョン | `.node-version`（22）を参照 |

Cloudflare Pages の **Settings → Environment variables** に、Production と Preview の
両方へ `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録する。
Vite の `VITE_` 変数はビルド時にJSへ埋め込まれるため、変更後は再デプロイが必要。

### 閲覧制限

anon key はバンドルに含まれるため、URL を知っていれば誰でもナレッジを閲覧できる。
RLS により anon は SELECT のみで書き込みは不可だが、閲覧を自分だけに限定する場合は
Cloudflare Access（Zero Trust → Access → Applications）で対象ドメインを保護する。

## Claude Code クラウドセッション

claude.ai/code の **cloud environment** 設定に以下を入れると、クラウド側でも
実データで動作確認できる。

- **Environment variables**（`.env` 形式）:
  ```
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_ANON_KEY=...
  ```
- **Network access**: `Custom` を選び、許可ドメインに Supabase のホストを追加する。
  デフォルトの `Trusted` には `*.supabase.co` が含まれておらず、追加しないと接続できない。
- **Setup script**（任意）: `npm install || true`

anon key は RLS で SELECT のみに制限された公開前提のキーなので、
environment variables 欄に置いて問題ない（同欄は環境の利用者が閲覧可能）。
