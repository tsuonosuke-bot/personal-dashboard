# 本番レビュー Issue #230–#233 実装設計

状態: エージェント①の設計を、エージェント②が既存コード・SQL・運用文書と照合して修正済み。実装へ進める確定版。

基準: GitHub main `8e1c9cfb96de80d4ae8089611290ea4c34e1a37e`、Issue #230/#231/#232/#233 の2026-10-23時点の本文。対象はこの4件だけとする。

## 1. 実査結果と守る既存仕様

| 領域 | 現行コード・仕様 | 設計上の制約 |
| --- | --- | --- |
| Knowledge取得 | `src/lib/api.ts` の `getAllPages` は1,000件ずつ全ページを取得する。件数があるときは残りのページを並列取得し、不明時も末尾まで読む。`LearningLogView` の30件表示は取得上限ではない | 既存の全件取得を残し、読込途中・取得失敗時に不完全な一覧を全件と称して処理しない |
| 確認 | `review-queue/confirm.ts` → `confirm_review_results(bigint[])`。200件上限。更新対象は `review_queue_id is not null and confirmed_at is null` だけ | 採点結果の `confirmed_at` だけ変える。回答・判定・習熟度・次回復習を変更しない |
| 学習ログの絞り込み | `buildLearningLog` は期間（JSTのasked_on）、category、verdict、確認状態を適用。削除済みナレッジの履歴を捨てない | UIの検索結果と一括対象で同じ集合を使う。ページ番号・表示件数は無関係 |
| 週次レビュー | `public/projects/model.js` の `reviewData` はタスク期限超過・要確認・待機/保留の見直し日・停滞・今週完了を集計 | `pending` はユニークなProject数ではなく、各欄の見直し項目数の合計。既存の意味を保つ |
| Project | `docs/projects-operation.md`、`project_actions_one_next_idx`。Next Actionは最大1件。Next完了時は「次を設定/Project完了/待機/保留」を必ず選ぶ | ToDoから完了しても、この分岐を飛ばしてNextだけ消す動作にしない。再開時に勝手にNextを増やさない |
| ToDo / Calendar | `scheduledActions.ts`、`calendarSync.ts`。ToDoが実行状態を、Google Calendarが日時を管理。既存ToDoは手動ルート由来とGoogle取込由来の2種類 | 完了・見送りはCalendarを削除/完了にしない。日時変更は同じeventをETag付きで変更。取消/削除済みの再作成は既存の明示操作だけ |
| 楽観ロック | Project RPCはAction/Projectのupdated_at、ToDoはstatus/updated_atとCalendar ETagを照合。PostgreSQLの小数秒をそのまま返す | 別画面の変更を無言で上書きしない。409時は入力を保持して最新状態を確認させる |
| Inbox振り分け | `inboxRouting.ts`、`route_inbox_item`。期待するcontent/resultとpending状態の照合、UUID冪等キー、内部宛先は同一DB処理でInbox完了 | SF6保存とInbox完了を別々のブラウザ要求にしない。成功応答の取りこぼしでも二重作成しない |
| SF6 | `sf6.ts` のFieldSpecが入力検証・列変換の正本。`sf6/editor.js` が既存フォーム。手順は `sf6_save_sequence` が親/始動/結果を原子的に保存 | メモからキャラ/有利F/始動/技を推測して確定しない。既存フォームと同じ検証を再利用する |
| UI | root/Hub AGENTS、Knowledge CLAUDE。モバイル優先、説明はhelp、ライトCSS→生成ダークCSS | ヘルプと運用資料を更新し、390px程度の画面とデスクトップで操作を確認する |

## 2. #230 検索結果全件の確認済み化

### 2.1 利用者の動作

1. 期間・カテゴリ・判定・確認状態を選ぶ。
2. 「検索結果の未確認 **N件すべて**を確認済みにする」を押す。対象は全ページで、現在の30件だけの操作は設けない。
3. 「確認中 X / N件」の進捗を表示する。実行中は同じ操作、対象が変わるフィルター操作、別の確認要求の重複送信を防ぐ。ページ移動は許可しても対象を変えない。
4. 成功した分は即座に確認済みへ表示更新する。部分失敗なら「X件確認済み・残りY件。残りを再実行」で続けられる。
5. 最終的なサーバー確認が完了した場合だけ全件完了とする。再読込後もDBのconfirmed_atで正しい状態が出る。

### 2.2 集合と実行の設計

- `entries` から `review_queue_id !== null && confirmed_at === null && !confirmedIds.has(id)` を選び、一意化したID配列を開始時に固定する。開始後に採点された新規行を勝手に追加しない。
- `rows`、page、pageSizeからIDを選ばない。既存の `getAllPages` の失敗は失敗として扱い、部分配列を返して継続しない。
- Reactのstateだけでなく同期的なref/実行コーディネータで二重クリックを防ぐ。単票の「開いたら確認」と同じコーディネータを通す。
- DOMに依存しない小さなバッチ実行関数へ分離する。入力は固定ID集合、200件送信関数、進捗通知。成功したIDを1チャンクごとに反映し、エラーまでの進捗を返す。UIの責務は対象抽出・進捗表示・再試行だけにする。
- `loading` / `error` がある状態では全件操作を無効にする。再取得成功後に新しい検索結果の件数で再開する。

### 2.3 API・DB

現行RPCは新しく確認された件数だけを返す。同時に別画面で確認された場合は0件でも成功になり、現在のclientは不正な応答も0にしてしまう。このため「要求したID数」を成功件数と見なさない。

- `/api/review-queue/confirm` は既存RPCを実行した後、同じ最大200 IDについて `id,confirmed_at,review_queue_id` を読み、確実に確認済みのIDを応答へ付加する。例: `{ confirmed: 198, confirmedIds: [全て確認済みと検証できたID] }`。他画面で既に確認されたIDもconfirmedIdsに含められる。
- 従来の `confirmed` を残し、既存の単票確認呼び出しを壊さない。全件処理には厳密に応答を検証する詳細版のclient関数を使うか、互換ラッパーを残して型を追加する。
- 未存在・対象外のIDは確認済みと偽らない。応答で未解決IDがあれば最新ログを再取得して「削除等で対象から外れた件数」と「残る未確認」を分ける。通信結果が不明なチャンクも再取得で解決し、未確認だけ再送する。
- 全件終了/部分失敗の後、`onReload` で履歴とHub等の未確認件数を更新する。再取得失敗時に全件完了とは表示しない。完了済みIDの手元の表示は維持する。
- 現行 `useKnowledgeData.reload` は例外を内部で捕捉し、`reloadAfterReview` も成功判定を返さない。したがって単に `await onReload()` が終わったことを再取得成功の証拠にしない。一括処理の呼出元へ再取得の成否と取得したログを返すか、確認用の厳密な再取得関数を設ける。取得できた最新ログで固定ID集合を照合して完了・対象外・残り未確認を確定する。初回読込など既存の呼出元が未捕捉例外を出さない互換性も保つ。
- DB migration不要。`confirm_review_results` の冪等なUPDATEと既存の200件制限を維持する。

### 2.4 受け入れ条件と証拠

| Issue条件 | 必要な検証 |
| --- | --- |
| 30件表示で1,098件全件 | 1,098未確認+条件外+確認済みのfixture。UIは30件、送信は200×5+98。全1,098 IDを1回ずつ処理し条件外0件 |
| 条件と対象一致 | 各期間/JST境界/category/verdict/確認状態の組み合わせを同じ `buildLearningLog` で検証 |
| 上限で切らない | APIページ1,000超、200境界、空集合、exact boundary。既存全件取得のテストも確認 |
| 部分失敗と再実行 | 2チャンク成功→3回目失敗、応答前タイムアウト、他画面の同時確認、二重クリック、再取得失敗、再読込を検証 |
| 変更範囲/UI | `confirmed_at` 以外不変をAPI/SQLで確認。スマホ/PCで長い全件ボタンと進捗が読める |

AI判断: 「ページ全件」操作は追加しない。途中成功を取り消さず残りだけ処理する。検索条件は実行開始時に固定し、実行中の新規採点を混ぜない。

## 3. #231 Project目標日の期限超過

### 3.1 Model・UI

- `reviewData` に `targetOverdue` を追加する。open集合（active / waiting / on_hold）から `targetOn && targetOn < todayTokyo()` を選ぶ。`targetOn` 昇順、同日はidで安定整列する。
- 新しい欄「目標期限を過ぎたProject」をタスク期限欄の前に出す。Project名、目標日、`dayDiff(targetOn,today)`日超過、進行中/待機/保留を表示する。既存の `data-detail` でProject詳細を開く。
- 各Projectはこの欄では1回だけ表示する。他の理由にも該当すれば別欄にも表示する。合計は各欄の項目数で、重複Project除外の新しい集計へ変えない。タブ/上部を「見直し項目 N件」と明示し、helpにも集計の意味を書く。
- pendingへtargetOverdue.lengthだけ加算する。既存5欄の対象・順序・集計内容は維持する（新欄以外）。
- 今日・未来・未設定・completed/droppedは対象外。時刻を含まない日付同士で比較するため、UTC時刻に引きずられない。
- API・DB migration不要。詳細保存後は既存load/renderを通して再計算する。

### 3.2 検証

`projects`の全status×昨日/今日/明日/未設定、UTCでは前日だがJST翌日の境界、最近更新・タスク期日なしでも表示、古い順、複数理由の合計、期限変更/完了後の除外を実際のmodelで検証する。描画した行から詳細を開くUI、スマホ/PCを確認する。

AI判断: Projectの目標日とAction期日は別の見直し理由として残す。合計をユニークProject数に変えると既存の「期限超過タスク複数件」と矛盾するため、項目数の意味を明確にする。

## 4. #232 ToDoとProject Actionの関連付け

### 4.1 正本と関係

| 情報 | 正本と扱い |
| --- | --- |
| 同じ行動という判断 | 利用者が選んだ既存ToDoと既存Project Actionの1対1リンク。タイトル一致で自動処理しない |
| 実施済み/未実施/見送り | scheduled_actions.status。Project側のdone/cancelledは同期された状態 |
| Project内の順番/Next/待機/マイルストン | project_actions / projects。ToDoがpendingでもNext/queued/waitingのどれかはProjectが決める |
| 日時 | 既存のToDo/Google Calendar。Projectの関連Actionは同じscheduleを表示する。Projectの期限入力でCalendarと別の日を設定させない |
| 名前/補足 | 元の両レコードを保持。片方の名称をもう片方へ自動上書きしない |

新規 `project_action_todos`:

- `project_action_id bigint primary key references project_actions(id) on delete cascade`
- `scheduled_action_id bigint not null unique references scheduled_actions(id) on delete restrict`
- `created_at timestamptz not null default now()`
- 必要なら `idempotency_key uuid unique`（同一リンク再送は同一対なら成功、他の対なら409）。RLS有効、ブラウザ向けpolicyなし。操作RPCはservice_roleだけ。
- 既存Project Action / ToDo / Calendar / Wantの新規作成は一切しない。リンク解除は関係行だけを消す。

### 4.2 利用者の動作

- ToDo詳細に「Projectタスクと紐づける」。Projectとタスクを手動選択し、両方の名称・状態・現在の日時・リンク後の状態を確認して保存する。
- Project Actionのメニューにも「既存ToDoと紐づける」。同じAPIとフォーム用データを使用する。既に他と関連済みのものは選択できず、競合時にも409を返す。
- リンク後、ToDoにProject名/タスク名と詳細リンク、Project ActionにToDoの日時/実行状態/ToDoへのリンクを表示する。解除ボタンは双方に設ける。
- Projectからの「日時変更」は関連ToDoの日程フォームへ遷移する。`/compass/?view=todos&id=<id>` の既存深いリンクを使い、同じCalendar ETag付き更新を実行する。日程を二重入力させない。
- 関連ToDo/元Inboxの相互参照には共通helperが生成する`history=1`付きの詳細URLを使う。完了/整理済みの詳細を開ける一方、通常の古いHub/Todayリンクは従来の終了済みフォールバックを保つ。対象をInbox/ToDoの参照に限定し、Wantsやアーカイブ用の変更・再開機能へは広げない。
- リンク時にProject側へ個別設定済みのstart_on/due_onは消さず保存する。リンク中の表示/ソート/タイムライン/期限レビューにはToDoの実効日付を使用する。解除確認には「解除後のProjectの日付」を表示し、解除すると保存されていた独立した期日に戻る。両記録とCalendar予定は残る。
- 完了済み/見送りToDoや完了Actionを除外することで要件を狭めない。状態が異なる場合もプレビューでToDoの状態に揃えることを示す。Nextが終わるリンクなら下記のNext完了分岐も同時に求める。completed/droppedのProjectへの新しいリンクは拒否し、進行中のProjectを選ぶよう示す。現行には終了済みProjectの再開操作がないため、存在しない再開画面へ誘導しない。

### 4.3 APIと読込

- 新API `/api/project-action-todos`。GETはリンク/選択候補を認証内で返す。POSTはlink、DELETEはunlink。既存のsame-origin、JSON、操作ヘッダー、長さ・ID・日時の検証パターンを踏襲する。
- 書込の期待値: `actionId`, `actionUpdatedAt`, `projectUpdatedAt`, `todoId`, `todoUpdatedAt`, `todoStatus`、期待するリンク先（未リンクならnull）。Nextを終了する場合は既存と同じresolution（次のAction、Project完了、待機/保留の詳細）を送る。unlinkにも両側の期待値を送り、終了済みProjectの解除は許可する。
- 同一対への再送は成功扱いにできるが、他のリンクや異なるsnapshotへ再利用する冪等キーは409。二重クリック時に副作用を増やさない。
- `loadProjects` のActionへ `linkedTodo`（id/title/status/schedule/updatedAt/calendarState/calendarUrl等）を追加。`listScheduledActions` 側へ `linkedProjectAction`（projectId/title/actionId/content/status/updatedAt等）を追加する。
- Google Calendarのlive snapshotを使う既存 `listScheduledActions` のロジックを再利用し、Projectsだけ古い日時を正本として表示しない。Calendar取得不可の場合は既存同様、前回日時と取得不可を区別する。リンク候補の一覧は1,000件の固定上限で切らず、必要な全ページを取得する。
- Project Actionの保存済み `startOn` / `dueOn` とCalendarから得た実効日付を別プロパティで返す。表示・期日順・週次レビュー・HubのAction表示は同じ実効日付を使い、編集/解除は保存済み日付を使う。Calendar取得不可なら前回日時の表示と警告を保ち、未設定と偽らない。リンクが0件のProject読込では不要なGoogle要求を追加しない。
- 関連付けのデータ取得/検証・状態対応表は `_shared/projectActionTodos.ts` 等にまとめる。ProjectsとscheduledActionsが互いを循環importしない構成にする。必要ならCalendar snapshot読込を独立ヘルパーに抽出する。

### 4.4 状態遷移と既存完了動作

| ToDo操作 | 関連Project Action | Project自体 |
| --- | --- | --- |
| complete | done、completed_atはToDoのものと一致 | queued/waitingなら既存の単純完了。nextなら必ず既存4分岐を選び同じtransactionで処理 |
| skip | cancelled、completed_at=null | nextなら同じ4分岐を選ぶ。実施していないのでdoneとはしない |
| reopen | queued、completed_at=null、waiting_for=null、末尾順序 | 勝手にNextへ昇格しない。Projectがcompleted/droppedなら解除してからToDoを再開する選択を示し、部分更新しない |
| reschedule / recreate | Projectは同じToDoのscheduleを表示 | Projectの状態・Nextは変えない |

- Projectからdone/cancelledにする場合も、ToDoをそれぞれcompleted/skippedへ原子的に更新する。ToDoのnoteやCalendarには触れない。
- linked Actionがdone/cancelledなら、Project側にも「未実施へ戻す」を出して同じreopen処理を使う。終了済みProjectでは解除してからToDoを再開する案内と解除操作を出し、通常のreopenを無効にする。状態の正本がToDoでも、利用者に同じ状態を両画面で更新させない。
- pendingのToDoとopen状態のActionをリンクするときは、Actionのnext/queued/waitingを保つ。ToDo pendingとAction done/cancelledのリンクはqueuedへ揃える。completed/skippedのToDoへリンクする場合はdone/cancelledへ揃える（Nextならresolution必須）。保存前の差分表示で利用者が判断する。
- Project側の内容/マイルストン編集は引き続き可能。関連Actionのstart/dueの直接編集は拒否してToDoへ誘導する。ピン留め/並替えはpendingの関連Actionに限り既存規則で可能。
- Next完了の既存画面とToDo側の必要な入力は、既存resolution入力モデル/検証を共有する。ToDo側で完了を押しただけで次の行動を自動選択しない。
- Nextのskipに対応する共通DB helperは終端状態done/cancelledと既存resolutionを受ける。既存 `resolve_project_next_action` はdoneを渡す互換入口にし、従来の未リンク操作は同じ動作を保つ。

### 4.5 原子性・競合・ロック順

**ブラウザからToDoを更新してからProjectを更新する二段階同期、及び相互更新する双方向triggerは採用しない。** 中間失敗やロック順の逆転を避ける。

- 新しいリンク状態更新RPCを作り、関連ToDoのcomplete/skip/reopenはそのRPCでAction・ToDo・必要なProject resolutionを一括確定する。未リンクの既存ToDoも現行CASを維持する。
- 未リンクToDoのcomplete/skip/reopenも、ToDoをロックした後に「現在も未リンク」を検証するRPCへ通す。リンク読込後の古い判定だけで従来のREST PATCHへ分岐しない。途中でリンクされた場合は409にし、ToDoだけ完了する取りこぼしを防ぐ。link/unlink時もAction・Project・ToDoのupdated_atを更新して、古い画面からの書込をCASで拒否する。未リンクとしてToDoをロックしたRPCがその後Actionを取りに行くことはしない。
- 既存 `resolve_project_next_action` と `update_project_action`（最新版はmilestones migration）を関連対応へ更新し、リンクがある場合は同じtransactionでToDo側を同期する。古いclientからlinked Actionにsnapshot不足の更新が来たら再読込を求める。未リンクには既存契約を維持する。
- 既存RPCの引数を変えるために同名の曖昧なoverloadを増やさない。旧7引数Action更新/既存Next resolverは未リンク用の互換入口として残し、linked用は両側snapshotを受ける別名RPCまたは一意に解決できる入口にまとめる。旧入口もロック後にリンク有無を検証してsnapshot不足を409へ変換し、linked更新の抜け道にしない。共通helperもPUBLIC/anon/authenticatedから実行できないよう権限を明示する。
- 全リンク操作は **Projectの全Actionをid昇順 → Project → ToDo → 関係行** を基本順として統一する。done/cancelledのActionとpending ToDoを結ぶ場合もあるためopenだけに限定しない。現行 `update_project_action` のAction→Project順を維持して対象を全Actionへ揃える。既存resolverの単一Action→Project経路も同じ順に揃える。
- `update_project_milestone` は現行でProjectを先にロックし、deleteで所属Actionを書き換えるため逆順になる。このRPCもActionをid順にロックしてからProject/マイルストンを扱う。resume・単票/一括Action追加・関連アイテムのAction化・既存ProjectへのInbox/Want追加もロック対象表と順序を一覧でレビューする。Projectを先に保持する経路から既存Action/ToDoへ後からロックを取りに行かない。新規行のINSERTだけの既存経路を残す場合は、既存Actionの書換えがないことと一意制約/FKの待機が逆順を作らないことを記録する。
- ToDoから来たRPCは最初にリンク先idをロックなしで調べ、同じ順でロックし、ロック後にリンク先/各updated_at/statusを再検証する。調査後にlink/unlinkされた場合は409。未リンク扱いでToDoをロックした後にActionを取得し直して更新することはしない。
- Calendar sync/rescheduleはscheduled_actionsの日時等だけを更新し、Project Actionを更新するtriggerを作らない。Projectの日付表示は読取時の投影なので、日時同期にProjectロックは不要。
- 現行 `calendarSync.ts` はGoogle取消のpending取込ToDoをDELETEする。リンク済みToDoは削除せずcalendar_state=cancelledとして残し、利用者が完了/見送り/解除を判断できるようにする。未リンクToDoは従来どおり削除する。候補計画時だけのリンク確認では競合に弱いため、DELETE部分は小さなRPC（例 `delete_unlinked_scheduled_actions`）で対象ToDoをid順にロックし、その時点のリンクとpending状態を再検証する。リンクありは取消状態へ更新、未リンクpendingだけ削除する。Project/Action/リンク行を更新・ロックしないので上記ロック順と逆転しない。新リンクが先に成功した場合もFK restrictで関連ToDoの黙示削除を防ぐ。
- CalendarのETag競合と、Calendar更新成功後のDB CAS失敗は現行どおりエラーを返し、最新Calendar/ToDoを再取得する。ここで別eventを再作成しない。完了/見送りはCalendar APIを呼ばない。
- Project Action削除時はFKでリンクだけ解消する。関連ToDoの削除は解除を先に要求する。読込中に消えた場合のUIもnull/削除済みで扱い、存在しない先を無言で再作成しない。終了済みProjectのリンク解除は許可し、そこから未リンクのToDoを通常どおり再開できる。

### 4.6 受け入れ条件と証拠

| Issue条件 | 必要な検証 |
| --- | --- |
| 手動リンク・双方表示 | 両画面開始、名称が異なる組合せ、同名の別組合せ、キャンセル無変更、深いリンクをブラウザで確認 |
| 完了/日時一貫 | ToDo→Project、Project→ToDoのcomplete/skip/reopen、next/queued/waiting、状態不一致リンク、解除後の独立管理 |
| Calendar不変・競合 | 完了/skipにGoogle要求0件。rescheduleは同じid+If-Matchで1回。ETag409/412、DB競合、取消/削除後の既存recreate |
| 最大1Next | Next完了4分岐全て、skip4分岐、reopenがqueued、pin/並替え/マイルストン、閉じたProjectの拒否 |
| 冪等/削除/原子性 | 同一対再送、片側別リンク、同時link/unlink/complete、未リンク読込直後のlink→complete、古いsnapshot、RPC途中失敗全ロールバック、Action削除、ToDoの削除保護、Google取消sync中のリンク競合 |
| 既存経路との整合 | マイルストンdeleteとAction更新、resume/追加/関連アイテムAction化とNext完了のロック順。linked状態のまま旧API要求が来ても部分更新しない |
| 保守性/表示 | 状態対応表を実行テスト、SQLの実DB実行。日付は全Project表示面で同じToDoを使う。スマホ/PCの選択・完了・解除 |

AI判断: 1対1に限定し、同一行動かは利用者が決める。リンク時に不一致を隠さずToDo側を正本に揃える。解除はデータ削除ではない。Next完了をToDo側の単純完了へ短絡しない。日程変更の入口は共有ToDoフォームに集約する。

## 5. #233 InboxからSF6へ引き継ぐ

### 5.1 利用者の動作・フォーム再利用

1. Inboxのクイック振り分け/整理の行き先に「SF6」を追加する。必須項目を個別確認するため一括振り分け対象には加えない。
2. 「局面」「手順（コンボ/起き攻め）」「練習メニュー」を選び、既存SF6の登録フォームへ進む。URLはInboxのIDだけを渡す（本文をqueryやlocalStorageへ複写しない）。
3. SF6側は認証済みAPIで元Inboxのcontent/result/statusを読み、元メモと登録種別の切替を表示し、`createSf6Editor` の通常のフォームへpresetを渡す。
4. 先頭の非空行を名前/タイトルの初期候補に使い、本文全体（改行を含む）をmemo/detailへ入れる。名前は各上限（局面60、手順120、練習200）に収まる候補だが、本文を切り捨てない。本文2,000文字はmemo/detailに収まる。全文は元Inboxと関連スナップショットにも残る。
5. 局面はkind=stateとしてキャラ/有利F等を利用者が入力する。手順はkind選択、キャラ/始動/レシピを利用者が入力する。自然文全体を技レシピとして確定しない。練習では任意で既存手順を選べる。
6. 登録種別を切り替えても元メモを保持する。キャンセルではInboxを未処理のまま残す。送信ボタンの直前に「SF6へ保存し、元Inboxを整理済みにします」を表示する。
7. 成功したら作成先を開く。Inboxの整理済み詳細には「SF6の局面/手順/練習を開く」、SF6側には元Inboxへのリンクを出す。削除済みの登録先にはその旨を表示する。

### 5.2 API・原子的保存

- `/api/inbox-route` の新exit `sf6` を追加する。paramsは `{expected:{content,result}, resource:'situations'|'sequences'|'drills', fields:既存SF6形式}`。`validateSf6Fields` を再利用し、許可resource以外、readonly/legacy/未知fieldを拒否する。
- SF6の受信元準備用GETは `/api/inbox-sf6-source?id=<inboxId>` 等の小さなread APIとする。pendingなら編集用snapshot、既にSF6へ保存済みなら関連先を返して重複登録画面へ進ませない。別振り分け済みは状態を明示する。本文は任意URLから取得しない。
- `sf6.ts` の列変換/手順のstarts/results変換を共有helperとして抽出する。別の大きなFieldSpecやフォームをCompassに複製しない。
- 現行editorのreadFormとserverのreadField(text)はtrimするため、引継ぎ本文が先頭/末尾改行まで保持されるよう、memo/detailだけに `preserveWhitespace` を明示する。空欄判定にはtrimを使い、有効な本文はrawを保存する。名前・キャラ・レシピ等の既存正規化は維持する。元Inbox snapshotは編集前のraw contentをそのまま保存する。古いInboxに上限を超える本文があれば初期入力を切り捨てず表示し、保存前に補足の上限と元記録が残ることを示して利用者に編集を求める。
- 新RPC `route_inbox_sf6` が **Inbox行をロック → 冪等/期待値検証 → SF6保存 → 関連記録 → Inboxをdone/result設定** を1transactionで行う。
- 手順は既存の `sf6_save_sequence(null,null,p_row,p_starts,p_results)` を呼ぶ。これによりキャラ整合、始動必須、inline局面作成、結果の制約を再利用する。局面と練習は同じRPC内で既存テーブルへINSERTする。DBのCHECKだけに依存せず、新RPCでも許可キー・resourceごとの必須項目・型・文字数・列挙値・配列件数/重複・参照先の実在を検証する。手順のstartsは1〜12、resultsは0〜12、drillのsequenceIdsは0〜8件とし、不正値をjsonb_populate_recordへ無言で通さない。通常APIのFieldSpecと共通化できる変換/検証は共有し、DB側の防御をAPIだけで代替しない。
- RPC戻り値は `inbox-route-v1` の共通fieldsを維持し、`sf6:{resource,id,url}` を追加する。既存exitは既存 `route_inbox_item` へ流し、関数本体全体の複写を避ける。
- 成功後のitem再読込が失敗しても「保存失敗」と誤って新規キーでやり直させない。共通応答の保存済みid/urlを保持し、「保存済み・表示の再読込」を提供する。

### 5.3 関連と冪等性のDB設計

新規 `inbox_sf6_routes`:

- `idempotency_key uuid primary key`
- `inbox_id bigint unique references idea_inbox(id) on delete set null`（元Inboxが将来削除されても保存済みSF6は消さない）
- `resource text not null check(resource in ('situations','sequences','drills'))`
- `situation_id` / `sequence_id` / `drill_id` は各対象へのnullable FK、`on delete set null`。
- resourceと対応しないFKは必ずnullにするCHECK。作成時は該当FKが1つ、対象削除後は0個を許す。target idの履歴用snapshotも保持し、消去後も同じ入力の再試行から再作成しない。
- `source_content text not null`、`source_result text`（保存時の元メモのスナップショット）。`request jsonb not null` またはcanonical request hash（同じ冪等キーを違う内容に使わない）。`created_at`。
- `request` は元のInbox ID、expected snapshot、resource、正規化済みの保存payloadまで含む。`source_inbox_id_snapshot bigint not null` と保存先IDの履歴値を、nullable FKと別に保持する。ID比較をnullable FKだけで行わず、元/保存先削除後も同じ入力か検証できるようにする。
- RLS有効、操作RPCはservice_roleのみ。UIへ必要な関連だけを認証済みAPIから返す。

処理規則:

- 同一キー・同一入力で既存保存があれば、その結果を再返却する。Inboxがdoneでもこの場合は成功する。
- 既存キーの照合は新規保存用のpending確認より先に行う。元Inboxや保存先が既に削除されていても原文/ID履歴/canonical requestで照合し、保存済み（対象削除済みを含む）を返す。別のInboxへ同じキーを同時送信した場合の一意制約違反も409として扱い、重複したSF6行が残らないようトランザクションを戻す。
- 同一キー・異なるInbox/種別/入力は409。異なるキーで同じInboxの保存を再試行した場合も、同一入力なら既存結果を返し、異なる入力なら409として既存先を示す。
- 新規の保存はpendingかつcontent/resultの期待値一致を必須にする。途中で他の出口へ振り分け/本文編集されたら409で全てロールバックする。
- 二重クリック/別タブはInboxロックとuniqueで直列化する。失敗時に中途半端なSF6行、手順子行、inline局面や関連行を残さない。
- clientはフォームを開いた時のUUIDを再試行にも使う。失敗後に利用者が入力を変更して新しい処理にした場合は、新キーと最新のsource snapshotを使う。既に保存済みのInboxから別入力を作ることはできない。
- Inboxは既存ルールどおりstatus=done、resultに固定の宛先ラベルを追記/設定する。元contentは変更しない。URLは構造化関連から描画し、本文に含まれる任意URLをリンク元として実行しない。

`inbox_route_contract()` のexits/functionsに新出口を追加する。従来のcontract名と旧exitを残し、接続状態/契約検査が古い一覧のままにならないよう更新する。`want_routes`へSF6を追加する必要はない（SF6向けの経由Wantを新規に作らない）。

### 5.4 深いリンク・成功後表示

- `/sf6/?resource=situations|sequences|drills&id=<id>` の詳細表示を追加し、保存先URLをこの形式に統一する。読込完了後に適切なtab/characterを選び、対象の既存編集/詳細を開く。未存在は明示し、新規画面へ置き換えない。
- Inbox起点の新規入力は `/sf6/?inbox=<id>&create=<resource>`。SF6未保存のフォームは通常のPOSTではなく新exitへ送信する。source contextを通常のSF6編集時へ残さない。
- 通常のSF6作成/編集/削除、対戦振り返り→練習作成、既存グラフを変更しない。保存済みの作成先を編集する際は通常PATCHとupdatedAtを使う。

### 5.5 受け入れ条件と証拠

| Issue条件 | 必要な検証 |
| --- | --- |
| 全3種へ進む | Inboxクイック/手動整理→SF6→局面/コンボ/起き攻め/練習。既存フォームが開くことをブラウザで確認 |
| 本文を失わず編集 | 2,000文字、複数改行、HTML様文字列、空行、絵文字、先頭行長文。原文snapshotとmemo/detailが保持される |
| 成功時のみ完了 | 必須不足、wrong character、存在しない手順、SQL例外、送信/表示再取得失敗、キャンセル。DBに片側だけ残らない |
| 関連をたどる | Inbox→SF6、SF6→Inbox、作成先削除後、再読込後、古いURL |
| 冪等性 | 二重送信/応答取りこぼし/同キー異入力/別キー同Inbox/他出口との競合/本文変更競合を実DBで検証 |
| 既存動作 | 既存全exitのAPI/SQLテスト、通常SF6全resource、inline局面/キャラ制約/starts/results、スマホ/PC |

AI判断: 移行専用の別SF6フォームやAI解析は作らない。原文は全文を補足と元記録に残し、不足項目は利用者に決めてもらう。内部宛先のためCalendarのようなawaiting_externalは不要で、単一DB処理で確定する。

## 6. Migration依存・適用・ロールバック

### 6.1 追加ファイルの分割

- `apps/hub/supabase/migrations/202610230001_project_action_todos.sql`: 関連表、リンク/解除/連動状態更新RPC、既存Project Action RPCの互換更新、権限制御。
- `apps/hub/supabase/migrations/202610230002_inbox_sf6_routes.sql`: 関連表、SF6振り分けRPC、契約の出口追記、権限制御。
- Knowledge側のmigrationは不要。#231にも不要。
- 既存履歴を書き換えるbackfillはしない。既存の似た名前からリンクを推測作成しない。

### 6.2 依存元

必要なスキーマと最新関数を、適用済みDBとmigrationで照合する:

- 元のInbox/Wantsテーブル（初期schema/既存基盤）。
- `202609200001_want_triage.sql` / `202609200002_google_calendar.sql` / `202609200003_habits_mvp.sql` / `202609200004_focus_board.sql` / `202609200005_auto_complete_routed_wants.sql` / `202609210001_wants_source_inbox.sql`。
- Project: `202609220003_projects_mvp.sql` → `202610090001_project_action_edit.sql` → **`202610100001_project_milestones.sql` の7引数版 `update_project_action`**。古い6引数版を再導入しない。
- ToDo: `202609220004_scheduled_actions.sql` → `202610180001_calendar_todo_sync.sql` → `202610180002_calendar_sync_full_unique_index.sql`。後者のgoogle_event_id完全uniqueを維持する。
- Inbox: `202609230001_inbox_route_rpc.sql` → 最新 **`202610060001_inbox_route_question.sql`**、Focusやカテゴリ等の関連制約を含む後続migration。古いroute関数を再導入してquestionを失わない。
- SF6: `202610110001_sf6_training.sql` → `202610120001_sf6_situations_setplays.sql` → `202610120002_sf6_sequences.sql` → `202610120003_sf6_drop_legacy.sql`。legacy combos/setplays/notesテーブルへ戻さない。
- Knowledge確認: `20261002100000_review_queue.sql` と `confirmed_at`/自動正解確認に関する後続migration。確認以外のscheduler SQLは変更しない。

ローカルPostgreSQL（PGlite PostgreSQL 18互換実行環境を含む）では初期schemaと必要なロールを用意し、上記を順番に適用する。cron/net/vault等、ローカルにないSupabase拡張のDDL/スケジュールだけを検証harnessで分離する。アプリ表/制約/実装するRPCは省略しない。harnessが「既存schemaを近似しただけ」の場合はその範囲を明記し、本物のmigrationを適用した証拠と区別する。PGliteは単一接続なので複数sessionの同時ロック挙動は証明できない。CAS/古いsnapshotを実行し、SQL全経路のロック順レビューで補い、実並行の未検証を明記する。

### 6.3 ロールバック

- DB変更を先に適用し、その後に画面/APIを出す。表追加は旧コードに影響しない設計とする。
- 画面/APIを戻す場合も新しい関連表と関連記録を保存する。まず対象操作を止め、リンク/routeをCSV/SQL dump等で退避する。紐づいた状態のまま旧コードを動かすと連動しないため、旧UI公開へ戻す前にリンク機能を無効にし、関連Action/ToDoの状態を確認する。
- データがある関連表をそのままDROPしない。ToDo/Project/SF6/Inboxの元レコードやCalendar予定を削除して戻す操作はしない。
- RPCを戻す必要がある場合は上記最新版定義を戻し、関連表を保持したままリンク操作を停止する。元のNext Action index、ETag/CAS処理、権限を維持する。
- #230/#231のclient rollbackは確認済みtimestampやProjectデータを巻き戻さない。

## 7. 実装単位と最終確認

順番: #230 → #231 → #232（DB/共通ロジック/API→両UI）→ #233（DB/API→既存SF6 editor拡張→Inbox導線）。前の変更を使う場合も4件の要件を混ぜず、各受け入れテストを追えるようにする。

必要な確認:

1. Knowledge/Hubの型チェック、既存全テストと追加の純粋ロジック/APIテスト。
2. 追加migrationを使い捨てPostgreSQLへ実際に適用し、トランザクション・制約・冪等性・CAS・Next分岐をSQLで実行確認する。複数接続が使える場合はロック競合を別接続のtransactionで再現し、PGliteだけの場合は上記の検証範囲を明記する。
3. 変更したFunctionsをWranglerでビルドする（Viteだけで確認したことにしない）。Hub/Knowledgeの通常build。共有部分へ影響した場合は3アプリbuild。
4. CSS変更時はtheme生成→theme:check。Hubのcheck:clientで追加モジュールも構文検査する。
5. 開発/previewの操作可能なfixtureでスマホとPCの全導線を確認する。本番データを確認テストのために一括確認/リンク/振り分けしない。
6. help、`projects-operation.md`、Inbox route契約資料、migration運用資料を実装に合わせる。
7. エージェント④は4件のIssue条件と本設計の表を照合し、未検証を未検証として残す。AIが決めた事項（全件範囲/集計/正本/Next分岐/解除/原子的SF6移行）を利用者向けに短く報告する。

## 8. エージェント②の設計レビュー記録

2026-10-23。AGENTS、Knowledge CLAUDE、Projects運用、現行Functions/画面、関連migrationの最新定義を照合した。

| レビューで見つけた衝突/不足 | 確定した修正と理由 |
| --- | --- |
| 確認後reloadは例外を内部で捕捉するため、await完了だけでは最新状態を証明しない | 成否と最新ログを確認できる結果を呼出元へ返す。1,098件等の全件対象と途中成功は保持し、再取得不明を完了と断定しない |
| done/cancelledのActionもリンク対象なのにopenだけをロックすると漏れる。milestone deleteはProject→Actionの逆順 | 全Actionのid順→Project→ToDo→関係行を基準にし、旧resolver/Action更新/マイルストン削除を修正。resume/追加/source経路も待機順の表で実査する |
| 未リンクToDoを読んだ直後にlinkされると、旧REST PATCHではToDoだけ更新できる | 未リンクもロック後の関連確認を行うRPCへ通す。link/unlinkで全snapshotを更新し、旧clientは409で止める |
| Calendar取消syncがリンク済みToDoを削除し得る | DBでToDoロック後にリンク有無を再検査。リンク済みは取消状態で保持し、FK restrictで保護。未リンクの従来動作は維持 |
| 終了済みProjectには現行再開操作が存在しない | 架空の再開導線を出さない。新規リンクは進行中の別Project選択、既存リンクからToDoを再開する場合は明示解除→通常reopenを案内 |
| ProjectとToDoで日付がずれる/保存済み日付が上書きされる可能性 | Calendarの実効日時とActionの保存済み日付を別に保持し、全表示面で同じ投影を使う。解除時に復帰する日付を先に示す |
| SF6の画面とAPIは両方でtrimし、未知fieldも共通validator単体では拒否しない | memo/detailだけraw保存、原文snapshotを保持。API/DB両方で許可キーを確認し、既存FieldSpec/sequence RPCを共有する |
| nullable FKだけでは元/保存先削除後の再試行を同一入力と検証できない | immutableなID履歴とcanonical requestを保持し、pending確認前に既存成功を照合する |
| SQLテキスト確認/PGliteでは実並行ロックを証明できない | 実DDL/RPCをPostgreSQL互換環境で動かし、ロック順全経路レビューを別証拠として残す。複数sessionを実行しない場合はその未検証範囲を明記する |

③へ委ねる範囲: helper/ファイル名、後方互換な応答型、フォーム部品の分け方、RPCの一意な名前、短いUI文言、テストfixtureの構成。4件の対象範囲、状態正本、Next必須分岐、解除時の非削除、原子的保存、原文保持、CAS/認証/権限、上記の受け入れ条件は変更しない。実装で設計から実質変更が必要なら本文と判断理由を更新して④のレビューへ渡す。

設計上の未解決事項: なし。実装・動作の完了は未証明であり、7章と各Issueの検証を終えて④が確認するまで完成扱いにしない。
