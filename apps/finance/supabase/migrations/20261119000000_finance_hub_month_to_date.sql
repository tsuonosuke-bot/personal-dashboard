-- Hub home finance panel (#340): add previous-month spend up to the same day and the unclassified count.
-- Existing keys are unchanged, so the Hub keeps working before and after this is applied. No expense rows are changed.
begin;

create or replace function public.get_finance_hub_summary(p_today date)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as month_start,
      (date_trunc('month', p_today) - interval '1 month')::date as previous_start,
      -- Same day of the previous month, clamped to its last day (e.g. 3/31 -> 2/28).
      least((date_trunc('month', p_today) - interval '1 month')::date + (extract(day from p_today)::int - 1),
        date_trunc('month', p_today)::date - 1) as previous_same_day
  )
  select jsonb_build_object(
    'currentMonthSpend', coalesce((select sum(amount) from public.expenses, bounds b
      where voided_at is null and amount > 0 and left(btrim(category), 3) <> '80_'
        and transaction_date >= b.month_start
        and transaction_date < b.month_start + interval '1 month'), 0),
    'previousMonthSpend', coalesce((select sum(amount) from public.expenses, bounds b
      where voided_at is null and amount > 0 and left(btrim(category), 3) <> '80_'
        and transaction_date >= b.previous_start
        and transaction_date < b.month_start), 0),
    'previousMonthToDateSpend', coalesce((select sum(amount) from public.expenses, bounds b
      where voided_at is null and amount > 0 and left(btrim(category), 3) <> '80_'
        and transaction_date >= b.previous_start
        and transaction_date <= b.previous_same_day), 0),
    'unclassifiedCount', (select count(*) from public.expenses where voided_at is null
      and coalesce(nullif(btrim(category), ''), '97_未分類') = '97_未分類'),
    'recentExpenses', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select id, transaction_date, amount, title, category, payer, created_at
      from public.expenses where voided_at is null
        and transaction_date >= date_trunc('month', p_today) - interval '1 month'
      order by transaction_date desc, id desc limit 5
    ) r), '[]'::jsonb)
  );
$$;

revoke all on function public.get_finance_hub_summary(date) from public, anon, authenticated;
grant execute on function public.get_finance_hub_summary(date) to service_role;

commit;
