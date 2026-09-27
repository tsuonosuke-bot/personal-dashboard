-- The table comment still described the retired next_actions flow. Describe
-- the current Inbox -> Wants -> want_routes / project_actions structure.

comment on table public.wants is
  'やりたいこと・欲しいもの・再訪待ちの着想の器。捕獲はidea_inboxが担い、Inboxの振り分けで作られる(source_inbox_id)。'
  'type: want(再訪待ちの着想・振り分け元)/wish(欲しいもの)/concern(心配事)。'
  'status: active(未整理・再訪待ち)/completed(振り分け済み)。revisit_onが来たactiveのWantは再訪で浮上する。'
  '振り分け結果はwant_routesに記録し、正本はGoogle Calendar・GitHub Issue・writing_topics・habits・focus_items・Knowledge DB等に置く。'
  'プロジェクトの具体的な一歩はproject_items経由でproject_actionsに切り出す。';
