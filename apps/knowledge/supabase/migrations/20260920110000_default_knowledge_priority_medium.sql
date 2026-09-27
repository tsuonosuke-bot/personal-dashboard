-- New knowledge should default to medium priority. Existing rows are unchanged.
alter table public.knowledge
  alter column priority set default '中';
