# #233 Inbox → SF6 実装・検証記録

## 実装

公開APIは`/api/inbox-route`の`sf6`出口。FieldSpecによる検証と通常SF6保存と共通の`sf6SavePayload`を使う。DBは`route_inbox_sf6`でInbox行ロック→既存成功照合→期待値確認→SF6保存→関連記録→Inbox完了を1transactionで行う。既存の手順保存RPCを再利用し、原文・canonical request・不変ID履歴を関連表へ残す。

SF6の既存editorを再利用し、局面/手順/練習を切替可能にした。局面のキャラ/有利F、手順のキャラ/始動/レシピをメモから補完しない。memo/detailはrawを保存し、HTML textareaが行末を正規化した場合も未編集なら元のCRLFを保存する。HTTP成功後のGET失敗は、保存済みのIDを保持した表示再試行とする。

## 2026-10-23 実行証拠

- `tests/inboxSf6.test.ts`: 新規10テスト。APIの単一RPC/未知キー拒否/エラー、削除済み関連GET、raw全文/2,000絵文字の候補、CRLF保持、deep link、保存成功後の表示失敗、タイムアウト再送UUIDと入力変更時の最新snapshotを実行した。
- `tests/sf6.test.ts`と`tests/inboxRouting.test.ts`: 既存27テストを実行した。
- 使い捨てPGlite PostgreSQL 18.6へ実際のbaseline23 migrationと新migrationを適用した。実行スクリプトと結果は`C:/GitTest/.tmp/approved-review-issues-20261023/validate-inbox-sf6.mjs`、`inbox-sf6-db-proof.json`。
- DBで全3種の保存とraw本文、同キー/別キーreplay、別入力の409相当、元/保存先削除後の再作成抑止、content/result/status競合、未知キー/型/文字数/配列制限/重複/参照先、キャラ不一致を実行した。
- 関連INSERTで意図的にSQL例外を発生させ、手順親/子/inline局面と関連記録が全て戻り、Inboxがpendingのままであることを検証した。RLS、anon/authenticatedの実行不可、service_roleの実行可、旧contract出口維持を検証した。

初回のPGlite検証は単一接続のため実並行の証拠にはしない。その後、エージェント④がnative PostgreSQL 18.4の別接続で同一Inbox競合10組と、別Inbox同キー競合10組を実行し、重複作成と片側保存がないことを確認した。全822テスト、型チェック、Functions build、PC/390px操作と相互リンクの修正後再確認を含む結果は[最終レビュー](../../../docs/reviews/production-review-230-233.md)を参照。

## AIが判断した点

- メモを技やキャラとして推測して確定しない。元本文を補足へ残し、必要情報は利用者が確認する。
- InboxとSF6を別々の要求で保存しない。成功応答の後の表示失敗で二重作成させない。
- 元/保存先が削除されても履歴を残し、再送から新しいレコードを作らない。
- SF6のために途中のWantは作らない。一括振り分けには含めず、既存の登録フォームへ集約する。
