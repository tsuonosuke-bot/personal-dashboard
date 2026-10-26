-- このダッシュボードをCloudflare Pages Functions経由のみにする。
-- Supabase SQL Editorで実行する前に、対象が public.knowledge / public.quiz_log
-- であることを確認すること。

alter table public.knowledge enable row level security;
alter table public.quiz_log enable row level security;

revoke all privileges on table public.knowledge from public, anon;
revoke all privileges on table public.quiz_log from public, anon;

-- 実行後の確認用。すべて false ならanonの実効テーブル権限はない。
select
  has_table_privilege('anon', 'public.knowledge', 'select') as knowledge_select,
  has_table_privilege('anon', 'public.knowledge', 'insert') as knowledge_insert,
  has_table_privilege('anon', 'public.knowledge', 'update') as knowledge_update,
  has_table_privilege('anon', 'public.knowledge', 'delete') as knowledge_delete,
  has_table_privilege('anon', 'public.quiz_log', 'select') as quiz_log_select,
  has_table_privilege('anon', 'public.quiz_log', 'insert') as quiz_log_insert,
  has_table_privilege('anon', 'public.quiz_log', 'update') as quiz_log_update,
  has_table_privilege('anon', 'public.quiz_log', 'delete') as quiz_log_delete;
