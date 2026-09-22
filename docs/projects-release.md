# Projects本番反映チェックリスト

## 現在の停止位置

- リリース候補ブランチ: `codex/projects-mvp`
- 本番基準コミット: `c8b4efc`
- Projectsのリリース候補: `c780b6f`以降
- 本番Supabaseへのmigration適用と、`HEAD:main`へのpushは未実施。

## デプロイ直前まで

1. `git fetch origin --prune`を実行し、`origin/main...HEAD`が「本線側0、リリース候補側のみ進行」であることを確認する。
2. `npm run predeploy:check`を実行する。
3. `supabase/migrations/202609220003_projects_mvp.sql`をレビューする。
4. 本番へ反映する際は、Cloudflare Pagesより先に上記migrationをSupabaseへ適用する。
5. migration適用後、別クエリで`supabase/verification/202609220003_projects_mvp_verify.sql`を実行する。全booleanが`true`、競合件数が`0`であることを確認する。
6. ここまで成功してから、Cloudflare Pagesの本番デプロイを開始する。

## デプロイ後の確認

1. 未認証アクセスが引き続き`401`で、`Cache-Control: private, no-store`などの保護ヘッダーを返す。
2. 認証後のHubにProjectsカードが表示され、`/projects/`が開く。
3. Inboxの既存9分類が残り、その下に「Projectとして進める」が表示される。
4. 検証用Inbox 1件から新規Projectを作り、Project・関連アイテム・Next Action・元Inboxの整理結果を再取得して確認する。
5. 別の検証用InboxまたはWant 1件を既存Projectへ入れ、「Actionにする」でNext ActionまたはAction候補へ変換できることを確認する。
6. Next Action完了時に「続ける・Project完了・確認待ち・保留」の各入力条件が表示されることを確認する。

## 切り戻し方針

- UI／Functionsに問題がある場合は、Cloudflare Pagesを基準コミット`c8b4efc`へ戻す。
- migrationで追加したProjectテーブルは既存Inbox／Wantを削除・移動しないため、即時にdropしない。原因調査とデータ保全を優先する。
