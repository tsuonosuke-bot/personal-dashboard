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

## 2026-10-26 JSTの読み取り照合

SupabaseのDatabase → Migrations（111件の履歴行）を確認した。
履歴のnameとローカルのファイル名が違うものがある。番号の推測や
ファイルの移動をもって「適用済み」としない。

| baseline                                 | 履歴で確認できたもの                                                            | 扱い                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Knowledge `allow-choice-quiz-format.sql` | `20260920023245` / `allow_choice_quiz_format`、View migration SQLの制約定義一致 | 過去適用として保管                                            |
| Finance `expenses-category-not-null.sql` | `20260920043311` / `expenses_category_not_null_with_unclassified_fallback`      | 履歴名一致、現在のNOT NULLも別途確認                          |
| Knowledge `disable-anon-access.sql`      | 対応する名前の履歴なし                                                          | 現在の権限を確認、履歴への登録は保留                          |
| Finance `disable-anon-access.sql`        | 対応する名前の履歴なし                                                          | 現在の権限を確認、履歴への登録は保留                          |
| Finance `recurring-expenses.sql`         | 初期定義に対応する履歴名なし。後続`recurring_create_without_template`あり       | 現在のテーブル/関数を確認、元スクリプトの完全適用は断定しない |

`dashboard_schema_versions` の最新値だけでは、古い単発SQLの全内容が
適用済みである証拠にはならない。既存Knowledgeと同様に、適用後は
`pg_get_functiondef`、列・制約・トリガー・権限を確認してから記録する。
履歴の不足を埋める場合は現状と原文をレビューし、実際の旧versionに紐付ける。
新しいversionで旧SQLを実行し直して帳尻を合わせない。

同日に読み取り専用SELECTで、`anon`のSELECT権限は`knowledge`・`quiz_log`・
`expenses`・`budget_categories`ですべてfalse、`expenses.category`はNOT NULL、
`recurring_expenses`と`materialize_recurring_expenses(date)`の存在を確認した。
これは現在の状態の確認であり、旧スクリプト全体の適用証明とは区別する。

## 保管場所のチェック

`npm run db:migrations:check` は、SQL直下の取り残し、新規ファイルの命名、
例外ファイルの移動/改変を検出する。カタログのSHA-256は改行をLFに正規化して
照合する。データベースの適用履歴を確認するコマンドではない。

新しいmigrationの適用・バックアップ・復旧・型再生成は
[共通運用](../OPERATIONS.md)、[バックアップ](supabase-backup.md)、
[生成型](../packages/database-types/README.md)を参照する。
