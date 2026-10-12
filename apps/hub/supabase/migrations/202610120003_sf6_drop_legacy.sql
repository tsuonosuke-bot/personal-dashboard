-- SF6 redesign, phase 2 of 2: drops the tables and columns that 202610120002_sf6_sequences.sql replaced.
-- Apply this only after the new screen has been confirmed in production. Do not apply it together with phase 1.
-- The guard below stops (and changes nothing) when cautions still exist, when a combo / set play was added, edited or
-- deleted on the previous screen after it was copied, or when a drill lost its link to a copied sequence.
-- Run `select public.sf6_copy_legacy();` for rows that were added; edited or deleted rows have to be fixed by hand.

do $$
declare
  -- When sf6_copy_legacy() last ran. An old row with no copy that is older than this was copied and then deleted
  -- on the new screen (which is fine); one changed after it was never copied.
  v_last_copy timestamptz := coalesce((select max(legacy_copied_at) from public.sf6_sequences), '-infinity');
begin
  if exists (select 1 from public.sf6_notes) then
    raise exception 'SF6_NOTES_NOT_EMPTY';
  end if;
  -- added or edited on the previous screen after the copy, or deleted there after the copy
  if exists (
    select 1 from public.sf6_combos c left join public.sf6_sequences s on s.legacy_combo_id = c.id
    where (s.id is null and c.updated_at > v_last_copy) or c.updated_at > s.legacy_copied_at
  ) or exists (
    select 1 from public.sf6_sequences s
    where s.legacy_combo_id is not null and not exists (select 1 from public.sf6_combos c where c.id = s.legacy_combo_id)
  ) then
    raise exception 'SF6_COMBOS_NOT_COPIED';
  end if;
  if exists (
    select 1 from public.sf6_setplays p left join public.sf6_sequences s on s.legacy_setplay_id = p.id
    where (s.id is null and p.updated_at > v_last_copy) or p.updated_at > s.legacy_copied_at
  ) or exists (
    select 1 from public.sf6_sequences s
    where s.legacy_setplay_id is not null and not exists (select 1 from public.sf6_setplays p where p.id = s.legacy_setplay_id)
  ) then
    raise exception 'SF6_SETPLAYS_NOT_COPIED';
  end if;
  -- a drill whose copied sequence still exists but was not linked (a sequence deleted on the new screen is fine)
  if exists (
    select 1 from public.sf6_drills d
    where d.sequence_ids = '{}'
      and exists (select 1 from public.sf6_sequences s
                  where (d.combo_id is not null and s.legacy_combo_id = d.combo_id)
                     or (d.setplay_id is not null and s.legacy_setplay_id = d.setplay_id))
  ) then
    raise exception 'SF6_DRILLS_NOT_COPIED';
  end if;
end $$;

drop function if exists public.sf6_copy_legacy();
alter table public.sf6_drills drop column if exists combo_id, drop column if exists setplay_id;
-- sf6_setplays.follow_combo_id references sf6_combos, so set plays go first
drop table if exists public.sf6_setplays;
drop table if exists public.sf6_combos;
drop table if exists public.sf6_notes;
alter table public.sf6_sequences
  drop column if exists legacy_combo_id,
  drop column if exists legacy_setplay_id,
  drop column if exists legacy_copied_at;
