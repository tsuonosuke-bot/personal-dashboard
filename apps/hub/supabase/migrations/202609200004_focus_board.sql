-- Focus is a deliberately small board: at most five active items.
-- Creation still happens through Want routing; this migration adds the
-- server-side invariants and an atomic reorder operation used by Personal Hub.

do $$
begin
  if (select count(*) from public.focus_items where status = 'active') > 5 then
    raise exception using
      errcode = 'P0001',
      message = 'FOCUS_ACTIVE_LIMIT';
  end if;
end;
$$;

with ranked as (
  select
    id,
    row_number() over (
      order by sort_order asc nulls last, created_at asc, id asc
    )::integer as position
  from public.focus_items
  where status = 'active'
)
update public.focus_items as focus
set sort_order = ranked.position
from ranked
where focus.id = ranked.id;

update public.focus_items
set sort_order = null
where status = 'archived' and sort_order is not null;

create index if not exists focus_items_status_sort_order_idx
  on public.focus_items (status, sort_order, id);

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

drop trigger if exists focus_board_limit_trigger on public.focus_items;
create trigger focus_board_limit_trigger
before insert or update on public.focus_items
for each row execute function public.enforce_focus_board_limit();

create or replace function public.reorder_focus_items(
  p_ids bigint[],
  p_original_ids bigint[]
)
returns setof public.focus_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ids bigint[];
begin
  if p_ids is null or p_original_ids is null
     or cardinality(p_ids) > 5
     or cardinality(p_ids) <> cardinality(p_original_ids)
     or exists (
       select 1 from unnest(p_ids) as item(id)
       where item.id is null or item.id <= 0
     )
     or exists (
       select 1 from unnest(p_original_ids) as item(id)
       where item.id is null or item.id <= 0
     )
     or (select count(*) from unnest(p_ids) as item(id))
        <> (select count(distinct item.id) from unnest(p_ids) as item(id))
     or (select count(*) from unnest(p_original_ids) as item(id))
        <> (select count(distinct item.id) from unnest(p_original_ids) as item(id)) then
    raise exception using
      errcode = 'P0001',
      message = 'FOCUS_REORDER_INVALID';
  end if;

  perform pg_advisory_xact_lock(7092026003);

  select coalesce(array_agg(id order by sort_order asc nulls last, created_at asc, id asc), '{}'::bigint[])
  into current_ids
  from public.focus_items
  where status = 'active';

  if current_ids <> p_original_ids then
    raise exception using
      errcode = 'P0001',
      message = 'FOCUS_REORDER_CONFLICT';
  end if;

  if not (p_ids @> p_original_ids and p_ids <@ p_original_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'FOCUS_REORDER_INVALID';
  end if;

  update public.focus_items as focus
  set sort_order = desired.position,
      updated_at = now()
  from unnest(p_ids) with ordinality as desired(id, position)
  where focus.id = desired.id
    and focus.status = 'active';

  return query
  select focus.*
  from public.focus_items as focus
  where focus.status = 'active'
  order by focus.sort_order asc, focus.created_at asc, focus.id asc;
end;
$$;

revoke all on function public.reorder_focus_items(bigint[], bigint[]) from public;
revoke all on function public.reorder_focus_items(bigint[], bigint[]) from anon;
revoke all on function public.reorder_focus_items(bigint[], bigint[]) from authenticated;
grant execute on function public.reorder_focus_items(bigint[], bigint[]) to service_role;

comment on function public.reorder_focus_items(bigint[], bigint[]) is
  'Atomically reorders the complete active Focus board after checking the caller snapshot.';
