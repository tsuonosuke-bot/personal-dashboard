-- #277 / #293: bounded read models. No historical expense rows are changed.
begin;

create index if not exists expenses_active_page_idx
  on public.expenses (transaction_date desc, id desc) where voided_at is null;

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

  return jsonb_build_object(
    'selectedMonth', to_char(v_month, 'YYYY-MM'),
    'metadata', v_metadata,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'notion_url', notion_url) order by name)
                            from public.budget_categories), '[]'::jsonb),
    'monthly', v_monthly
  );
end;
$$;

create or replace function public.get_finance_expense_page(
  p_month date,
  p_categories text[] default null,
  p_category_mode text default 'include',
  p_payer text default null,
  p_query text default '',
  p_from date default null,
  p_to date default null,
  p_type text default 'all',
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_sort text default 'newest',
  p_voided boolean default false,
  p_limit integer default 50,
  p_offset integer default 0,
  p_count boolean default true
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if p_month is null or p_category_mode is null or p_category_mode not in ('include', 'exclude')
     or p_type is null or p_type not in ('all', 'expense', 'income')
     or p_sort is null or p_sort not in ('newest', 'oldest', 'amount-desc', 'amount-asc')
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_offset is null or p_offset < 0 or p_voided is null or p_count is null
     or coalesce(cardinality(p_categories), 0) > 500 or length(coalesce(p_query, '')) > 500
     or p_amount_min < 0 or p_amount_max < 0 then
    raise exception 'invalid expense page scope' using errcode = '22023';
  end if;
  with filtered as not materialized (
    select e.id, e.transaction_date, e.amount, coalesce(e.title, '') title,
           coalesce(nullif(btrim(e.category), ''), '97_未分類') category,
           e.payer, e.memo, e.notion_url, e.notion_created_at, e.created_at, e.voided_at
      from public.expenses e
     where (e.voided_at is not null) = p_voided
       and e.transaction_date >= date_trunc('month', p_month)::date
       and e.transaction_date < date_trunc('month', p_month) + interval '1 month'
       and (p_from is null or e.transaction_date >= p_from)
       and (p_to is null or e.transaction_date <= p_to)
       and (p_payer is null or e.payer = p_payer)
       and (coalesce(cardinality(p_categories), 0) = 0
         or (p_category_mode = 'include' and coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))
         or (p_category_mode = 'exclude' and not (coalesce(nullif(btrim(e.category), ''), '97_未分類') = any(p_categories))))
       and (p_type = 'all'
         or (p_type = 'income' and left(btrim(e.category), 3) = '80_')
         or (p_type = 'expense' and left(btrim(e.category), 3) <> '80_'))
       and (p_amount_min is null or abs(e.amount) >= p_amount_min)
       and (p_amount_max is null or abs(e.amount) <= p_amount_max)
       and (coalesce(p_query, '') = '' or strpos(lower(concat(coalesce(e.title, ''), ' ', coalesce(e.memo, ''), ' ',
         coalesce(nullif(btrim(e.category), ''), '97_未分類'), ' ', coalesce(e.payer, ''))), lower(p_query)) > 0)
  ), page as (
    select * from filtered
    order by
      case when p_sort = 'oldest' then transaction_date end asc,
      case when p_sort = 'newest' then transaction_date end desc,
      case when p_sort = 'amount-desc' then abs(amount) end desc,
      case when p_sort = 'amount-asc' then abs(amount) end asc,
      case when p_sort = 'oldest' then id end asc,
      id desc
    limit p_limit offset p_offset
  ) select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'::jsonb),
    'total', case when p_count then (select count(*) from filtered) else null end,
    'limit', p_limit, 'offset', p_offset
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_finance_hub_summary(p_today date)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'currentMonthSpend', coalesce((select sum(amount) from public.expenses
      where voided_at is null and amount > 0 and left(btrim(category), 3) <> '80_'
        and transaction_date >= date_trunc('month', p_today)::date
        and transaction_date < date_trunc('month', p_today) + interval '1 month'), 0),
    'previousMonthSpend', coalesce((select sum(amount) from public.expenses
      where voided_at is null and amount > 0 and left(btrim(category), 3) <> '80_'
        and transaction_date >= date_trunc('month', p_today) - interval '1 month'
        and transaction_date < date_trunc('month', p_today)::date), 0),
    'recentExpenses', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select id, transaction_date, amount, title, category, payer, created_at
      from public.expenses where voided_at is null
        and transaction_date >= date_trunc('month', p_today) - interval '1 month'
      order by transaction_date desc, id desc limit 5
    ) r), '[]'::jsonb)
  );
$$;

revoke all on function public.get_finance_overview(date, text[], text, text) from public, anon, authenticated;
revoke all on function public.get_finance_expense_page(date, text[], text, text, text, date, date, text, numeric, numeric, text, boolean, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.get_finance_hub_summary(date) from public, anon, authenticated;
grant execute on function public.get_finance_overview(date, text[], text, text) to service_role;
grant execute on function public.get_finance_expense_page(date, text[], text, text, text, date, date, text, numeric, numeric, text, boolean, integer, integer, boolean) to service_role;
grant execute on function public.get_finance_hub_summary(date) to service_role;

commit;
