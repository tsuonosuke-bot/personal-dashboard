-- Focus（どこかで得た示唆）と、その根拠・関連になるKnowledgeを多対多で紐づける。
-- 元のFocusやKnowledgeを削除した場合は紐づけだけを消す。

create table if not exists public.focus_knowledge_links (
  focus_id bigint not null references public.focus_items (id) on delete cascade,
  knowledge_id uuid not null references public.knowledge (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (focus_id, knowledge_id)
);

create index if not exists focus_knowledge_links_knowledge_id_idx
  on public.focus_knowledge_links (knowledge_id);

alter table public.focus_knowledge_links enable row level security;

revoke all on table public.focus_knowledge_links from anon;
revoke all on table public.focus_knowledge_links from authenticated;
grant select, insert, delete on table public.focus_knowledge_links to service_role;

comment on table public.focus_knowledge_links is
  'Links a Focus insight to related Knowledge entries. Managed from Personal Hub via the service role only.';
