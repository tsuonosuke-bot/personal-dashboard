---
name: my-profile
description: 自分の情報（住まい・家電・デバイス・持ち物・使っているサービス・乗り物・仕事・好み・習慣など、自分の環境や前提）を Supabase knowledge-db の personal_profile に溜め、会話で使うスキル。「自分の情報に登録して」「持ち物に追加して」「〇〇を買った／買い替えた」「引っ越した」「〇〇はもう使っていない」「自分の情報を見せて」などのリクエストで使う。また「うちの洗濯機の〜」「私のパソコンで〜」「家の近くで〜」のように、答えがユーザーの持ち物や環境で変わる質問に答える前にも使い、登録済みの情報を読んでから答える。学んだ知識の登録（knowledge-db）、思いつきやタスクの登録（idea-inbox）には使わない。
---

# 自分の情報（my-profile）

住まい・持ち物・デバイス・使っているサービスなど、「自分の前提」を `personal_profile` に1行1項目で置き、
会話で毎回説明しなくて済むようにする。Issue #85。

## 接続

- Supabase: knowledge-db / project ref `plwlxwidpqbunugfxjhp`。Supabase MCP の `execute_sql` を使う。

## 読むときの決まり

- **読むのは `public.personal_profile_for_ai` だけ。** `ai_visible = false`（AIに渡さない）の行はここに出ない。
  `public.personal_profile` を直接 `select *` しない。
- 質問に関係する分類だけを読む。全件を会話に貼らない。
- `current = false` の行は過去のもの（買い替え前・引っ越し前）。「今の〜」を答えるときは `current = true` だけを使い、
  「前の〜は？」のときに過去の行を使う。
- 登録が無ければ、推測で埋めずに「登録が無い」と伝え、登録するか尋ねる。

```sql
-- 今のものを分類で絞って読む（分類は下の表から選ぶ。全分類なら where を current だけにする）
select id, category, name, value, detail, since
from public.personal_profile_for_ai
where current and category = any(array['家電', 'デバイス'])
order by category, name;

-- 名前で探す（過去のものも含む）
select id, category, name, value, detail, since, until, current
from public.personal_profile_for_ai
where name ilike '%洗濯機%' or value ilike '%洗濯機%'
order by current desc, since desc nulls last;
```

## 分類

| category | 例 |
| --- | --- |
| 住まい | 住んでいる地域（市区町村まで）、間取り、最寄り駅、ネット回線 |
| 家電 | 洗濯機、冷蔵庫、エアコン、炊飯器 |
| デバイス | パソコン、スマホ、タブレット、イヤホン、モニター |
| 持ち物 | 家具、自転車用品、カメラ、文房具など家電・デバイス以外 |
| サービス | 契約・サブスク・クラウド（携帯キャリア、動画配信、エディタ、AIサービス） |
| 乗り物 | 車、自転車、よく使う路線 |
| 仕事 | 職種、使っている技術、勤務形態 |
| 好み・習慣 | 食の好み、苦手なもの、生活リズム |
| その他 | 上のどれにも当てはまらないもの |

- `name` は「何の」（洗濯機、ノートPC、携帯キャリア）。同じ分類・名前で今のものは1つだけ。
- `value` は「何を」（メーカー・型番・プラン名など、答えに効く具体的な値）。
- `detail` は補足（購入時期・購入店・保証・設定・気になっている点）。無ければ入れない。
- `since` は使い始めた日・引っ越した日。分からなければ空（買い替え関数では今日になる）。

## 入れないもの

次は**登録しない**。頼まれても理由を伝えて断り、必要なら別の安全な置き場所（パスワード管理アプリなど）を勧める。

- 住所の番地・部屋番号（住まいは市区町村・最寄り駅まで）
- 口座番号・カード番号・パスワード・暗証番号・認証コード・APIキー
- マイナンバー・パスポート番号・保険証番号などの公的な番号
- 家族や他人の個人情報（名前・連絡先など）

## 書くときの決まり

- ユーザーが登録・変更をはっきり頼んだら、その内容で書く。書いた後に `returning` の結果を1行で伝える。
- 会話の中で持ち物や環境の話が出ただけ（「最近ドラム式に替えたんだけど」など）なら、
  **登録してよいか先に尋ねる**。尋ねずに書かない。
- 「AIに渡さないで」「非公開で」と言われた項目だけ `ai_visible = false` にする。既定は `true`。
- 同じ分類・名前で今のものがあるときは、上書きせず買い替えとして扱う（`replace_personal_profile`）。
  明らかな入力ミスの訂正だけ `update` で直す。

### 新しく登録する

```sql
insert into public.personal_profile (category, name, value, detail, since, ai_visible)
values ('家電', '洗濯機', 'パナソニック NA-LX129C（ドラム式）', '2025年3月にヨドバシで購入。5年保証', '2025-03-15', true)
returning id, category, name, value, since;
```

一意制約（`personal_profile_current_name_idx`）で失敗したら、同じ分類・名前の今のものがある。
読み直して、買い替えか訂正かをユーザーに確かめる。

### 買い替え・引っ越し

今の行を「使い始めた日の前日」で終え、新しい行を足す（公開範囲は引き継ぐ）。今の行が無ければ足すだけ。

```sql
select * from public.replace_personal_profile('デバイス', 'ノートPC', 'MacBook Air M4 13インチ', '16GB / 512GB', '2026-10-01');
```

### もう使っていない（手放した・解約した）

```sql
update public.personal_profile
set until = public.jst_today()
where id = <id> and until is null
returning id, name, until;
```

### 入力ミスを直す

```sql
update public.personal_profile
set value = '<正しい値>'
where id = <id>
returning id, name, value;
```

### AIに渡さない・渡す

```sql
update public.personal_profile
set ai_visible = false
where id = <id>
returning id, name, ai_visible;
```

非公開の行はビューに出ないので、非公開の行を戻すときだけ、中身を読まずに名前で探す。

```sql
select id, category, name from public.personal_profile where not ai_visible order by category, name;
```

## 報告

- 書いたときは、分類・名前・値（非公開ならその旨）を1行で伝える。
- 読んだ情報で答えたときは、どの登録（例: 「家電: 洗濯機 = パナソニック NA-LX129C」）を前提にしたかを添える。

## 注意

- `delete` はしない。間違えて作った行の削除を頼まれたときだけ、対象を示して承認を得てから消す。
- `knowledge`・`idea_inbox`・`daily_journal` には書かない。日記に書かれた持ち物の話を拾って登録するのも、
  ユーザーが頼んだときだけ。
