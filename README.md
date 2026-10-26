共通の開発・マイグレーション・環境変数の手順は [OPERATIONS.md](OPERATIONS.md) を参照。

# Personal Dashboards

Hub・ナレッジ・家計簿の3つのダッシュボードをまとめたモノレポ（npm workspaces）。
各アプリは独立したCloudflare Pagesプロジェクトとしてデプロイする。

| ディレクトリ | 内容 | 旧リポジトリ |
| --- | --- | --- |
| `apps/hub` | Personal Hub（Idea / Writing / Habits / Journal、他ダッシュボードへの中継） | personal-dashboard |
| `apps/knowledge` | ナレッジDB・復習クイズ | knowledge-dashboard |
| `apps/finance` | 家計簿 | financial-dashboard |

旧2リポジトリの履歴は `apps/knowledge`、`apps/finance` 配下へマージ済み。

## コマンド

```bash
npm install            # ルートで1回。lockfileはルートの package-lock.json だけ
npm run typecheck      # 全アプリ
npm test               # 全アプリ（Node 23以降。--test-isolation を使うため）
npm run build          # 全アプリ
npm run build -w apps/knowledge   # 1アプリだけ
```

各アプリの `dev:pages` などは、そのアプリのディレクトリで実行する。

## SQL・適用履歴

新規の適用SQLは `apps/<app>/supabase/migrations/YYYYMMDDHHmmss_description.sql`
に置く。日時はUTCの14桁、説明は小文字のsnake_caseとする。
既存12桁版は適用versionを変えないための固定例外で、リネームしない。
旧単発SQLの `migrations/baseline/` は保管用であり、未適用SQLとして実行しない。

履歴は共有の `knowledge-db` の `supabase_migrations.schema_migrations` を参照する。
旧SQL5本の[履歴対照表](scripts/migration-baselines.json)は、特定できた履歴と
適用経路が不明な現状確認を分けている。`npm run db:migrations:check` は配置・
命名・原文保全・対照表の網羅性をオフライン検査する。
適用・記録・読み取り照合の手順は[SQLの運用](docs/migrations.md)を参照する。

## Cloudflare Pages設定

プロジェクトごとに次を設定する（Settings → Build）。

| 項目 | hub | knowledge | finance |
| --- | --- | --- | --- |
| Root directory | `apps/hub` | `apps/knowledge` | `apps/finance` |
| Build command | `cd ../.. && npm ci && npm run build -w apps/hub` | `cd ../.. && npm ci && npm run build -w apps/knowledge` | `cd ../.. && npm ci && npm run build -w apps/finance` |
| Output directory | `dist` | `dist` | `dist` |
| Build watch paths (include) | `apps/hub/*`, `packages/dashboard-auth/*`, `package.json`, `package-lock.json` | `apps/knowledge/*`, `packages/dashboard-auth/*`, `package.json`, `package-lock.json` | `apps/finance/*`, `packages/dashboard-auth/*`, `package.json`, `package-lock.json` |

Root directory直下にlockfileが無いため、Build commandでルートの `npm ci` を明示する。
`packages/dashboard-auth` は3アプリ共通の認証・Supabase通信処理なので、全プロジェクトの監視対象に含める。
既存プロジェクトのBuild watch pathsもCloudflare Pagesの設定画面で更新する。READMEの変更だけでは設定は変わらない。

## Supabaseバックアップ

GitHub Actionsで週1回、共有DBを暗号化してArtifactに保存する。初期設定とリストア手順は
[`docs/supabase-backup.md`](docs/supabase-backup.md)。
