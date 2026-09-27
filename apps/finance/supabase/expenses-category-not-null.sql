-- 2026-09-20 適用済み。
-- categoryがNULL/空文字のまま登録されるとフロントの明細検証で一覧が全件エラーになるため、
-- 保存時に '97_未分類' へ寄せたうえでNOT NULLを課す。
-- トリガーは制約検査より先に走るので、明示的にNULLを渡す取り込み処理も失敗しない。

begin;

create or replace function public.expenses_fill_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category is null or btrim(new.category) = '' then
    new.category := '97_未分類';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_fill_category on public.expenses;
create trigger expenses_fill_category
before insert or update on public.expenses
for each row execute function public.expenses_fill_category();

alter table public.expenses alter column category set default '97_未分類';
alter table public.expenses alter column category set not null;

commit;
