# Inbox振り分けRPC（inbox-route-v1）

Inboxの振り分けは、Supabase（knowledge-db, `plwlxwidpqbunugfxjhp`）のDB関数に集約している。
ダッシュボード（`/api/inbox-route`）とClaude.aiの`idea-inbox`スキルは、どちらも次の関数だけを呼ぶ。
振り分けの手順をスキルやアプリへ書き写さない。変更はDB関数とこの文書を同時に更新する。

| 関数 | 役割 |
| --- | --- |
| `inbox_route_contract()` | 契約名・出口一覧・必須パラメータ・文字数上限・エラーコードを返す |
| `route_inbox_item(p_inbox_id, p_exit, p_params, p_idempotency_key)` | 1件を1トランザクションで振り分ける |
| `complete_inbox_route(p_idempotency_key, p_target_id, p_target_url)` | 予定（calendar）の外部作成成功を確定する |
| `fail_inbox_route(p_idempotency_key, p_error_code)` | 予定の外部作成失敗を記録する |

実行権限は`service_role`（とオーナーの`postgres`）だけ。`security invoker`のため、書き込み権限は呼び出し側のロールに従う。

## 使い方の手順

1. `select inbox_route_contract() ->> 'contract';` が `inbox-route-v1` であることを確認する。違えば振り分けを止め、利用者へ知らせる。
2. 未整理のInboxを `select id, content, result from idea_inbox where status = 'pending'` で読む。
3. 1件ごとに新しいUUIDを作り、`route_inbox_item` を呼ぶ。同じ振り分けを再送するときは同じUUIDを使う。
4. 応答の`state`を見る。
   - `completed`: 完了。`inbox.result` に処理結果の文言が入っている。
   - `awaiting_external`: 予定（calendar）だけ。Google Calendarに予定を作り、`complete_inbox_route` で確定する。作成できなければ `fail_inbox_route` を呼ぶ。
5. `replayed: true` は同じ処理IDの再送で、前回の結果をそのまま返したことを示す。二重登録はされていない。

```sql
select route_inbox_item(
  123,
  'knowledge',
  '{"expected":{"content":"<Inboxのcontentそのまま>"},"title":"調べること","detail":null}'::jsonb,
  gen_random_uuid()
);
```

## `p_params` の共通項目

- `expected`（必須）: `{ "content": "<読んだときのcontent>" }`。`"result"` も入れると一致を確認する（アプリは入れる）。
  Inboxが`pending`でない、または内容が変わっていると `INBOX_ROUTE_CONFLICT` になる。再読込してやり直す。
- 知らないキーを入れると `INBOX_ROUTE_INVALID` になる（`detail`に原因のキー名）。
- 文字列は前後の空白を除き、空文字は未指定として扱う。

## 出口ごとの `p_params`

| `p_exit` | 画面の名前 | 必須 | 任意 | 書き込み先 | Inboxのresult |
| --- | --- | --- | --- | --- | --- |
| `calendar` | 予定 | `title`, `calendar` | `detail`, `intent`（`act`既定 / `explore`） | Want + `want_routes`(planned→created) + `scheduled_actions` | `Google Calendarへ振り分け` |
| `wish` | 欲しいもの | – | `content`（既定はInboxの内容）, `note` | `wants`（`type='wish'`, active） | `欲しいものとしてWantsに保存` |
| `writing` | 執筆 | `title` | `detail`（問い） | `writing_topics`（candidate） | `Writingへ振り分け` |
| `knowledge` | 調査 | `title` | `detail` | `want_routes`（planned） | `Knowledge候補へ振り分け` |
| `habit` | 習慣 | `title`, `cadence`（`daily`/`weekdays`/`weekly`/`flexible`） | `detail`（目的） | `habits`（active） | `Habitsへ振り分け` |
| `focus` | Focus | `title` | `detail` | `focus_items`（active、最大5件） | `Focusへ振り分け` |
| `github` | 開発 | `title` | `detail` | `want_routes`（planned、GitHubへは送らない） | `GitHub Issueへ振り分け` |
| `journal` | 日記 | `title` | `detail` | `want_routes`（planned） | `Journal候補へ振り分け` |
| `defer` | 保留 | `revisit_on`（YYYY-MM-DD、今日以降） | `content`, `note` | `wants`（`type='want'`, `revisit_on`） | `保留（再訪 YYYY-MM-DD）` |
| `archive` | アーカイブ | `title` | `detail`, `intent`（`discard`既定 / `keep`） | `want_routes`（created, `target_id='want:<id>'`） | `アーカイブへ振り分け` |
| `project_create` | Project（新規） | `title`, `outcome`, `next_action` | `theme`（120字）, `target_on` | `projects` / `project_items` / `project_actions` | `Project「<title>」に整理` |
| `project_link` | Project（既存） | `project_id`（数値）, `project_updated_at`（読んだ値そのまま） | – | `project_items`（unprocessed） | `Project「<title>」に整理` |
| `close` | Inboxクローズ | – | – | `idea_inbox.status='done'` | 変更しない |

`title`は240字、`detail`・`content`・`note`・`outcome`は2000字、`next_action`は500字まで。
`calendar`は `{"allDay":true,"date":"2026-10-01","startTime":null,"endTime":null,"timeZone":"Asia/Tokyo"}` または
`{"allDay":false,"date":"2026-10-01","startTime":"09:00","endTime":"09:30","timeZone":"Asia/Tokyo"}` の5キー固定。

`writing`・`knowledge`・`habit`・`focus`・`github`・`journal`・`archive`・`calendar`は、Inboxの内容で履歴用のWantを1件作り（`source_inbox_id`つき）、振り分けが確定するとそのWantは`completed`になる。

## 予定（calendar）の2段階

```text
route_inbox_item(exit='calendar')  → state=awaiting_external（Inboxはpendingのまま）
  ↓ Google Calendarに予定を作る
complete_inbox_route(key, <event id>, <URL>) → route created / Want completed / scheduled_actions作成 / Inbox done
  （失敗時）fail_inbox_route(key, 'GOOGLE_CALENDAR_REQUEST_FAILED') → route failed / Inboxはpendingのまま
  （再試行）同じキーで route_inbox_item → failedをplannedへ戻して awaiting_external を返す
```

- ダッシュボードは処理IDから決まる予定ID（`pd` + UUIDのハイフン除去）で作成するため、再送しても予定は増えない。
- スキルは予定IDを指定できないことがあるため、**予定を作る前に必ず** `route_inbox_item` を同じキーで呼び直し、
  `route.status` が `created` なら作成しない。`awaiting_external` のときだけ作成する。
- `complete_inbox_route` を同じキー・同じ`target_id`で再送しても前回の結果を返す。違う`target_id`は `IDEMPOTENCY_CONFLICT`。

## エラー

DB関数は `raise exception` の message にコードを入れる（PostgRESTでは`message`、SQL実行では`ERROR: <コード>`）。

| コード | 意味 | 対処 |
| --- | --- | --- |
| `INBOX_ROUTE_INVALID` | 入力不正。`detail`に原因のキー | 入力を直す。再送しても同じ |
| `INBOX_NOT_FOUND` | Inboxがない | 一覧を読み直す |
| `INBOX_ROUTE_CONFLICT` | Inboxがpendingでない、または内容が変わった | 読み直して判断し直す |
| `IDEMPOTENCY_CONFLICT` | 同じ処理IDで別内容・別Inboxが記録済み | 新しいUUIDで出し直すか、前回の結果を確認する |
| `ROUTE_NOT_FOUND` / `ROUTE_STATE_CONFLICT` | 予定の確定・失敗記録の対象がない、または状態が合わない | `want_routes`を読んで状態を確認する |
| `FOCUS_ACTIVE_LIMIT` | Focusが5件 | 何も書き込まれていない。利用者に1件外してもらう |
| `PROJECT_*` | Project側の競合・不正 | Projectを読み直す |

エラー時はトランザクション全体が巻き戻るため、Want・route・Inboxのどれも途中状態で残らない。

## 再送判定

- Wantを作る出口: `wants.idempotency_key` で判定する。同じキー・同じ内容なら前回の結果を返す。
- Project: そのInboxがすでにProjectへ入っていて、同じProject（新規は同じタイトル）なら前回の結果を返す。
- クローズ: すでに`done`で内容が期待どおりなら成功として返す。
