-- Existing cards remain unclassified until reviewed by their owner.
alter table public.knowledge
  add column if not exists knowledge_kind text not null default '未分類';

alter table public.knowledge
  add constraint knowledge_kind_allowed
  check (knowledge_kind in ('未分類', '事実', '著者の主張', '自分のメモ'));

-- Include the new field in the existing version bump trigger.
drop trigger if exists knowledge_content_version_trigger on public.knowledge;
create trigger knowledge_content_version_trigger
before update of title, explanation, source_note, category, knowledge_kind, mastery, priority, tags, next_review_on, archived
on public.knowledge
for each row execute function public.bump_knowledge_content_version();
