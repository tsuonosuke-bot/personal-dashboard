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
