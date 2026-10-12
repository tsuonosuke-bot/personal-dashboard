-- SF6 redesign, phase 2 of 2: drops the tables and columns that 202610120002_sf6_sequences.sql replaced.
-- Apply this only after the new screen has been confirmed in production. Do not apply it together with phase 1.
-- The guard below stops (and changes nothing) when cautions still exist, or when a combo / set play / drill was added
-- or edited on the previous screen after it was copied. Run `select public.sf6_copy_legacy();` for rows that were
-- added; an edited row has to be fixed by hand on the new screen first.

do $$
begin
  if exists (select 1 from public.sf6_notes) then
    raise exception 'SF6_NOTES_NOT_EMPTY';
  end if;
  if exists (
    select 1 from public.sf6_combos c left join public.sf6_sequences s on s.legacy_combo_id = c.id
    where s.id is null or c.updated_at > s.legacy_copied_at
  ) then
    raise exception 'SF6_COMBOS_NOT_COPIED';
  end if;
  if exists (
    select 1 from public.sf6_setplays p left join public.sf6_sequences s on s.legacy_setplay_id = p.id
    where s.id is null or p.updated_at > s.legacy_copied_at
  ) then
    raise exception 'SF6_SETPLAYS_NOT_COPIED';
  end if;
  if exists (select 1 from public.sf6_drills where (combo_id is not null or setplay_id is not null) and sequence_ids = '{}') then
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
