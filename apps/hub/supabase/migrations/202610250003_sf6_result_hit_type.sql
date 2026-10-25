-- SF6: 起き攻めの「相手の行動ごとの結果」に、どのヒットになるか(hit_type)を持たせる。
-- hit / counter_hit / punish_counter は起き攻め本体の同名の結果の状況を使い、other だけ個別に状況を持つ。
-- 既存の行は hit_type が null のまま(次の状況があれば「その他」として扱う)。
begin;

alter table public.sf6_sequence_results add column if not exists hit_type text
  check (hit_type is null or hit_type in ('hit', 'counter_hit', 'punish_counter', 'other'));
alter table public.sf6_sequence_results add constraint sf6_sequence_results_hit_type_shape
  check (hit_type is null or kind = 'opponent');

create or replace function public.sf6_save_sequence(
  p_id bigint,
  p_updated_at timestamptz,
  p_row jsonb,
  p_starts jsonb,
  p_results jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.sf6_sequences%rowtype;
  v_new public.sf6_sequences%rowtype;
  v_id bigint;
  v_ref jsonb;
  v_result jsonb;
begin
  if p_id is null then
    if p_starts is null then
      raise exception 'SF6_STARTS_REQUIRED';
    end if;
    v_new := jsonb_populate_record(null::public.sf6_sequences, p_row);
    insert into public.sf6_sequences (
      kind, character, title, notation, startup, damage, drive_cost, sa_cost, position,
      layering, aim, end_purpose, mastery, memo, archived
    ) values (
      v_new.kind, v_new.character, v_new.title, v_new.notation, v_new.startup, v_new.damage,
      coalesce(v_new.drive_cost, 0), coalesce(v_new.sa_cost, 0), coalesce(v_new.position, 'anywhere'),
      v_new.layering, v_new.aim, v_new.end_purpose, coalesce(v_new.mastery, 0), v_new.memo, coalesce(v_new.archived, false)
    )
    returning id into v_id;
  else
    select * into v_old from public.sf6_sequences where id = p_id for update;
    if not found or p_updated_at is null or v_old.updated_at is distinct from p_updated_at then
      raise exception 'SF6_CONFLICT';
    end if;
    v_new := jsonb_populate_record(v_old, p_row);
    update public.sf6_sequences
    set kind = v_new.kind, character = v_new.character, title = v_new.title, notation = v_new.notation,
        startup = v_new.startup, damage = v_new.damage, drive_cost = v_new.drive_cost, sa_cost = v_new.sa_cost,
        position = v_new.position, layering = v_new.layering, aim = v_new.aim, end_purpose = v_new.end_purpose,
        mastery = v_new.mastery, memo = v_new.memo, archived = v_new.archived, updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;

  if p_starts is not null then
    delete from public.sf6_sequence_starts where sequence_id = v_id;
    for v_ref in select value from jsonb_array_elements(p_starts) loop
      insert into public.sf6_sequence_starts (sequence_id, situation_id)
      values (v_id, public.sf6_resolve_situation(v_new.character, v_ref))
      on conflict do nothing;
    end loop;
    if not exists (select 1 from public.sf6_sequence_starts where sequence_id = v_id) then
      raise exception 'SF6_STARTS_REQUIRED';
    end if;
  end if;

  if p_results is not null then
    delete from public.sf6_sequence_results where sequence_id = v_id;
    for v_result in select value from jsonb_array_elements(p_results) loop
      insert into public.sf6_sequence_results (sequence_id, kind, opponent_action, outcome, hit_type, next_situation_id)
      values (
        v_id,
        v_result ->> 'kind',
        v_result ->> 'opponent_action',
        v_result ->> 'outcome',
        v_result ->> 'hit_type',
        case when coalesce(jsonb_typeof(v_result -> 'next'), 'null') = 'null' then null
          else public.sf6_resolve_situation(v_new.character, v_result -> 'next') end
      );
    end loop;
  end if;

  -- A situation of another character cannot be used (also stops changing the character of a sequence in use).
  if exists (
    select 1 from public.sf6_sequence_starts st join public.sf6_situations s on s.id = st.situation_id
    where st.sequence_id = v_id and s.character is not null and s.character <> v_new.character
    union all
    select 1 from public.sf6_sequence_results r join public.sf6_situations s on s.id = r.next_situation_id
    where r.sequence_id = v_id and s.character is not null and s.character <> v_new.character
  ) then
    raise exception 'SF6_SITUATION_CHARACTER';
  end if;
  return v_id;
end;
$$;

commit;
