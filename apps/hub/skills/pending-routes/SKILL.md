---
name: pending-routes
description: Inboxで「開発」「調査」に振り分けたまま登録待ちになっている項目（Supabase knowledge-db の want_routes で destination が github / knowledge、status が planned のもの）を処理するスキル。既存のGitHub Issueやナレッジと照合し、本当に未登録の項目だけを示して、Issue作成・ナレッジ登録・登録済みにする・不要として取り消すのいずれかを提案する。実行は承認を得てから行う。「GitHub登録待ち見て」「Git登録待ちを処理して」「ナレッジ登録待ちを処理して」「登録待ちを片付けて」「Knowledge候補を処理して」などのリクエストで使う。未整理Inboxの振り分け（idea-inbox）や、学んだ知識をその場で登録するだけの依頼（knowledge-db）には使わない。
---

# 登録待ちの処理（GitHub / Knowledge）

Inboxを「開発」または「調査」に振り分けると、`want_routes` に `status='planned'` の行ができる。
GitHub Issueやナレッジへの実際の登録はダッシュボードの外（会話・GitHub上）で行うので、
登録しても `planned` のまま残り、Hubの「GitHub登録待ち」「Knowledge登録待ち」に出続ける。
このスキルは、その待ち行列を実態に合わせて片付ける。

## 正本と、触らないもの

- 登録待ちかどうかは **`want_routes.status = 'planned'` だけ**で判定する。
- `idea_inbox.result`（「GitHub Issueへ振り分け」「Knowledge候補へ振り分け」）は振り分けたときの記録で、
  Hubが振り分け先の復元に使う。**書き換えない。**
- `wants` は振り分けた時点で `completed` になっている。触らない。
- 書き込みは、Hubの「GitHub登録済みにする」「Knowledge登録済みにする」
  （`apps/hub/functions/_shared/wantRouteCompletion.ts` の `completeWantRoute`）と同じ内容にする。
  どちらかを変えるときは、もう一方も合わせる。

## 接続

- Supabase: knowledge-db / project ref `plwlxwidpqbunugfxjhp`。Supabase MCP の `execute_sql` を使う。
- GitHub: `gh` CLI。Issueを作る先は `tsuonosuke-bot/personal-dashboard`（Hub・Knowledge・Financeのモノレポ）。
  照合では旧リポジトリ `tsuonosuke-bot/knowledge-dashboard` のIssueも見る（新規作成はしない）。
- `gh` が使えない環境では、GitHubとの照合とIssue作成を省き、待ち一覧と本文案の提示までにとどめる。

## 手順

### 1. 登録待ちを読む

```sql
select r.id as route_id, r.destination, r.title, r.detail, r.created_at,
       w.id as want_id, w.source_inbox_id as inbox_id, i.content as inbox_content
from public.want_routes r
join public.wants w on w.id = r.want_id
left join public.idea_inbox i on i.id = w.source_inbox_id
where r.status = 'planned' and r.destination in ('github', 'knowledge')
order by r.destination, r.created_at;
```

0件ならその旨だけ伝えて終える。依頼がGitHubだけ、またはKnowledgeだけなら、そちらに絞る。

### 2. GitHubの登録待ちを既存Issueと照合する

```bash
gh issue list -R tsuonosuke-bot/personal-dashboard --state all --limit 500 --json number,title,body,state,url
gh issue list -R tsuonosuke-bot/knowledge-dashboard --state all --limit 500 --json number,title,body,state,url
```

- **確定**: Issue本文に `want_routes #<route_id>` または `idea_inbox #<inbox_id>` の印がある。
- **候補**: 印は無いが、タイトルや本文が同じ内容を指している。Closeされた Issue も対象。
  内容が近いだけで別の話（関連Issue）なら、候補にしない。
- どちらも無ければ **未登録**。

### 3. Knowledgeの登録待ちをナレッジと照合する

`title` と `detail` から主要な語を2〜3個選び、アーカイブ済みも含めて探す。

```sql
select id, title, category, archived, created_at
from public.knowledge
where title ilike '%<語>%' or explanation ilike '%<語>%'
order by created_at desc
limit 20;
```

- 同じ知識を扱う行があれば **候補**（その `id` を控える）。無ければ **未登録**。
- `detail` の「深掘り元: …（knowledge <uuid>）」は、問いが生まれた元のナレッジ。
  登録先ではないので、この `uuid` を登録済みの根拠にしない。

### 4. 本当に未登録の項目を中心に提示する

一覧の主役は **未登録の項目**。照合で登録済みと判断した項目は、
1行ずつ（`route_id`・タイトル・見つけたIssueまたはナレッジ）にまとめて添えるだけにする。

未登録の項目には、次のどれかを提案する。

| 出口 | GitHub | Knowledge |
| --- | --- | --- |
| 登録する | Issueのタイトルと本文の案を出す（5.の形式） | 内容を調べて要点3〜5行の回答を示し、`knowledge-db` スキルの形式で登録案を出す |
| 不要 | 取り消す（`cancelled`） | 取り消す（`cancelled`） |
| 保留 | 何もしない（`planned` のまま） | 何もしない（`planned` のまま） |

候補として見つかった項目は「登録済みにする」を提案し、根拠にしたIssueやナレッジを示す。
**承認を得るまでは、Issue作成・ナレッジ登録・`want_routes` の更新を一切しない。**
無人のスケジュール実行では、提示までで止める。

### 5. Issueの形式

- タイトルは領域の接頭辞をつけ、やることを動詞で終える。
  接頭辞: `[Hub]` `[Compass]` `[knowledge]` `[finance]` `[DB]` `[repo]` `[skill]`
- 本文は「## 背景」「## やりたいこと」（チェックボックス）「## 関連」の順。関連が無ければ「関連」は省く。
  決めきれない点は「（要検討）」と書いて残す。コードの場所が分かれば書く。
- 本文の最後に、照合用の印を必ず入れる: `(idea_inbox #<inbox_id> / want_routes #<route_id>)`

```bash
gh issue create -R tsuonosuke-bot/personal-dashboard --title "<タイトル>" --body-file <本文ファイル>
```

### 6. 承認された項目だけを実行する

項目ごとに個別に実行する。まとめて1つのUPDATEにしない。

**GitHub Issueを作った、または既存Issueで登録済みにする**

```sql
update public.want_routes
set status = 'created', target_id = '<Issue番号>',
    target_url = 'https://github.com/tsuonosuke-bot/<repo>/issues/<Issue番号>',
    error_code = null, updated_at = now()
where id = <route_id> and destination = 'github' and status = 'planned'
returning id, status, target_id, target_url;
```

**ナレッジに登録した、または既存ナレッジで登録済みにする**

先に `select id from public.knowledge where id = '<uuid>';` で実在を確かめる。

```sql
update public.want_routes
set status = 'created', target_id = '<knowledgeのuuid>',
    target_url = '/knowledge/?knowledge=<knowledgeのuuid>',
    error_code = null, updated_at = now()
where id = <route_id> and destination = 'knowledge' and status = 'planned'
returning id, status, target_id, target_url;
```

**不要として取り消す**

```sql
update public.want_routes
set status = 'cancelled', error_code = null, updated_at = now()
where id = <route_id> and destination in ('github', 'knowledge') and status = 'planned'
returning id, status;
```

`returning` が0行なら、ほかの場所（Hubの画面など）で先に処理されている。上書きせず、
その `route_id` を読み直して今の状態を伝える。

Issueやナレッジを作ってから `want_routes` の更新に失敗した場合は、作ったIssue番号やナレッジIDを示し、
同じ `route_id` の更新だけをやり直す。Issueやナレッジを二重に作らない。

### 7. 報告

処理した項目ごとに、出口と結果（Issueのリンク、ナレッジのID、取り消し、保留）を1行で示す。
最後に、まだ `planned` のまま残っている件数を添える。

## 注意

- `idea_inbox` は読むだけ。`status` も `result` も変えない。
- 照合の結果は推測を含む。「確定」以外の項目は、登録済みにする前に必ず根拠を示して承認を得る。
- 新しい `want_routes` を作らない。待ち行列を片付けるだけで、振り分けそのものは `idea-inbox` と Hub の役割。
