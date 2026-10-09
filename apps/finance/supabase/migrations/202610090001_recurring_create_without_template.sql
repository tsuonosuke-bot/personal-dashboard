-- 定期登録をテンプレートなし（ルール0件の状態）からも作れるようにする。引数は変えず、p_template_rule_id にnullを許す。
begin;

create or replace function public.create_recurring_expense_rule(
  p_template_rule_id bigint,
  p_start_date date,
  p_frequency text,
  p_interval_count integer,
  p_end_date date,
  p_amount bigint,
  p_title text,
  p_category text,
  p_payer text,
  p_memo text
) returns setof public.recurring_expenses
language plpgsql security definer set search_path = public as $$
declare
  template_row public.recurring_expenses%rowtype;
  created_rule public.recurring_expenses%rowtype;
begin
  if p_frequency not in ('daily', 'weekly', 'monthly') or p_interval_count not between 1 and 365 then
    raise exception 'invalid recurring schedule';
  end if;
  if p_start_date is null or p_amount = 0 or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid recurring values';
  end if;
  -- p_template_rule_id がnullなら、複製元のない最初のルールとして作る。
  if p_template_rule_id is not null then
    select * into strict template_row from public.recurring_expenses where id = p_template_rule_id;
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'end date precedes start date';
  end if;
  insert into public.recurring_expenses (
    template_rule_id, frequency, interval_count, day_of_month, start_date, end_date, next_run_date,
    amount, title, category, payer, memo
  ) values (
    template_row.id, p_frequency, p_interval_count, extract(day from p_start_date)::integer, p_start_date, p_end_date, p_start_date,
    p_amount, btrim(p_title), btrim(p_category), nullif(btrim(p_payer), ''), nullif(btrim(p_memo), '')
  ) returning * into created_rule;
  return next created_rule;
end
$$;

revoke all on function public.create_recurring_expense_rule(bigint, date, text, integer, date, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_recurring_expense_rule(bigint, date, text, integer, date, bigint, text, text, text, text) to service_role;

update public.dashboard_schema_versions
set migration = '202610090001_recurring_create_without_template', updated_at = now()
where app_id = 'financial-dashboard';

notify pgrst, 'reload schema';

commit;
