-- 誤登録した明細を、行を消さずに取り消せるようにする（#125）。
-- voided_at が入った行は通常の一覧・集計・CSVから外し、全件出力には残す。
-- 定期登録で生成した明細を取り消しても recurring_expense_occurrences は残るため、同じ予定日は再生成されない。
begin;

alter table public.expenses add column if not exists voided_at timestamptz;
comment on column public.expenses.voided_at is '取消日時。nullなら有効な明細。取消済みの行は集計から除外する';
create index if not exists expenses_voided_at_idx on public.expenses (voided_at) where voided_at is not null;

update public.dashboard_schema_versions
set migration = '202610090002_expense_void', updated_at = now()
where app_id = 'financial-dashboard';

notify pgrst, 'reload schema';

commit;
