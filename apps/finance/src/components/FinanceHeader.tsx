import { ThemeSelect } from './ThemeSelect'
type Props = { error: string | null; loading: boolean; demoMode: boolean; reload: () => void;
  openHelp: () => void; openRecurring: () => void; openEntry: () => void }
export function FinanceHeader({ error, loading, demoMode, reload, openHelp, openRecurring, openEntry }: Props) {
  return (
      <header className="app-header">
        <div className="app-header-inner">
          <div className="dashboard-brand">
            <span className="dashboard-brand-mark" aria-hidden="true">¥</span>
            <h1>Finance</h1>
          </div>
          <div className="header-actions">
            <a className="hub-button" href="/">
              ← Hub
            </a>
            <details className="dashboard-switcher">
              <summary aria-label="ページを切り替える">
                <svg className="dashboard-switcher-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="6" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="18" r="1" />
                  <path d="M9 6h10M9 12h10M9 18h10" />
                </svg>
                <span>Dashboards</span>
              </summary>
              <div className="dashboard-switcher-menu">
                <nav aria-label="ダッシュボードを切り替え">
                  <a href="/compass/">Idea</a>
                  <a href="/projects/">Projects</a>
                  <a href="/writing/">Writing</a>
                  <a href="/habits/">Habits</a>
                  <a href="/sf6/">SF6</a>
                  <span aria-current="page">Finance</span>
                  <a href="/go/knowledge">Knowledge</a>
                  <a href="/status/">接続状態</a>
                </nav>
                <ThemeSelect />
              </div>
            </details>
            {/* 正常時は何も出さず、確認中・デモ・失敗のときだけ知らせる */}
            {(error || loading || demoMode) && (
              <span className={`source-badge ${error ? 'error' : loading ? 'loading' : 'demo'}`}>
                {error ? '取得失敗' : loading ? '接続確認中' : 'DEMO DATA'}
              </span>
            )}
            <button type="button" onClick={reload} disabled={loading} aria-label="再読み込み" className="refresh-button">
              <span aria-hidden="true">↻</span>
            </button>
            <button type="button" onClick={openHelp} aria-label="ヘルプ" title="ヘルプ" className="refresh-button help-button">?</button>
            <button type="button" className="secondary-button recurring-button" onClick={openRecurring} disabled={loading || demoMode} aria-label="定期登録を管理">
              <svg className="recurring-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M8 2v4M16 2v4M3 9h18M8 14a4 4 0 0 1 6.5-1.1L16 14M16 11v3h-3M16 17a4 4 0 0 1-6.5 1.1L8 17M8 20v-3h3" />
              </svg>
              <span>定期登録</span>
            </button>
            <button type="button" className="primary-button add-button" onClick={openEntry} disabled={loading || demoMode}>
              ＋ 家計簿を記録
            </button>
          </div>
        </div>
      </header>
  )
}
