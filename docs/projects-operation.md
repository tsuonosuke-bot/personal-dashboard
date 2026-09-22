# Projects運用

## 目的

Projectを単なる保管フォルダにせず、完了条件と現在のNext Actionを一緒に管理します。InboxとWantsは元のテーブルに残し、Projectから関連づけます。

## 用語

- テーマ: 継続的な関心領域。MVPではProjectの任意ラベルとして扱う。
- Project: 複数の行動を必要とし、完了条件を持つ目標。
- Action: Project内で実行する具体的な行動。
- Next Action: Actionのうち、今すぐ着手する1件。

## 日々の運用

1. 新しいProjectには、Project名・完了条件・最初のNext Actionを設定する。
2. 日々はProject全体ではなく、現在のNext Actionから着手する。
3. Next Actionを完了したら、次のいずれかを必ず選ぶ。
   - 次のActionを設定して続ける。
   - 目標達成としてProjectを完了する。
   - 相手・結果待ちにして、待っている内容と再確認日を設定する。
   - 保留にして、見直し日を設定する。
4. 待機・保留Projectを再開する時は、新しいNext Actionを設定する。

## Inbox／Wantsとの関係

- 元のInbox／Wantは移動・複製せず、そのまま正本として残す。
- `project_items`に元レコードの種別・IDと、表示用スナップショットを記録する。
- Projectへ関連づけた直後は`unprocessed`とし、Action化・参考情報・不採用のいずれかへ整理する。
- 未整理の関連アイテム、またはNext ActionのないActive Projectは「要確認」として表示する。

## 状態

### Project

- `active`: Next Actionから進める。
- `waiting`: 相手・結果を待つ。待っている内容と再確認日が必須。
- `on_hold`: いったん保留する。見直し日が必須。
- `completed`: 完了条件を満たした。
- `dropped`: 取り組みを終了した。

### Action

- `next`: 現在着手するAction。1 Projectにつき最大1件。
- `queued`: あとで行うAction候補。
- `waiting`: Action単位の待機。
- `done`: 完了。
- `cancelled`: 取り消し。

## レビュー

- 毎日: Next Actionを確認する。
- 毎週: 「要確認」「待機・保留」「期限超過」を確認し、Projectの完了条件と次の一手を更新する。

## 安全な導入順序

1. Project画面・API・DB migrationを独立実装して検証する。
2. 進行中のInbox変更を本線へ取り込む。
3. Inboxの既存9分類を維持したまま「Project」を追加し、`project_items`へ関連づける。
4. migration適用前に既存`next_actions`の実スキーマを確認し、重複するActionデータの移行方針を決める。
5. migration、デプロイ、通常URLでの実データ確認を順に行う。
