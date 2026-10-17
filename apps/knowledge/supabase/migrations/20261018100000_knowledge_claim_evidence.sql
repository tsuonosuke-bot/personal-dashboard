-- 著者の主張の根拠（数値・研究・事例）を書く欄。出典元は既存の source_note に書く。
alter table public.knowledge
  add column if not exists claim_evidence text;

alter table public.knowledge
  add constraint knowledge_claim_evidence_length
  check (claim_evidence is null or char_length(claim_evidence) <= 5000);

-- Include the new field in the existing version bump trigger.
drop trigger if exists knowledge_content_version_trigger on public.knowledge;
create trigger knowledge_content_version_trigger
before update of title, explanation, source_note, claim_evidence, category, knowledge_kind, mastery, priority, tags, next_review_on, archived
on public.knowledge
for each row execute function public.bump_knowledge_content_version();
