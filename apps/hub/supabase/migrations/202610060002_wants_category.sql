-- Wantsを「やりたいことのバックログ」として分類する列。nullは未分類。
-- 既存行は、Notionから取り込んだ際のメモの出典タグ（Notion Inbox［行きたい場所］など）と type='wish' から埋める。
-- Inboxからの振り分けで作るWantはnullのまま入り、Ideaの画面で分類を選ぶ。

alter table public.wants
  add column if not exists category text;

alter table public.wants
  drop constraint if exists wants_category_check;

alter table public.wants
  add constraint wants_category_check
  check (category is null or category in ('place', 'watch', 'play', 'read', 'do', 'wish'));

comment on column public.wants.category is
  'バックログの分類。place=行きたい, watch=観たい, play=遊びたい, read=読みたい, do=やってみたい, wish=欲しい。nullは未分類。';

update public.wants
set category = case
  when type = 'wish' or note like '%［欲しいもの］%' then 'wish'
  when note like '%［行きたい場所］%' then 'place'
  when note like '%［見たい映画/アニメ］%' then 'watch'
  when note like '%［プレイしたいゲーム］%' then 'play'
  when note like '%［読みたい本］%' then 'read'
  when note like '%［その他やりたいこと］%' then 'do'
end
where category is null;
