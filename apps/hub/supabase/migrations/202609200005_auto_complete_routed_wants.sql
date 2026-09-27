-- A successfully organized Want has no separate Active phase. Keep failed
-- routes Active, and complete the source after a canonical target is created
-- or a currently plan-only destination is saved.

create or replace function public.complete_want_after_route()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'created'
     or (new.status = 'planned' and new.destination in ('github', 'knowledge', 'journal')) then
    update public.wants
       set status = 'completed'
     where id = new.want_id
       and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists complete_want_after_route on public.want_routes;

create trigger complete_want_after_route
after insert or update on public.want_routes
for each row
execute function public.complete_want_after_route();

-- Reconcile Wants organized before this rule existed. Historical planned rows
-- also represent an explicitly confirmed organization decision.
update public.wants as want
   set status = 'completed'
 where want.status = 'active'
   and exists (
     select 1
       from public.want_routes as route
      where route.want_id = want.id
        and route.status in ('planned', 'created')
   );

comment on function public.complete_want_after_route() is
  'Completes the source Want when its confirmed route is saved successfully.';
