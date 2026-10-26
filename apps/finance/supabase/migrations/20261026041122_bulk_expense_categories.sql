-- Bounded category-only updates. Amounts/signs and original-value CAS remain unchanged.
begin;
create or replace function public.bulk_categorize_expenses(p_category text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_input jsonb;
  v_original jsonb;
  v_id bigint;
  v_row public.expenses%rowtype;
  v_result jsonb := '[]'::jsonb;
begin
  if p_category is null or p_category <> btrim(p_category) or length(p_category) not between 1 and 100
     or p_category = '97_未分類' or left(p_category, 3) = '80_'
     or not exists (select 1 from public.budget_categories where name = p_category)
     or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid bulk category input';
  end if;
  if jsonb_array_length(p_items) not between 1 and 25 then
    raise exception using errcode = '22023', message = 'Bulk category limit is 25';
  end if;
  -- Validate every snapshot before taking any locks or changing a row.
  for v_input in select value from jsonb_array_elements(p_items) loop
    v_original := v_input->'original';
    if jsonb_typeof(v_input) <> 'object' or (select count(*) from jsonb_object_keys(v_input)) <> 2
       or not (v_input ? 'id' and v_input ? 'original')
       or jsonb_typeof(v_input->'id') <> 'number' or (v_input->>'id') !~ '^[1-9][0-9]*$'
       or jsonb_typeof(v_original) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid expense snapshot';
    end if;
    if (select count(*) from jsonb_object_keys(v_original)) <> 6
       or not (v_original ?& array['transaction_date','amount','title','category','payer','memo'])
       or jsonb_typeof(v_original->'transaction_date') <> 'string'
       or (v_original->>'transaction_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_original->'amount') <> 'number'
       or (v_original->>'amount') !~ '^-?[0-9]+$'
       or abs((v_original->>'amount')::numeric) > 1000000000
       or jsonb_typeof(v_original->'title') <> 'string' or length(v_original->>'title') not between 1 and 200
       or v_original->>'category' is distinct from '97_未分類'
       or jsonb_typeof(v_original->'payer') not in ('string','null')
       or length(v_original->>'payer') > 100
       or jsonb_typeof(v_original->'memo') not in ('string','null')
       or length(v_original->>'memo') > 2000 then
      raise exception using errcode = '22023', message = 'Invalid expense snapshot';
    end if;
    perform (v_input->>'id')::bigint, (v_original->>'transaction_date')::date;
  end loop;
  if (select count(distinct (value->>'id')::bigint) from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'Duplicate expense IDs';
  end if;
  -- Shared lock order also covers overlapping batches in separate requests.
  perform id from public.expenses
    where id in (select (value->>'id')::bigint from jsonb_array_elements(p_items))
    order by id for update;
  for v_input in select value from jsonb_array_elements(p_items) loop
    v_id := (v_input->>'id')::bigint;
    v_original := v_input->'original';
    begin
      select * into v_row from public.expenses where id = v_id;
      if not found or v_row.voided_at is not null
         or v_row.transaction_date is distinct from (v_original->>'transaction_date')::date
         or v_row.amount is distinct from (v_original->>'amount')::numeric
         or coalesce(v_row.title, '') is distinct from v_original->>'title'
         or v_row.payer is distinct from v_original->>'payer'
         or v_row.memo is distinct from v_original->>'memo'
         or coalesce(nullif(btrim(v_row.category), ''), '97_未分類') not in ('97_未分類', p_category) then
        v_result := v_result || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'conflict'));
      else
        if v_row.category is distinct from p_category then
          update public.expenses set category = p_category where id = v_id returning * into v_row;
        end if;
        v_result := v_result || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'updated', 'item', to_jsonb(v_row)));
      end if;
    exception when others then
      v_result := v_result || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'failed'));
    end;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.bulk_categorize_expenses(text, jsonb) from public, anon, authenticated;
grant execute on function public.bulk_categorize_expenses(text, jsonb) to service_role;

insert into public.dashboard_schema_versions(app_id, migration, updated_at)
values ('financial-dashboard', '20261026041122_bulk_expense_categories', now())
on conflict(app_id) do update set migration = excluded.migration, updated_at = excluded.updated_at;
notify pgrst, 'reload schema';
commit;
