-- Cumulative income/spending since 2026-01 (when income entry started) for the selected scope. No expense rows are changed.
begin;

create or replace function public.get_finance_overview(
  p_month date,
  p_categories text[] default null,
  p_category_mode text default 'include',
  p_payer text default null
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_months jsonb;
  v_metadata jsonb;
  v_monthly jsonb;
  v_cumulative jsonb;
  v_since constant date := date '2026-01-01';
begin
  if p_month is null or p_category_mode is null or p_category_mode not in ('include', 'exclude')
     or coalesce(cardinality(p_categories), 0) > 500 then
    raise exception 'invalid overview scope' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(m order by m desc), '[]'::jsonb)
    into v_months
    from (select distinct to_char(transaction_date, 'YYYY-MM') m
            from public.expenses where voided_at is null) months;
  v_month := date_trunc('month', p_month)::date;
  if jsonb_array_length(v_months) > 0 and not (v_months ? to_char(v_month, 'YYYY-MM')) then
    v_month := ((v_months ->> 0) || '-01')::date;
  end if;

  select jsonb_build_object(
    'months', v_months,
    'categories', coalesce((select jsonb_agg(c order by c) from (
      select distinct coalesce(nullif(btrim(category), ''), '97_未分類') c
      from public.expenses where voided_at is null
    ) categories), '[]'::jsonb),
    'payers', coalesce((select jsonb_agg(p order by p) from (
      select distinct payer p from public.expenses
      where voided_at is null and payer is not null and payer <> ''
    ) payers), '[]'::jsonb),
    'total', (select count(*) from public.expenses where voided_at is null),
    'newestTransaction', (select max(transaction_date)::text from public.expenses where voided_at is null),
    'unclassified', jsonb_build_object(
      'count', (select count(*) from public.expenses where voided_at is null
        and coalesce(nullif(btrim(category), ''), '97_未分類') = '97_未分類'),
      'months', coalesce((select jsonb_agg(m order by m desc) from (
        select distinct to_char(transaction_date, 'YYYY-MM') m from public.expenses
        where voided_at is null and coalesce(nullif(btrim(category), ''), '97_未分類') = '97_未分類'
      ) unclassified_months), '[]'::jsonb)
    ),
    'voidedCount', (select count(*) from public.expenses where voided_at is not null
      and transaction_date >= v_month and transaction_date < v_month + interval '1 month')
  ) into v_metadata;

  with scoped as (
    select to_char(e.transaction_date, 'YYYY-MM') as "month",
           coalesce(nullif(btrim(e.category), ''), '97_未分類') category, e.amount
      from public.expenses e
     where e.voided_at is null
       and e.transaction_date >= v_month - interval '11 months'
       and e.transaction_date < v_month + interval '1 month'
       and (p_payer is null or e.payer = p_payer)
       and (coalesce(cardinality(p_categories), 0) = 0
         or (p_category_mode = 'include' and coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))
         or (p_category_mode = 'exclude' and not (coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))))
  ), totals as (
    select "month", category,
           coalesce(sum(amount) filter (where left(category, 3) <> '80_'), 0) spending,
           coalesce(sum(abs(amount)) filter (where left(category, 3) = '80_'), 0) income,
           count(*) filter (where left(category, 3) <> '80_' and amount <> 0) "spendingCount"
      from scoped group by "month", category
  ) select coalesce(jsonb_agg(to_jsonb(t) order by t."month", t.category), '[]'::jsonb)
      into v_monthly from totals t;

  -- Cumulative balance since income entry began (2026-01), same scope as the monthly rows.
  if v_month >= v_since then
    select jsonb_build_object(
             'since', to_char(v_since, 'YYYY-MM'),
             'spending', coalesce(sum(e.amount) filter (where left(coalesce(nullif(btrim(e.category), ''), '97_未分類'), 3) <> '80_'), 0),
             'income', coalesce(sum(abs(e.amount)) filter (where left(coalesce(nullif(btrim(e.category), ''), '97_未分類'), 3) = '80_'), 0))
      into v_cumulative
      from public.expenses e
     where e.voided_at is null
       and e.transaction_date >= v_since
       and e.transaction_date < v_month + interval '1 month'
       and (p_payer is null or e.payer = p_payer)
       and (coalesce(cardinality(p_categories), 0) = 0
         or (p_category_mode = 'include' and coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))
         or (p_category_mode = 'exclude' and not (coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))));
  end if;

  return jsonb_build_object(
    'selectedMonth', to_char(v_month, 'YYYY-MM'),
    'metadata', v_metadata,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'notion_url', notion_url) order by name)
                            from public.budget_categories), '[]'::jsonb),
    'monthly', v_monthly,
    'cumulative', v_cumulative
  );
end;
$$;

commit;
