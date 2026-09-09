# CLAUDE.md

Supabase のナレッジDB（学習カード + クイズ履歴）を閲覧する読み取り専用ダッシュボード。
Vite + React + TypeScript、グラフは recharts。

## コマンド

```bash
npm install
npm run dev        # 開発サーバー (http://localhost:5173)
npm run build      # tsc -b + vite build
npm run typecheck  # 型チェックのみ
npm run preview    # ビルド結果のプレビュー
```

変更後は最低限 `npm run typecheck` を通すこと。ビルドまで通せるとなお良い。

## 環境変数

`.env`（gitignore 済み）に以下が必要。`.env.example` をコピーして作る。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**クラウドセッションには `.env` が存在しない。** そのため実データでの動作確認はできず、
画面には設定エラーが表示される（これは想定どおりの挙動）。コード編集・型チェック・
ビルドは問題なく行える。実データ確認が必要な作業は、その旨を伝えて判断を仰ぐこと。

未設定時は `src/lib/supabase.ts` の `configError` が画面にエラーを出す。
起動時に throw してはいけない（白画面になるため）。

## DBスキーマ（実データに基づく事実）

Supabase project ref: `plwlxwidpqbunugfxjhp`

### `knowledge`
- `id` は **uuid 文字列**（number ではない）
- `mastery` の値は **`未学習` / `学習中` / `定着`** の3種
  - 移行前の旧HTMLは `未定着` / `復習中` と誤ってハードコードしており、
    習熟度グラフとフィルタが機能していなかった。この語彙を勝手に変えないこと。
- 他: `title`, `explanation`, `category`, `tags`(配列), `accuracy`(0〜1),
  `next_review_on`, `archived`, `created_at`
- 一覧は `archived = false` のみ対象

### `quiz_log`
- `verdict` の値は **`正解` / `不正解` / `部分正解`** の3種
  - 正答率は `正解` のみを分子として計算している（`部分正解` は含めない）
- 他: `knowledge_id`(uuid), `asked_on`, `quality`, `format`, `note`

### RLS
`anon` ロールは **SELECT のみ**。書き込みは `authenticated` のみ。
このアプリは読み取り専用であり、書き込み機能を追加してはいけない。

## 構成

```
src/
  App.tsx                   画面の組み立て、フィルタとページ番号の状態
  constants.ts              習熟度の色・並び順、円グラフ配色、PAGE_SIZE
  types.ts                  Knowledge / QuizLog / Filters
  lib/supabase.ts           クライアント生成と環境変数チェック
  hooks/
    useKnowledgeData.ts     knowledge / quiz_log 取得、reload
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度での絞り込み
  components/
    StatsCards.tsx          統計カード4枚
    ChartCard.tsx           グラフ用カードの共通枠
    CategoryChart.tsx       カテゴリ別分布（ドーナツ）
    MasteryChart.tsx        習熟度分布（棒）
    HistoryChart.tsx        日別出題数・正答率（2軸折れ線）
    FilterBar.tsx           検索・カテゴリ・習熟度フィルタ
    KnowledgeTable.tsx      一覧テーブル
    Pagination.tsx          ページネーション
```

- データ取得とフィルタ計算は hooks に置き、components は表示に徹する。
- 習熟度の色と並び順は `constants.ts` に集約。コンポーネント側で直書きしない。
- `index.css` は移行前の単体HTMLからそのまま持ってきたグローバルCSS。
  クラス名ベースで、CSS Modules や Tailwind は使っていない。

## 注意点

- recharts のグラフは親要素に高さが必要（`.chart-box` が `height: 240px` を持つ）。
  高さのない要素に入れると描画されない。
- フィルタを変更したとき、および更新ボタンを押したときはページ番号を1に戻す。
- 表示件数・ページ番号の表示は移行前の挙動を維持している。

## デプロイ

Cloudflare Pages に GitHub 連携でデプロイしている。main への push で本番が更新される。
本番: https://knowledge-dashboard-27t.pages.dev （Framework preset は None、ビルドコマンド直指定）

グラフの描画確認をヘッドレス/非表示のブラウザで行うと、`requestAnimationFrame` が止まるため
recharts の初回アニメーションが進まず、棒グラフと円グラフが空に見える（折れ線は描画される）。
本番ビルドの不具合ではないので、実際に表示されているブラウザで確認すること。
ビルド設定と環境変数、閲覧制限、クラウドセッション用の設定は README.md を参照。

`VITE_` 変数はビルド時にバンドルへ埋め込まれる。環境変数を変えたら再デプロイが必要。

## Git 運用

`claude/*` ブランチを切って PR を作る。main への直接コミットは避ける。
