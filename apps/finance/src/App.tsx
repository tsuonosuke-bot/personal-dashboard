import { lazy, Suspense, useState } from 'react'
import { ExpenseFormModal } from './components/ExpenseFormModal'
import { ExpenseTable } from './components/ExpenseTable'
import { RecurringExpenseModal } from './components/RecurringExpenseModal'
import { SummaryCards } from './components/SummaryCards'
import { useExpenses } from './hooks/useExpenses'
import { useExpenseActions } from './hooks/useExpenseActions'
import { useRecurringExpenses } from './hooks/useRecurringExpenses'
import { useFinanceHelp } from './hooks/useFinanceHelp'
import { HelpView } from './components/HelpView'
import { FinanceHeader } from './components/FinanceHeader'
import { FinanceFilterToolbar } from './components/FinanceFilterToolbar'

const MonthlyTrendChart = lazy(() => import('./components/MonthlyTrendChart').then((module) => ({ default: module.MonthlyTrendChart })))
const CategoryPieChart = lazy(() => import('./components/CategoryPieChart').then((module) => ({ default: module.CategoryPieChart })))

function App() {
  const data = useExpenses()
  const { metadata, categories, loading, refreshing, error, lastUpdatedAt, reload, demoMode, mutating, overview, scope, revision, demoExpenses } = data
  const [notice, setNotice] = useState<string | null>(null)
  const filters = data.filters
  const { availablePayers, selectedMonth,
    unclassified, unclassifiedMonthNote, newestTransaction, focusUnclassified } = filters
  const { entryOpen, setEntryOpen, editingExpense, setEditingExpense, actionError, setActionError,
    closeEntry, saveExpense, voidExpense, restoreExpense, bulkCategorize } = useExpenseActions({ data, setRequestedMonth: filters.setRequestedMonth, setNotice })
  const { recurringOpen, recurringRules, recurringBusy, recurringLoading, recurringError, loadRecurringRules,
    addRecurring, toggleRecurring, editRecurring, openRecurring, closeRecurring, runRecurring } = useRecurringExpenses({ demoMode, reload, setNotice })
  const { helpOpen, openHelp, closeHelp } = useFinanceHelp()

  if (helpOpen) return <HelpView onExit={closeHelp} />

  return (
    <div className="app-page">
      <FinanceHeader error={error} loading={loading} demoMode={demoMode} reload={reload}
        openHelp={openHelp} openRecurring={openRecurring}
        openEntry={() => { setActionError(null); setEditingExpense(null); setEntryOpen(true) }} />

      <main className="app-main">
        <div className="page-tools" aria-label="データ管理">
          <a href="api/export">CSV書き出し</a>
          <a href="api/export?scope=all" title="取消済みの明細も、取消日時つきで含めます">監査用CSV（取消含む）</a>
          <a href="https://personal-dashboard-7md.pages.dev/status/">接続状態</a>
        </div>
        {!loading && !error && (
          <div className="page-meta" aria-label="Financeデータの概要">
            <span>{demoMode ? 'デモデータ' : `${metadata.total.toLocaleString('ja-JP')}件`} · {categories.length}カテゴリ</span>
            <span>最新取引 {newestTransaction || '—'}</span>
          </div>
        )}
        {notice && <div className="save-notice" role="status"><span>{notice}</span><button type="button" aria-label="閉じる" onClick={() => setNotice(null)}>×</button></div>}
        {loading && (
          <div className="panel grid min-h-64 place-items-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
              <p className="font-medium text-slate-700">Supabaseから家計簿を読み込んでいます</p>
              <p className="mt-1 text-sm text-slate-500">集計と選択月の明細を準備しています</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <p className="font-semibold text-rose-800">データを読み込めませんでした</p>
            <p className="mt-2 text-sm text-rose-700">{error}</p>
            <button type="button" onClick={reload} className="mt-4 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800">
              再試行
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="dashboard-stack">
            {demoMode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                デモモードです。Supabaseの実データは読み込んでいません。
              </div>
            )}
            {unclassified.count > 0 && (
              <button type="button" className="unclassified-alert" onClick={focusUnclassified}>
                <span className="unclassified-alert-body">
                  <span className="unclassified-alert-title">
                    未分類の明細が{unclassified.count.toLocaleString('ja-JP')}件あります
                  </span>
                  <span className="unclassified-alert-note">対象月: {unclassifiedMonthNote || '—'}</span>
                </span>
                <span className="unclassified-alert-action" aria-hidden="true">絞り込む →</span>
              </button>
            )}
            <FinanceFilterToolbar filters={filters} />
            {refreshing && <p role="status">選択した条件の集計を読み込んでいます…</p>}
            {overview && <SummaryCards monthly={overview.monthly} selectedMonth={selectedMonth} />}
            <Suspense fallback={<div className="panel grid min-h-80 place-items-center text-sm text-slate-500">グラフを読み込んでいます</div>}>
              {overview && <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2"><MonthlyTrendChart monthly={overview.monthly} selectedMonth={selectedMonth} /></div>
                <div className="min-w-0"><CategoryPieChart monthly={overview.monthly} selectedMonth={selectedMonth} /></div>
              </div>}
            </Suspense>
            <ExpenseTable
              scope={scope}
              revision={revision}
              demoExpenses={demoMode ? demoExpenses : undefined}
              onEdit={demoMode ? undefined : (expense) => {
                setActionError(null)
                setEditingExpense(expense)
                setEntryOpen(true)
              }}
              categories={categories}
              onBulkCategorize={demoMode ? undefined : bulkCategorize}
              bulkBusy={mutating}
              voidedCount={overview?.metadata.voidedCount ?? 0}
              onRestore={demoMode ? undefined : (expense) => void restoreExpense(expense)}
              restoring={mutating}
            />
            <p className="text-center text-xs text-slate-400">
              {lastUpdatedAt ? `最終読み込み ${lastUpdatedAt.toLocaleString('ja-JP')}` : ''}
            </p>
          </div>
        )}
      </main>
      {entryOpen && (
        <ExpenseFormModal
          categories={categories}
          payers={availablePayers}
          saving={mutating}
          error={actionError}
          expense={editingExpense ?? undefined}
          onClose={closeEntry}
          onSave={(draft) => void saveExpense(draft)}
          onVoid={editingExpense ? () => void voidExpense() : undefined}
        />
      )}
      {recurringOpen && (
        <RecurringExpenseModal
          categories={categories}
          rules={recurringRules}
          busy={recurringBusy}
          loading={recurringLoading}
          error={recurringError}
          onClose={closeRecurring}
          onCreate={addRecurring}
          onUpdate={editRecurring}
          onToggle={(rule) => void toggleRecurring(rule)}
          onRun={() => void runRecurring()}
          onReload={() => void loadRecurringRules()}
        />
      )}
    </div>
  )
}

export default App
