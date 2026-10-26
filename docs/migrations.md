# SQLの保管・履歴

共通運用は [OPERATIONS.md](../OPERATIONS.md#マイグレーション)を参照する。

- 新規SQLは `apps/<app>/supabase/migrations/YYYYMMDDHHmmss_description.sql`。
  日時はUTC、14桁、説明は小文字のsnake_caseとする。
- 既存12桁ファイルは `scripts/migration-catalog.json` に固定した例外。
  適用履歴・依存SQL・接続状態のversionを変えないため、リネームしない。
- 旧単発SQLは各アプリの `migrations/baseline/` に原文のまま移動した。
  baselineは過去の定義の保存用であり、新しい未適用migrationではない。
  自動実行、全件一括実行、現在のDBへの再適用は行わない。
- `supabase/tests/`・`verification/` は検証、`archive/` は削除済み定義。
  適用SQLに混ぜない。
- SQLの実行順はアプリをまたいだ依存関係も確認する。各アプリのファイルを
  連結して自動適用する仕組みは導入していない。

## 履歴の記録方針

3アプリとも既存の `knowledge-db` の `supabase_migrations.schema_migrations`
（`version` / `name` / `statements`）をDB側の適用履歴の正本とする。
`dashboard_schema_versions` はアプリの最新状態表示用で、全履歴の代わりにしない。

| 対象                                  | 記録するもの                                                             | 再実行の判断                                               |
| ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 新規migration                         | ファイルのUTC 14桁version、説明部分のname、実際に適用するSQL             | 対象DBの履歴と依存関係を確認した未適用分だけ               |
| 履歴を特定できた既存SQL               | DBに保存された実際のversion/nameと照合根拠。ローカル名と違っても維持     | 履歴に合わせるためのリネーム・再適用はしない               |
| 現状は確認できるが適用経路不明の旧SQL | 確認日、環境、確認対象・差分を観測記録へ。履歴version/nameは未確定のまま | 未適用とみなして実行したり、適用日時を推測で埋めたりしない |

新規migrationは、履歴の保存を含むレビュー済みの適用経路を使う。
SQL Editorの実行だけではmigration履歴は自動記録されない。SQL Editorを使う場合は
実行SQLと履歴記録を同じレビュー対象にし、実行後の定義・権限と保存された
`version` / `name` / `statements` を確認してから適用完了とする。
失敗時は実際の適用状態を調べ、履歴だけの登録やSQLの再実行で帳尻を合わせない。

旧単発SQLの評価は [migration-baselines.json](../scripts/migration-baselines.json)
に固定する。`identified` は履歴を特定できた評価、`unresolved` は適用経路不明。
これは確認日の観測記録であり、DBへ書き込むmigrationリストではない。
後続SQLの `relatedHistory` を初期定義の適用証明に流用しない。
旧原文のSHA-256は既存の [migration-catalog.json](../scripts/migration-catalog.json)
で管理し、観測した現在の定義に合わせてbaseline原文を編集しない。

## 2026-10-26 JSTの読み取り照合

本番コード `2b7bf63678939a67de5a6038eb22741f71a14a3d` と
Supabase Productionの111件の履歴行（全件にSQL本文あり）を読み取り照合した。
履歴名・SQL本文の確認と、現在の列・制約・権限の確認は区別する。
履歴のname/versionとローカル名が違うものがある。番号の推測やファイル移動を
もって「適用済み」としない。対象は旧単発SQL5本で、全DBの再構築証明ではない。

| baseline                                 | 履歴で確認できたもの                                                                      | 扱い                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Knowledge `allow-choice-quiz-format.sql` | `20260920023245` / `allow_choice_quiz_format`、View migration SQLの制約定義一致           | 過去適用として保管                                    |
| Finance `expenses-category-not-null.sql` | `20260920043311` / `expenses_category_not_null_with_unclassified_fallback`                | 履歴名と現在のNOT NULL・既定値・補完トリガーを照合    |
| Knowledge `disable-anon-access.sql`      | 元の適用経路は特定できず                                                                  | 現状の権限を観測記録に保存。履歴は書き換えない        |
| Finance `disable-anon-access.sql`        | 元の適用経路は特定できず                                                                  | 現状の権限を観測記録に保存。履歴は書き換えない        |
| Finance `recurring-expenses.sql`         | 初期定義の経路は特定できず。後続は `20261009020520` / `recurring_create_without_template` | 現在の定義・差分を保存。初期SQL全体の適用は断定しない |

同日のSELECTで、`knowledge`・`quiz_log`・`expenses`・`budget_categories`の
RLS有効、`anon`のSELECT/INSERT/UPDATE/DELETEが全てfalseであることを確認した。
`expenses.category` はNOT NULL、既定値 `97_未分類`、補完トリガーも有効。

定期支出の2テーブル・列・制約、各RPCと旧4引数create overload、sequence権限、
定期実行設定を照合した。定期支出テーブルはRLS有効、`anon`/`authenticated`の
CRUDはfalse、`service_role`はtrue。更新RPCのEXECUTEはこの3ロールのうち
`service_role`だけtrue。日付計算の純粋関数はanon/authenticatedからも実行可。
本番では次の差分があり、baselineは現在のDBを完全再構築するSQLではない。

- `next_recurring_date` には空の `search_path` 設定が追加されている。
- `materialize_recurring_expenses` のメモ区切りは実際のCRLFリテラル。
  baselineの `E'\n'` に正規化すると残りの本体は一致するが、原文や改行値までの
  完全一致を示すものではない。
- 旧4引数の `create_recurring_expense_rule` と、`source_expense_id` の
  UNIQUE制約が残る。整理のために削除しない。

定期実行 `materialize-recurring-expenses-jst` は有効、`10 15 * * *`
（00:10 JST）、期待する実行コマンドと一致した。

## 本番との再照合

[読み取り専用SQL](../scripts/sql/verify-migration-baselines.sql)はcatalogと履歴だけを
照会する。アプリの行データ、秘密値、cronの生コマンドは出力せず、更新RPCも呼ばない。
対象のSupabaseプロジェクト/Productionを画面で確認し、空のSQL Editorへ全文を入れ、
読み戻し一致を確認して実行する。`pg_cron` が有効な既存 `knowledge-db` 向けである。

結果は履歴のversion/name、6テーブルのRLS・権限、引数別の関数定義ハッシュ・
所有者・SECURITY DEFINER・search_path・EXECUTE、列・制約・トリガー、sequence、
対象cron設定を含む。`other_history_candidates` は検索候補にすぎず、SQL全体の
適用証明ではない。定義ハッシュの一致も、空白正規化後の診断値として扱う。
欠けた対象や差分は人がレビューし、確認日と根拠を対照表へ反映する。
このSQLは合否を自動判定せず、過去履歴の補完やbaselineの再適用も行わない。

## 保管場所のチェック

`npm run db:migrations:check` は、SQL直下の取り残し、新規ファイルの命名、
例外ファイルの移動/改変、baselineの履歴評価の欠落・重複、未確定履歴へのversion
混入を検出する。カタログのSHA-256は改行をLFに正規化して照合する。
検査の合格は保存された対照表の整合を示し、ライブDBの適用確認を意味しない。

新しいmigrationの適用・バックアップ・復旧・型再生成は
[共通運用](../OPERATIONS.md)、[バックアップ](supabase-backup.md)、
[生成型](../packages/database-types/README.md)を参照する。
