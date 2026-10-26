import { ThemeSelect } from "./ThemeSelect";
type Props = { error: string | null; loading: boolean; mutating: boolean;
  handleReload: () => void; setHelpOpen: (open: boolean) => void; openNew: () => void };
export function KnowledgeHeader({ error, loading, mutating, handleReload, setHelpOpen, openNew }: Props) {
  return (
      <header className="app-header">
        <div className="head">
          <div className="dashboard-brand">
            <span className="dashboard-brand-mark" aria-hidden="true">K</span>
            <h1>Knowledge</h1>
          </div>
          <div className="head-actions">
            <a className="hub-link" href="https://personal-dashboard-7md.pages.dev/">← Hub</a>
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
                  <a href="https://personal-dashboard-7md.pages.dev/compass/">Idea</a>
                  <a href="https://personal-dashboard-7md.pages.dev/projects/">Projects</a>
                  <a href="https://personal-dashboard-7md.pages.dev/writing/">Writing</a>
                  <a href="https://personal-dashboard-7md.pages.dev/habits/">Habits</a>
                  <a href="https://personal-dashboard-7md.pages.dev/sf6/">SF6</a>
                  <a href="https://personal-dashboard-7md.pages.dev/go/financial">Finance</a>
                  <span aria-current="page">Knowledge</span>
                  <a href="https://personal-dashboard-7md.pages.dev/status/">接続状態</a>
                </nav>
                <ThemeSelect />
              </div>
            </details>
            {/* 正常時は何も出さず、接続確認中と失敗のときだけ知らせる */}
            {(error || loading) && (
              <span className={`source-badge ${error ? "error" : "loading"}`}>
                {error ? "取得失敗" : "接続確認中"}
              </span>
            )}
            <button className="refresh-button" onClick={handleReload} disabled={loading || mutating} aria-label="データを再読み込み" title="再読み込み">↻</button>
            <button className="help-button" onClick={() => setHelpOpen(true)} aria-label="ヘルプ" title="ヘルプ">?</button>
            <button className="primary-button" onClick={openNew} disabled={loading || mutating}>＋ 追加</button>
          </div>
        </div>
      </header>
  );
}
