# Projects運用

## 目的

Projectを単なる保管フォルダにせず、完了条件と現在のNext Actionを一緒に管理します。InboxとWantsは元のテーブルに残し、Projectから関連づけます。

## 用語

- テーマ: 継続的な関心領域。MVPではProjectの任意ラベルとして扱う。
- Project: 複数の行動を必要とし、完了条件を持つ目標。
- マイルストン: 完了条件までの道筋の区切り。Projectごとに順序と任意の期日を持ち、Actionを任意で1つのマイルストンに入れる。
  マイルストンを消してもActionは「マイルストンなし」として残る。期日の前後（Action ≤ マイルストン ≤ 目標日）は警告だけで、制約にはしない。
- Action: Project内で実行する具体的な行動。改行区切りでまとめて追加できる（1回50件まで）。
- Next Action: Actionのうち、今すぐ着手する1件。

## 日々の運用

1. 新しいProjectには、Project名・完了条件・最初のNext Actionを設定する。
2. 日々はProject全体ではなく、現在のNext Actionから着手する。
3. Next Actionを完了・見送りにしたら、次のいずれかを必ず選ぶ。
   - 次のActionを設定して続ける。
   - 目標達成としてProjectを完了する。
   - 相手・結果待ちにして、待っている内容と再確認日を設定する。
   - 保留にして、見直し日を設定する。
4. 待機・保留Projectを再開する時は、新しいNext Actionを設定する。

## Inbox／Wantsとの関係

- 元のInbox／Wantは移動・複製せず、そのまま正本として残す。
- `project_items`に元レコードの種別・IDと、表示用スナップショットを記録する。
- 1つのInbox／Wantは、同時に1つのProjectだけへ紐づける。
- 新しいProjectを作る場合は完了条件と最初のNext Actionを同時に決め、元アイテムを`action_source`として記録する。
- 既存Projectへ入れる場合は`unprocessed`として追加し、現在のNext Actionは変更しない。次回レビューでAction化・参考情報・不採用のいずれかへ整理する。
- Action化すると、現在のNext Actionが空ならそのActionをNextにし、すでにNextがあれば「あとで行うAction」へ追加する。
- Projectへの紐づけと、元のInboxを整理済み／Wantを完了にする更新は同じDB処理で確定する。片側だけ成功する状態は作らない。
- 未整理の関連アイテム、またはNext ActionのないActive Projectは「要確認」として表示する。

## ToDoとの関係

- 既存のProject Actionと既存ToDoを利用者が選び、`project_action_todos`で1対1に紐づける。名前一致による自動リンクや新しい予定の作成はしない。
- 実行状態はToDoが正本。completed→done、skipped→cancelled、再開→queued。再開でNext Actionへ自動昇格させない。
- 完了・見送りは両レコードと必要なNext分岐を単一DB RPCで確定し、Google Calendarは変更しない。未リンクのToDoも同じRPCでロック後に関連を検査する。
- Nextが終わる場合は必ず4分岐を選ぶ。状態が異なる2件を紐づけてNextが終わる場合も同じ。終了済みProjectのToDoを再開する場合は先に解除する。
- 日時は既存ToDo/Calendarの予定を全表示面へ投影する。Actionのstart_on/due_onは保存したまま直接編集を拒否し、ToDoの既存ETag付き日程変更へ案内する。
- 解除は関連行だけを削除し、両側updated_atを更新する。両記録/Calendarは残り、Actionの独立した日付に戻る。解除確認で復帰後の日付を示す。
- Calendar取消syncはToDoロック後に関連を再確認し、リンク済みまたは日程履歴があるToDoを取消状態で保持する。リンクも履歴もないpendingだけ削除する。
- 新規リンクはopen Projectに限り、done/cancelledのActionや完了/見送りToDoも状態差分を確認して選択できる。終了済みProjectのリンク解除は可能。
- 関連ToDoへのリンクは共通の`history=1`付き詳細URLを使い、完了・見送り後も直接開く。既存Hub/Todayの通常URLは従来どおり終了後に一覧へ戻す。アーカイブ用の変更・再開機能は追加しない。

## 状態

### Project

- `active`: Next Actionから進める。
- `waiting`: 相手・結果を待つ。待っている内容と再確認日が必須。
- `on_hold`: いったん保留する。見直し日が必須。
- `completed`: 完了条件を満たした。
- `dropped`: 取り組みを終了した。

### Action

- `next`: 現在着手するAction（「今やる」にピン留めした1件）。1 Projectにつき最大1件。
- `queued`: あとで行うAction候補。画面で並べ替えた順（`sort_order`）に並ぶ。
- `waiting`: Action単位の待機。
- `done`: 完了。
- `cancelled`: 取り消し。

## レビュー

- 毎日: Next Actionを確認する。
- 毎週: Projects画面の「週次レビュー」タブで、目標期限を過ぎたProject・期限超過のタスク・要確認・再確認／見直し日が来た待機・保留・停滞を確認し、
  Projectの完了条件と次の一手を更新する。同じタブで今週完了したタスクも振り返る。
- 目標期限超過: active/waiting/on_holdでtarget_onがJSTの今日より前。古い順、同日はID順。今日・未来・未設定・completed/droppedは除外する。
- 見直し項目数: 各欄の項目数の合計。同じProjectが複数理由に該当すれば別々に数える。今週完了は見直し項目数に含めない。
- 停滞: 進行中のProjectで、Project・Action・マイルストンのどれも14日以上更新がないもの。一覧・週次レビュー・Hubで目立たせる。

## 安全な導入順序

1. Project画面・API・DB migrationを独立実装して検証する。
2. 進行中のInbox変更を本線へ取り込む。
3. Inboxの既存9分類を維持したまま「Project」を追加し、`project_items`へ関連づける。
4. migrationを先に適用し、その後にFunctionsと画面をデプロイする。
5. 通常URLで「新規Project」「既存Projectへの紐づけ」「Next Action完了後の分岐」を実データで各1件確認する。
