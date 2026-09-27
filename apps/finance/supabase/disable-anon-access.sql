-- Cloudflare Pages Functions経由の表示確認後に実行すること。
-- 先に実行すると、旧ブラウザ直接接続版はデータを取得できなくなる。

begin;

revoke all privileges on table public.expenses from anon;
revoke all privileges on table public.budget_categories from anon;

commit;
