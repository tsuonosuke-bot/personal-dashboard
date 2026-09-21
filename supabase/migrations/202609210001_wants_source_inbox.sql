-- Wants created from an Inbox item only referenced it through the free-text
-- result. Keep the link explicit so each Inbox row can show where it went and
-- which items are still waiting for a Knowledge DB entry.

alter table public.wants
  add column if not exists source_inbox_id bigint references public.idea_inbox(id) on delete set null;

create index if not exists wants_source_inbox_id_idx
  on public.wants (source_inbox_id)
  where source_inbox_id is not null;

comment on column public.wants.source_inbox_id is
  'The idea_inbox row this Want was created from, when it came from the Idea dashboard.';
