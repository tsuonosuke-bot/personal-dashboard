# Issue #230–#233 導入・検証・切り戻し

## 対象

検索結果の未確認全件一括確認、Project目標期限の週次レビュー、ToDo/Project Actionの手動1対1関連、InboxからSF6の登録。設計はルートの`docs/design/production-review-230-233.md`。

## 導入順

1. 既存baseline migrationが設計6.2の最新版まで適用済みか確認する。既存データからリンクを推測するbackfillはない。
2. 先に`202610230001_project_action_todos.sql`、次に`202610230002_inbox_sf6_routes.sql`をDBへ適用する。Knowledgeに新migrationはない。
3. `supabase/verification/202610230001_project_action_todos_verify.sql`を別の読み取り処理で実行し、booleanは全てtrue、整合違反件数は0を確認する。SF6については`inbox_route_contract()`に旧出口とsf6が両方あり、関連表のRLSとservice_role専用RPCを確認する。
4. 型・クライアントモジュール検査、全テスト、theme整合、3アプリの通常buildとHub/Knowledge Functions buildを通した候補を公開する。
5. 通常URLで認証・実データ読込・週次レビュー・関連リンクの表示を確認する。既存の個人データを検証目的で一括完了しない。保存操作の検証には利用者が選んだ対象を使う。

## 動作確認

- 学習ログは表示30件でも対象全件数を示し、200件ずつ確認する。途中失敗後も確認済みを維持し、残りだけを再送する。ログ再取得の成功が不明なら全件完了と表示しない。
- 週次レビューの目標期限はJST今日より前のactive/waiting/on_holdのみ。各欄の項目数を合算する。
- 手動リンク/解除を両画面で試し、完了/見送り/未実施への復帰、Nextの4分岐、日時変更を確認する。Calendarの完了/削除要求や別予定の作成が発生しないことを確認する。
- Inboxから局面/コンボ/起き攻め/練習を作り、原文と改行・相互リンクを確認する。失敗時にInboxまたはSF6だけが保存されず、応答取りこぼし後の同じ送信で増えないことを確認する。

## 切り戻し

- 操作を停止し、`project_action_todos`と`inbox_sf6_routes`を元レコードと共に退避してから判断する。関連表をDROPしてデータを失わせない。
- ToDoリンクがある間に旧UI/Functionsへ戻すと片側だけの更新になり得る。旧コードへの公開切り戻し前に関連操作を停止し、既存リンクと両状態を確認する。必要なら利用者の判断で解除する。
- RPCを戻す場合も旧最新版の7引数Action更新、最大1Next制約、Calendar ETag/CAS、権限を維持する。元ToDo/Project/Inbox/SF6/Calendarを削除して戻さない。
- #230の確認済みtimestampと#231のProjectデータをUIの切り戻しで巻き戻さない。

実行済みの検証範囲と結果は[エージェント④の最終レビュー記録](../../../docs/reviews/production-review-230-233.md)を正とする。ローカル検証の成功と本番適用は別の状態として報告する。
