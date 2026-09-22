-- Writing has one lightweight queue and one terminal state.
-- Preserve finished work while folding every in-progress legacy state into ideas.

update public.writing_topics
   set status = case
     when status in ('completed', 'archived') then 'completed'
     else 'candidate'
   end
 where status not in ('candidate', 'completed');

alter table public.writing_topics
  alter column status set default 'candidate';

alter table public.writing_topics
  drop constraint if exists writing_topics_status_check;

alter table public.writing_topics
  add constraint writing_topics_status_check
  check (status in ('candidate', 'completed'));
