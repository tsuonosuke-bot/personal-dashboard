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
- `ANTHROPIC_API_KEY`（必須、復習クイズの出題・採点に使用。CloudflareではSecretとして保存）

Secret keyはRLSを迂回するサーバー専用キー。`VITE_` 接頭辞を付けたり、ブラウザ、
ソース、ログへ出したりしてはいけない。実値がない環境でも型チェックとビルドは可能。
実データ確認が必要な作業では判断を仰ぐこと。ANTHROPIC_API_KEYも同様にサーバー専用。

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
- `format` は `一問一答` / `四択` / `記述説明` / `産出` / `ソクラテス式`。
  ダッシュボードから出題するのは `ソクラテス式` を除く4種（対話の往復が要るため）。
  `四択` を許可するCHECK制約の変更は `supabase/allow-choice-quiz-format.sql`
- 他: `knowledge_id`, `asked_on`, `quality`, `note`

### DBアクセス

Cloudflare APIはSecret keyでSupabase REST APIを呼ぶが、許可するのは次だけ。

- `GET /api/knowledge`: 明示した列。`status=active|archived|all` と制限付きページング
- `POST /api/knowledge`: 検証済みの編集可能項目だけで新規登録
- `PATCH /api/knowledge/:id`: UUIDで特定した1件の編集、アーカイブ、復元
- `GET /api/quiz-log`: 明示した列を新しい順に制限付きページング
- `POST /api/quiz/start`: `pick_quiz` RPCで出題候補を取得し、Claude APIで問題文を生成して返す。
  `categories`（登録済みカテゴリ名の配列。空配列は全カテゴリ）、`limit`、`format` で絞り込む
- `POST /api/quiz/grade`: `knowledge`/`quiz_log` を読み直して正解を確認し、Claude APIで採点、
  `record_answers_batch` RPCで一括記録

クイズAPIはブラウザにも `knowledge` の列を素で返さない。`start` は
`{ id, question, format, choices }` だけ、`grade` は採点後なので `title` と模範解答を返す。
`choices` は四択のときだけ入り、どれが正解かは返さない（採点時に `knowledge` を読み直して判定する）。

一覧APIの `limit` は1〜1,000、`offset` は0以上に限定し、応答は
`{ items, total, limit, offset }` とする。ブラウザ側は全ページを取得し、固定件数で
黙って切り捨てない。任意テーブル、任意クエリの追加は禁止。移行完了後、
`supabase/disable-anon-access.sql` でanon権限を外す。

### 復習クイズのDB関数

SM-2の計算は全てDB関数側にあり、Functions側やブラウザ側で再実装しない。

- `pick_quiz(p_include, p_exclude, p_limit, p_include_mastered=false)`: 出題候補を返す
- `record_answer(p_knowledge_id, p_quality, p_verdict, p_note, p_format)`: 採点1件を
  SM-2更新・knowledge更新・quiz_log挿入までまとめて確定する（SECURITY INVOKER）
- `record_answers_batch(p_answers jsonb)`: `record_answer` を `cross join lateral` で
  複数件まとめて1SQLで呼ぶだけの薄いラッパー。採点全体の原子性のために追加した
  （SM-2ロジック自体は持たない）
- `jst_today()`: 日本時間の今日。日付判定は必ずこれを経由する

`/api/quiz/grade` は書き込み前に `quiz_log` を `asked_on = jst_today()` で確認し、
その日にまだ記録がない項目だけを `record_answers_batch` に渡す（同日重複記録の防止）。

### クイズの出題・採点品質

チャットの `knowledge-quiz` スキルと同じ体験になるよう揃えている。ここを削ると露骨に質が落ちる。

- 出題・採点とも `claude-sonnet-5`。問題文と講評が成果物そのものなので軽量モデルに落とさない
- `max_tokens` は16,000。Sonnet 5は思考トークンも `max_tokens` に含まれるため、15問だと8,192では足りない
- 出題時はカテゴリ・タグ・`times_asked` に加えて、直近2回分の `note`（前回どこでつまずいたか）を
  渡す。noteは次回出題に効かせるために書かせている
- 出題順は同じカテゴリが連続しないよう入れ替える。並べ替えるのは順番だけで、`pick_quiz` が
  選んだ問題の差し替えはしない
- 出題形式は `おまかせ` / `一問一答` / `四択` / `記述説明` / `産出` から選ぶ。`おまかせ` は習熟度で
  問い方を上げる（未学習→四択、学習中→一問一答、習得中・定着→記述説明、語学カテゴリなら産出）。
  値はスキル側と揃える。揃えないと `quiz_log` の履歴が形式で分断される
- 四択の選択肢はAIに4件作らせ、サーバー側で並べ替えてから返す。件数・重複・空文字が崩れていたら
  黙って自由記述に落とさず502にする。採点では当て勘が混じるぶんq値の上限を4に抑える
- 採点要求の `format` はブラウザの自己申告だが、許可値であることだけ検証すれば足りる
  （履歴のラベルと採点方針にしか使わず、正解は毎回 `knowledge` から読み直すため）
- 採点は出題時の問題文もブラウザから送り返し、「この問いに答えられたか」で採点する。
  問題文を渡さないと、空所補充に単語で答えただけで「説明が足りない」と減点される
- 採点は `correct_answer`（模範解答）と `explanation`（この回答への講評）を分けて出させる
- 0件時は `knowledge` の件数を数えて「対象なし」と「本日出題済み」を切り分ける
Secret keyはservice_roleのためRLSを迂回する。ブラウザのanon keyでは
`record_answer` / `record_answers_batch` は書き込めない設計を変えない。

## 構成

```text
src/
  App.tsx                   画面の組み立て、フィルタとページ番号の状態、復習クイズへの導線
  constants.ts              習熟度の色・並び順、円グラフ配色、PAGE_SIZE
  types.ts                  Knowledge / QuizLog / Filters / クイズ関連の型
  lib/api.ts                同一オリジンAPIクライアントと全ページ取得、クイズAPI呼び出し
  lib/apiValidation.ts      DB応答・クイズAPI応答の実行時型検証
  lib/knowledge.ts          絞り込み・並び替え・復習分析
  hooks/
    useKnowledgeData.ts     APIからの取得とリロード
    useFilteredKnowledge.ts 検索・カテゴリ・習熟度での絞り込み
    useModalDialog.ts       モーダルのフォーカス管理
    useQuiz.ts              復習クイズの出題・回答・採点フロー管理
  components/               表示、編集、詳細、アーカイブ復元、復習クイズ画面（QuizView）
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST API / RPC呼び出し
  _shared/knowledgeValidation.ts 書き込み要求と入力の検証
  _shared/quizValidation.ts クイズAPIの要求検証
  _shared/anthropicClient.ts Claude APIをツール強制呼び出しで叩く共通クライアント
  api/knowledge.ts          ナレッジ一覧・新規登録API
  api/knowledge/[id].ts     ナレッジ編集・アーカイブ・復元API
  api/quiz-log.ts           クイズ履歴読み取りAPI
  api/quiz/start.ts         復習クイズの出題API
  api/quiz/grade.ts         復習クイズの採点・記録API
public/
  manifest.webmanifest      PWA用マニフェスト
  sw.js                     ホーム画面起動のための最小限のService Worker（キャッシュしない）
  icon.svg / icon-maskable.svg PWAアイコン
```

- データ取得とフィルタ計算はhooksに置き、componentsは表示に徹する。
- 習熟度の色と並び順は `constants.ts` に集約する。
- `index.css` はクラス名ベース。CSS ModulesやTailwindは使わない。
- rechartsの親要素には高さが必要（`.chart-box` は `height: 240px`）。
- フィルタ変更時と更新時はページ番号を1へ戻す。
- モーダルはフォーカスを内部に保ち、閉じたら呼び出し元へ戻す。
- QuizViewの出題カテゴリは登録済みカテゴリから組み立てる。固定の選択肢を持たない。
- `KnowledgeDetailModal` は `onEdit` / `onArchive` を省くと読み取り専用になる。
  クイズの採点結果から出典を開くときはこの形で使う。

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
