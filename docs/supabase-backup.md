# Supabaseバックアップ

共有DB（project ref `plwlxwidpqbunugfxjhp`。ナレッジ・家計簿・Hub）を
`.github/workflows/supabase-backup.yml` が週1回（月曜 3:17 JST）バックアップする。
Actionsタブの「Run workflow」から手動でも実行できる。

## 仕組み

1. `supabase db dump` でロール・スキーマ・データを別々のSQLに出力する（Supabase管理スキーマは除外される）
2. 3ファイルをtar.gzにまとめ、`gpg` のAES256共通鍵暗号で暗号化する
3. 暗号化済みファイルだけをActionsのArtifactとして90日保存する

平文のダンプはArtifactにもログにも残さない。

## 初期設定

リポジトリの Settings → Secrets and variables → Actions に次を登録する。

| Secret | 値 |
| --- | --- |
| `SUPABASE_DB_URL` | Supabaseダッシュボードの Connect → Session pooler の接続文字列（`postgresql://postgres.plwlxwidpqbunugfxjhp:<DBパスワード>@aws-...pooler.supabase.com:5432/postgres`）。GitHubのランナーはIPv6の直接接続に届かないため、IPv4のSession poolerを使う |
| `BACKUP_PASSPHRASE` | 復号用の長いランダム文字列。GitHub以外（パスワードマネージャー等）にも必ず控える。失うと復号できない |

## リストア手順

```bash
# 1. Artifactを取得（Actionsの実行画面からダウンロードしてもよい）
gh run download <run-id> -n supabase-<timestamp>

# 2. 復号して展開
gpg --decrypt -o backup.tar.gz supabase-<timestamp>.tar.gz.gpg
mkdir backup && tar -xzf backup.tar.gz -C backup

# 3. 復元先（新規Supabaseプロジェクト推奨）へ流し込む
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file backup/roles.sql \
  --file backup/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file backup/data.sql \
  --dbname "<復元先のSession pooler接続文字列>"
```

- 本番DBへ直接上書きしない。新規プロジェクトへ復元して中身を確認してから切り替える
- pg_cronのジョブ（`cron` スキーマ）はダンプに含まれない。復元後に各アプリの
  `supabase/migrations/` と `apps/finance/supabase/recurring-expenses.sql` のcron登録部分を流し直す
- 復元先ではCloudflare Pagesの `SUPABASE_URL` / `SUPABASE_SECRET_KEY` を差し替えて再デプロイする
