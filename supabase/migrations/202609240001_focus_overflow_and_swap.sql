-- Focus stays a five-item board, but a full board no longer blocks routing.
-- New Focus items added while five are active are stored as archived (控え),
-- and swap_focus_items atomically replaces one active item with a stored one.

create or replace function public.enforce_focus_board_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  active_count integer;
  existing_sort_order integer;
  needs_active_slot boolean;
begin
  if tg_op = 'INSERT' then
    needs_active_slot := new.status = 'active';
  else
    needs_active_slot := new.status = 'active' and old.status <> 'active';
  end if;

  if new.status = 'archived' then
    new.sort_order := null;
  elsif needs_active_slot then
    perform pg_advisory_xact_lock(7092026003);

    -- Let INSERT ... ON CONFLICT (source_route_id) reach its UPDATE path.
    -- The UPDATE trigger will enforce the limit if the stored item is archived.
    if tg_op = 'INSERT' then
      select sort_order
      into existing_sort_order
      from public.focus_items
      where source_route_id = new.source_route_id;

      if found then
        new.sort_order := existing_sort_order;
        return new;
      end if;
    end if;

    select count(*)
    into active_count
    from public.focus_items
    where status = 'active'
      and (tg_op = 'INSERT' or id <> new.id);

    if active_count >= 5 then
      if tg_op = 'INSERT' then
        new.status := 'archived';
        new.sort_order := null;
        return new;
      end if;
      raise exception using
        errcode = 'P0001',
        message = 'FOCUS_ACTIVE_LIMIT';
    end if;

    select coalesce(max(sort_order), 0) + 1
    into new.sort_order
    from public.focus_items
    where status = 'active'
      and (tg_op = 'INSERT' or id <> new.id);
  elsif new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1
    into new.sort_order
    from public.focus_items
    where status = 'active' and id <> new.id;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.swap_focus_items(
  p_activate_id bigint,
  p_archive_id bigint
)
returns setof public.focus_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position integer;
begin
  if p_activate_id is null or p_archive_id is null
     or p_activate_id <= 0 or p_archive_id <= 0
     or p_activate_id = p_archive_id then
    raise exception using errcode = 'P0001', message = 'FOCUS_SWAP_INVALID';
  end if;

  perform pg_advisory_xact_lock(7092026003);

  select sort_order
  into v_position
  from public.focus_items
  where id = p_archive_id and status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FOCUS_SWAP_CONFLICT';
  end if;

  perform 1
  from public.focus_items
  where id = p_activate_id and status = 'archived'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FOCUS_SWAP_CONFLICT';
  end if;

  update public.focus_items set status = 'archived' where id = p_archive_id;
  update public.focus_items set status = 'active' where id = p_activate_id;
  update public.focus_items set sort_order = v_position where id = p_activate_id;

  return query
  select focus.*
  from public.focus_items as focus
  where focus.status = 'active'
  order by focus.sort_order asc, focus.created_at asc, focus.id asc;
end;
$$;

revoke all on function public.swap_focus_items(bigint, bigint) from public;
revoke all on function public.swap_focus_items(bigint, bigint) from anon;
revoke all on function public.swap_focus_items(bigint, bigint) from authenticated;
grant execute on function public.swap_focus_items(bigint, bigint) to service_role;

comment on function public.swap_focus_items(bigint, bigint) is
  'Atomically archives one active Focus and shows a stored one in its position.';
