# CLAUDE.md

Supabase のナレッジDB（学習カード + クイズ履歴）を自分専用で管理する
ダッシュボード。Vite + React + TypeScript、グラフは recharts。
ブラウザはSupabaseへ直接接続せず、Basic認証済みのCloudflare Pages Functions APIを使う。
ナレッジの追加・編集・アーカイブ・復元を行える。復習とは独立した英会話練習も記録する。

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
- `QUIZ_SIGNING_SECRET`（必須、32文字以上。出題内容の署名用でSSO共有secretと分ける）
- `REVIEW_BATCH_TOKEN`（任意、32文字以上。pg_cronから生成・採点バッチを呼ぶ合言葉。SupabaseのVault `review_batch_token` と同じ値。
  未設定なら定期実行は届かず、画面からの手動実行だけになる）

Secret keyはRLSを迂回するサーバー専用キー。`VITE_` 接頭辞を付けたり、ブラウザ、
ソース、ログへ出したりしてはいけない。実値がない環境でも型チェックとビルドは可能。
実データ確認が必要な作業では判断を仰ぐこと。ANTHROPIC_API_KEYも同様にサーバー専用。

## DBスキーマ（実データに基づく事実）

Supabase project ref: `plwlxwidpqbunugfxjhp`

### `knowledge`

- `id` はuuid文字列
- `mastery` は `未学習` / `学習中` / `習得中` / `定着` の4種。この語彙を変えない
- 他: `title`, `explanation`, `category`, `tags`, `accuracy`,
  `next_review_on`, `next_review_at`, `stability_hours`, `relearning_stage`, `relearning_quality`, `relearning_penalized`,
  `last_reviewed_at`, `scheduled_from_at`, `archived`, `created_at`, `content_version`, `priority`, `base_interval_days`
- `priority` は `最高` / `高` / `中` / `低` / `最低`。同じ期限内の出題順と、q4・q5後の次回間隔
  （`review_priority_factor`: 0.5 / 1 / 1.5 / 2 / 3倍）に使う。`stability_hours` には掛けない
- `scheduled_from_at` は `record_answer` が次回時刻を計算した時刻。優先度だけの編集はトリガー
  （`reschedule_knowledge_for_priority`）がここから次回時刻を再計算する。同じ編集で日付を指定した場合と再学習中は再計算しない
- `next_review_at` が時刻を含む正本。`next_review_on` と日単位の列は互換表示用
- `stability_hours` は保持型の定着間隔、`relearning_stage` は `recognition` / `recall`
- 通常一覧は `archived = false`、アーカイブ一覧は `archived = true` が対象

### `review_queue`（問題キュー＝回答キュー）

- 1行が1問。`ready`（出題待ち）→ `answered`（採点待ち）→ `grading` → `graded`。採点の失敗が
  `review_grading_max_attempts()`（3回）に達したら `error`。カードの編集・アーカイブ・別経路の回答で古くなった問題は `discarded`
- 進行中（ready / answered / grading / error）の問題は1カードにつき1件まで（部分一意インデックス）
- 四択は `choices`・`correct_choice`・出題時に作った講評 `prepared_explanation` を持つ。正解はブラウザへ返さない
- 全形式で出題時に作った想定解 `expected_answer` を持つ。生成時に問題文への漏れを照合し（60文字以下の想定解だけ。
  四択は正解の選択肢）、回答を受け付けた後にだけ返して答え合わせに使う。出題（serve）では返さない
- おかしな問題は `discard_review_question` で取り下げる（`discarded_reason = 'reported'`）。記録も予定の変更もせず、
  次の生成バッチで作り直す
- 生成は `pick_review_generation_candidates`（期限到来または30分以内、新規は1日10件の枠をキュー内の新規分も含めて数える）
  → AI → `enqueue_review_questions`（`ready` が `review_queue_limit()`＝200件に達したら追加しない）
- 出題は `serve_review_queue`。期限が来た `ready` だけを、日次復習キューと同じ優先度順で返し、古い問題は先に破棄する
- 回答は `submit_review_answer`。採点は `claim_review_answers` → AI → `record_review_grade`。失敗は `release_review_answer`
- `record_review_grade` は回答時刻を `record_answer(..., p_answered_at)` に渡し、予定の起点・`quiz_log.created_at`・`asked_on` を
  回答時刻にする。別経路でより新しく回答済みのカードへの古い回答は記録せず `discarded` にする
- `review_batch_runs` はバッチの実行記録。`begin_review_batch` が同じ種類の同時実行を防ぐ（15分で打ち切り扱い）。
  生成はAIの呼び出しかDBで失敗したときだけ `failed`。AIが応答して一部（全部でも）のカードが条件を満たさなかっただけなら
  `succeeded` で、件数を `failed`、理由の例を `note` に残す

### `review_generation_holds`（問題を作れなかったカード）

- 生成した問題が条件（`generationIssue`）を満たさなければ、その項目だけを前回の問題文と理由（`previous_attempt`）を添えて
  その場で1回だけ作り直す。それでも満たさないカードを `hold_review_generation_failures` が1行に記録する
- 列: `knowledge_id`（PK、ナレッジ削除で連動削除）, `content_version`, `failure_count`（同じ版での連続回数）, `last_reason`,
  `last_question`（最後に不採用になった問題文）, `last_failed_at`, `retry_after`
- `retry_after` までは `pick_review_generation_candidates` の候補にしない。待ち時間は `review_generation_backoff`:
  1回目2時間、2回目6時間、3回目以降24時間。手動の生成でも飛ばさない
- カードを編集して `content_version` が変われば待たずに候補へ戻り、次の失敗は1回目から数える。
  `enqueue_review_questions` が問題を入れたら記録を消す
- `list_review_generation_holds` と `get_review_queue_status.generation_held` は、アーカイブ済みと失敗後に編集されたカードを数えない

### `quiz_log`

- `verdict` は `正解` / `不正解` / `部分正解` の3種
- 正答率は `正解` だけを分子とし、`部分正解` は含めない
- `format` は `一問一答` / `四択` / `記述説明` / `産出` / `ソクラテス式`。
  ダッシュボードから出題するのは `ソクラテス式` を除く4種（対話の往復が要るため）。
  `四択` を許可するCHECK制約の変更は `supabase/allow-choice-quiz-format.sql`
- 他: `knowledge_id`, `asked_on`, `quality`, `note`, `attempt_id`（署名済み出題nonce）、
  `was_early`、`schedule_updated`
- キュー経由の回答は `question`・`user_answer`・`correct_answer`・`explanation`・`answered_at`・`review_queue_id` も持つ。
  `confirmed_at` が空の行が「未確認の採点結果」。既存の行と都度採点の行はこれらが空

### `knowledge_mastery_history`

- 習熟度の変更履歴。`knowledge` のINSERTと`mastery`の変更時にトリガー
  （`log_knowledge_mastery_change`、SECURITY DEFINER）が1行追記する
- `is_baseline = true` は記録開始時点（2026-09-23のマイグレーション）の状態。それ以前の推移は存在しない
- 他: `knowledge_id`, `from_mastery`, `to_mastery`, `changed_at`。アプリからは読み取りのみ

### `speaking_practice_log`

- 英会話練習専用。`quiz_log`、習熟度、次回復習日を変更しない
- `practice_type` は `instant_composition` / `read_aloud`
- `rating` は `smooth` / `almost` / `retry`
- 他: `attempt_id`（冪等キー）、`session_id`, `knowledge_id`, `answer_text`,
  `repetitions`, `practiced_at`
- 音声データは保存しない
- 学習ログページの「英会話練習」タブで見返す。記録は少量なので全件を1回取得し、期間・練習の種類・評価で画面側で絞る。
  日付は日本時間。日別の回数は評価別の積み上げ棒（1軸）で、評価は青1色の濃淡（ダークは段階を反転）で表す

### `knowledge_insights`

- ナレッジごとの「自分にとってどう役立つか」の付箋（示唆）。1ナレッジに複数、本文は1〜1,000文字
- 出題・採点・定着間隔の計算には一切使わない。`pick_quiz`・`record_answer`・クイズAPIから参照しない
- 他: `id`, `knowledge_id`（ナレッジ削除で連動削除）, `body`, `created_at`, `updated_at`

### 示唆の問いグループ

- `insight_groups` は自分で付けるテーマ名と、先に思い出すための `guiding_question` を保持する
- `insight_group_members` は `knowledge_insights.id` とグループの多対多の所属だけを保持する。示唆本文は複製しない
- グループ削除では所属だけを消し、示唆本文を残す。示唆削除では所属を連動削除する
- グループを閲覧・整理しても `quiz_log`、習熟度、次回復習時刻を更新しない
- タグ別画面は既存の `knowledge.tags` を厳密一致で集計し、タグなしも表示する。タグの一括補完は行わない

### 整理ページ（問い・示唆・タグ）

- `?view=organize&tab=questions|insights|tags&question=<id>` の1ページで、問い・すべての示唆・タグをタブで切り替える。
  旧URLの `?view=insights` は問いタブ、`?view=tags` はタグタブで開く
- 画面上でカテゴリ＝分野、タグ＝分野の中の小分類や出典、問い＝分野をまたいで示唆を束ねるもの、と使い分けを示す
- 問いの状態（`useInsightGroups`）はAppで1つだけ持ち、整理ページ・ナレッジ詳細・採点結果で共有する
- 示唆を書く欄では任意で問いを選べる。示唆を保存してから所属を追加し、所属だけ失敗したら示唆を二重登録させず、
  後から「問いに入れる」でやり直してもらう
- 既存の示唆は「問いに入れる」から既存の問いへ追加するか、その場で新しい問いを作って入れる
- 示唆には所属する問いのチップを表示し、押すと整理ページのその問いを開く
- AIまとめ（`/api/insights/analyze`）は各テーマに `guiding_question`（問い文の下書き、欠ければ空文字）を返す。
  テーマごとの「この問いとして保存」で、テーマ名と問い文を直してから問いを作り、根拠の示唆をまとめて入れる。
  まとめ結果そのものは保存しない

### DBアクセス

Cloudflare APIはSecret keyでSupabase REST APIを呼ぶが、許可するのは次だけ。

- `GET /api/knowledge`: 明示した列。`status=active|archived|all` と制限付きページング
- `POST /api/knowledge`: 検証済みの編集可能項目だけで新規登録
- `PATCH /api/knowledge/:id`: UUIDと`content_version`で特定した1件の編集、アーカイブ、復元。
  競合時は409で止め、後勝ち上書きをしない
- `GET /api/quiz-log`: 明示した列を新しい順に制限付きページング
- `GET /api/mastery-history`: 習熟度履歴の明示した列を古い順に制限付きページング
- `GET /api/speaking-practice`: 指定期間の英会話練習履歴を新しい順に取得
- `POST /api/speaking-practice`: 検証済みの1練習を`attempt_id`で冪等記録
- `POST /api/inbox`: 採点結果から「あとで深掘り」したい点を`idea_inbox`へ1件登録する（`status=pending`、
  `source=knowledge-quiz`）。出典ナレッジはIDで引き直してタイトルを添え、他の列や任意内容は受け付けない
- `GET /api/insights`: 示唆の明示した列を新しい順に制限付きページング
- `POST /api/insights`: 存在を確認したナレッジに示唆を1件追加
- `PATCH /api/insights/:id` / `DELETE /api/insights/:id`: 示唆1件の編集・削除。編集は`updated_at`で競合を検出して409
- `POST /api/insights/analyze`: 新しい順に最大300件の示唆とナレッジ名だけをClaude APIへ送り、複数のナレッジに
  共通するテーマを返す。根拠IDは渡した示唆に限り、結果は保存しない
- `GET/POST /api/insight-groups`、`PATCH/DELETE /api/insight-groups/:id`: 手動で問いグループを取得・作成・編集・削除する。編集・削除は `updated_at` で競合を検出する
- `GET/POST/DELETE /api/insight-group-members`: 示唆ID単位の所属を取得・追加・解除する。示唆本文には触れない
- `POST /api/quiz/start` / `POST /api/quiz/grade`: 以前の都度出題・都度採点のAPI。画面からは使わない
  （復習画面は問題キューへ移行済み）。knowledge-quizスキルの扱いが決まるまで残している。
  以下はその仕様。
- `POST /api/quiz/start`: `pick_quiz` RPCで出題候補を取得し、Claude APIで問題文を生成して返す。
  `categories`（登録済みカテゴリ名の配列。空配列は全カテゴリ）、`limit`、`format` で絞り込む。
  `excludeIds`（バックグラウンドで採点中のナレッジID、最大60件）は選定関数へ渡さず、その件数だけ多めに
  選んでからサーバー側で除く。全件が採点中なら `reason: "in_grading"` の空応答を返す
- `POST /api/quiz/grade`: 署名済み出題トークンと`knowledge`を照合してClaude APIで採点し、
  `record_answers_batch_once` RPCで出題nonceの重複を原子的に判定・一括記録。結果画面で習熟度・
  優先度の変更とアーカイブを安全に行えるよう、記録後の`mastery`・`priority`・`content_version`・`next_review_at`・定着／再学習状態も返す

- `GET /api/review-queue/status`: 出題待ち・採点待ち・採点エラー・未確認・生成を保留中（`generation_held`）の件数、
  上限到達、直近のバッチ結果
- `GET /api/review-queue/generation-holds`: 問題を作れず保留中のカード（タイトル・理由・最後の問題文・次の挑戦時刻）
- `POST /api/review-queue/serve`: 期限が来た出題待ちの問題を優先度順に返す（`limit`、`categories`）。正解は返さない
- `POST /api/review-queue/answer`: 回答を受け付け、想定解を返す。四択と無回答はAIを呼ばずにその場で記録して結果も返し、
  それ以外は採点待ち
- `POST /api/review-queue/retry`: 採点エラーの回答を採点待ちへ戻す
- `POST /api/review-queue/discard`: 出題待ちのおかしな問題を取り下げる
- `POST /api/review-queue/confirm`: 採点結果（`quiz_log_ids`）を確認済みにする
- `POST /api/review-batch/generate` / `grade`: 生成・採点バッチ。pg_cronからは `X-Review-Batch-Token`、画面からは
  同一オリジンと `X-Dashboard-Action: review-queue` で受け付ける。ミドルウェアがBasic認証を省くのは、合言葉が一致した
  この2つのPOSTだけ。生成はキューが上限なら、採点は採点待ちがなければAIを呼ばない。採点で再学習に入った回答があれば、
  再学習分だけを続けて生成する（`after_grade`）
- 出題・採点のプロンプト、形式の決め方、検証、q値の補正は `_shared/questionGeneration.ts`・`_shared/answerGrading.ts` に
  集約し、都度出題（`api/quiz/*`）とバッチの両方が使う。片方だけ直さない

クイズAPIはブラウザにも `knowledge` の列を素で返さない。`start` は
`{ id, question, format, choices, token }` だけ、`grade` は採点後なので `title` と模範解答を返す。
`choices` は四択のときだけ入り、どれが正解かは返さない。正解選択肢は平文でトークンへ入れず、
回答照合用HMACだけを保持する。`token` はID・問題文・形式・選択肢をHMAC署名し、採点要求から
同じ値を自己申告させない。

一覧APIの `limit` は1〜1,000、`offset` は0以上に限定し、応答は
`{ items, total, limit, offset }` とする。ブラウザ側は全ページを取得し、固定件数で
黙って切り捨てない。任意テーブル、任意クエリの追加は禁止。移行完了後、
`supabase/disable-anon-access.sql` でanon権限を外す。

### 復習クイズのDB関数

定着間隔、再学習、昇格、期限前回答の判定は全てDB関数側にあり、Functions側やブラウザ側で再実装しない。

- `pick_quiz(p_include, p_exclude, p_limit, p_include_mastered=false)`: 出題候補を返す
- `record_answer(p_knowledge_id, p_quality, p_verdict, p_note, p_format)`: 採点1件を
  SM-2更新・knowledge更新・quiz_log挿入までまとめて確定する（SECURITY INVOKER）
- `record_answers_batch(p_answers jsonb)`: `record_answer` を `cross join lateral` で
  複数件まとめて1SQLで呼ぶだけの薄いラッパー。採点全体の原子性のために追加した
  （SM-2ロジック自体は持たない）
- `record_answers_batch_once(p_answers jsonb)`: 対象行を安定順でロックし、
  出題nonceの重複判定と未記録分の`record_answer`を
  同一トランザクションで行う
- `get_recent_quiz_notes(p_knowledge_ids, p_per_item=2)`: 選択された各項目について直近N件を返す
- `consume_dashboard_handoff_nonce(p_nonce, p_expires_at)`: SSO引き継ぎnonceを一度だけ消費する
- `prune_dashboard_handoff_nonce()`: 期限切れから1日を過ぎたnonceを削除する。pg_cron `prune-dashboard-handoff-nonce` が毎日3:20（JST）に実行
- `jst_today()`: 日本時間の今日。日付判定は必ずこれを経由する

q別の基準間隔はq0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上。
q0〜q3の定着保持率は40%・55%・70%・85%で、1再学習エピソードに1回だけ適用する。
期限到来の自由記述q4/q5は2倍/2.8倍へ伸ばし、次回間隔には優先度の倍率を掛ける。
未出題カードが日次キューに入るのは1日 `review_new_cards_per_day()`（10件）まで。当日初回回答した件数が枠を使い、
超えた分は `get_daily_review_status` の `remaining` に数えず `new_held` として返す。
DB関数は `supabase/migrations/` で管理する。アプリ側の事前SELECTだけで重複や再復習待機を防ごうとせず、
必ず `record_answers_batch_once` の行ロック下で判定する。

### クイズの出題・採点品質

チャットの `knowledge-quiz` スキルと同じ体験になるよう揃えている。ここを削ると露骨に質が落ちる。

- 出題・採点とも `claude-sonnet-5-5`（`anthropicClient.ts` の `QUIZ_MODEL`）。問題文と講評が成果物そのものなので
  軽量モデルに落とさない
- JSONは構造化出力（`output_config.format` の `json_schema`）で受け取る。Sonnet 5.5は強制ツール呼び出し
  （`tool_choice` の `tool` / `any`）を400で拒否するため使わない。構造化出力が受け付けない制約（数値の範囲、
  文字数、`maxItems`、2以上の `minItems`）は `toStructuredOutputSchema` が外すので、件数や範囲は受け取った後に
  必ず検証する（四択の選択肢数、q値の範囲、引用の件数など）
- `max_tokens` は16,000。Sonnet 5.5は思考トークンも `max_tokens` に含まれるため、30問だと8,192では足りない。
  `stop_reason` が `max_tokens` の応答は途中までのJSONしか返らないため、
  「応答形式が正しくない」ではなく打ち切りとして返す。原因を取り違えさせないこと。`refusal` も理由つきで返す
- 出題時はカテゴリ・タグ・`times_asked` に加えて、直近2回分の `note`（前回どこでつまずいたか）を
  渡す。noteは次回出題に効かせるために書かせている
- 出題順は同じカテゴリが連続しないよう入れ替える。並べ替えるのは順番だけで、`pick_quiz` が
  選んだ問題の差し替えはしない
- 出題形式は `おまかせ` / `一問一答` / `四択` / `記述説明` / `産出` から選ぶ。`おまかせ` は未学習・
  低定着・再認を四択、次を一問一答にする。習得中・定着は、単一事実なら一問一答、理由・比較・
  手順なら記述説明、適用可能なら産出をAIが許可候補から選ぶ。語学カテゴリは産出を使う。
  値はスキル側と揃える。揃えないと `quiz_log` の履歴が形式で分断される
- 四択の選択肢はAIに4件作らせ、サーバー側で並べ替えてから返す。件数・重複・空文字が崩れた項目は、
  その項目だけをもう一度まとめて生成し直す（1回だけ）。それでも崩れていたら黙って自由記述に
  落とさず502にする。正解選択肢のHMACを署名トークンへ保持し、採点時はサーバー側の一致判定を
  Claudeのq値より優先する。正解でも当て勘が混じるぶんq値の上限は4
- 採点要求は `{ token, answer }` のみ。ID・形式・問題文・選択肢は署名済みトークンから復元し、
  ブラウザによるq値上限回避や問題文差し替えを許さない
- 採点は署名済みの出題時問題文を使い、「この問いに答えられたか」で採点する。
  問題文を渡さないと、空所補充に単語で答えただけで「説明が足りない」と減点される
- 語学の空所補充では、単数・複数、時制、活用などの語形差を機械的に別語や0点扱いしない。
  完成文が問いの意味を満たして自然なら正解とし、登録済みの参考解答より一般的な表現も許容する
- 採点は `correct_answer`（模範解答）と `explanation`（この回答への講評）を分けて出させる
- 採点では `answer_quotes` にユーザーの回答から1〜3件そのまま引用させ、サーバー側で `user_answer`
  と照合する（NFKC・小文字化・空白除去のうえ部分一致）。q値が5未満なら減点の根拠になる箇所を
  引用に含めさせ、講評でユーザーの回答に言及するときもこの引用を使わせる。一致しない項目は採点を
  捨て、該当項目をまとめて再採点する。それでも残った項目は1問ずつ再採点し、一致しなければ記録せず502。
  この照合を外すと、of と誤答したのに「for を即答できている」と講評して正解になる事故と、
  書いていない「前提作業」を書いたことにして減点する事故が戻る
- 無回答（空文字）はAIの判定に関わらずq0・不正解で記録する。空欄のまま提出した項目を進めない
- 復習画面（`ReviewView` / `useReviewSession`）はAIを呼ばない。問題数やカテゴリは選ばせず、キューの上から
  30問ずつ受け取って解き続け、使い切ったら次を受け取る。いつでも「終了する」で終えられ、答えた分は残る。
  回答した直後に答え合わせを出す（四択・無回答は確定した結果と講評、それ以外は想定解）。AIの採点と講評は学習ログで見る。
  スキップした問題は出題待ちのまま残るので、その回では手元で除き、次回また出す。「おかしな問題を報告」で取り下げられる。
  終了画面と学習ログから採点・生成バッチを手動で動かせる
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
    useReviewSession.ts     キューから出題された問題への回答の流れ
    useReviewQueueStatus.ts 出題待ち・採点待ち・未確認の件数
  components/               表示、編集、詳細、アーカイブ復元、復習画面（ReviewView）、学習ログ（LearningLogView。
                            採点待ちと採点結果への操作は ReviewLogParts）、
                            英会話練習画面（SpeakingPracticeView）、整理ページ（OrganizeView）と
                            その各タブ（InsightGroupsPanel / InsightListPanel / TagGroupsPanel）
functions/
  _middleware.ts            全リクエストのBasic認証とセキュリティヘッダー
  _shared/supabaseRest.ts   Supabase REST API / RPC呼び出し
  _shared/knowledgeValidation.ts 書き込み要求と入力の検証
  _shared/quizValidation.ts クイズAPIの要求検証
  _shared/anthropicClient.ts Claude APIを構造化出力（JSONスキーマ）で叩く共通クライアント
  _shared/quizSession.ts    クイズ出題トークンの署名・検証
  api/knowledge.ts          ナレッジ一覧・新規登録API
  api/knowledge/[id].ts     ナレッジ編集・アーカイブ・復元API
  api/quiz-log.ts           クイズ履歴読み取りAPI
  api/quiz/start.ts         復習クイズの出題API
  api/quiz/grade.ts         復習クイズの採点・記録API
  api/speaking-practice.ts  復習とは独立した英会話練習履歴API
  api/inbox.ts              採点結果から深掘りしたい点をidea_inboxへ登録するAPI
  api/insights.ts           示唆（付箋）の一覧・追加API。insights/[id].ts で編集・削除、insights/analyze.ts でAIまとめ
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
- 復習画面の出題カテゴリは登録済みカテゴリから組み立てる。固定の選択肢を持たない。
- ダークモードは `public/theme.js`（Hubと共通、`dashboard-theme` をlocalStorageに保存）が
  `<html data-theme>` を自動/ライト/ダークで決める。CSSはライトだけを書き、変更後は `npm run theme` で
  `src/index.dark.css` を再生成する（手で編集しない。古いとテストが落ちる）。rechartsの色は
  `index.css` 末尾の `:root[data-theme="dark"]` ルールで上書きする。
- `KnowledgeDetailModal` は `onEdit` / `onArchive` を省くと読み取り専用になる。
  学習ログの採点結果から出典を開くときは読み取り専用で開く。
- 採点画面にあった操作（習熟度・優先度の変更、確認ダイアログつきのアーカイブと元に戻す、示唆、あとで深掘り、
  詳細表示）は学習ログの各採点結果（`ReviewResultActions`）にある。分類は変更させない（編集画面で行う）。
- 学習ログの「問題を作れなかったカード」（`GenerationHoldsPanel`）は、出典を直してもらうための欄なので、
  「ナレッジを開く」は編集できる詳細（Appの `selected`）で開く。採点結果の出典（読み取り専用）とは分ける
- 学習ログで「問題と講評を見る」を開いた採点結果は確認済みになる（`confirm_review_results`）。
  一覧からは消さず、その場では「未確認」の印だけを外す

## デプロイと閲覧制限

モノレポ `personal-dashboard` の `apps/knowledge` をCloudflare PagesにGitHub連携でデプロイする
（Root directory `apps/knowledge`）。mainへのpushで本番が更新される。
本番: https://knowledge-50b.pages.dev

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
