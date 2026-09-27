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

## Cloudflare Pages設定

プロジェクトごとに次を設定する（Settings → Build）。

| 項目 | hub | knowledge | finance |
| --- | --- | --- | --- |
| Root directory | `apps/hub` | `apps/knowledge` | `apps/finance` |
| Build command | `npm run build` | `npm run build` | `npm run build` |
| Output directory | `dist` | `dist` | `dist` |
| Build watch paths (include) | `apps/hub/*`, `package.json`, `package-lock.json` | `apps/knowledge/*`, `package.json`, `package-lock.json` | `apps/finance/*`, `package.json`, `package-lock.json` |

アプリのディレクトリで `npm install` / `npm ci` を実行しても、npmがルートのworkspaceを検出してルートのlockfileで入る。
