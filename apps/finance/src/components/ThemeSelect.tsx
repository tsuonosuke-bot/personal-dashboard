declare global {
  interface Window {
    dashboardTheme?: { get: () => string; set: (preference: string) => void }
  }
}

/** theme.jsが変更イベントを拾って保存・適用するため、ここでは初期値だけを渡す。 */
export function ThemeSelect() {
  return (
    <label className="theme-select">
      <span>表示</span>
      <select data-theme-select="" aria-label="表示テーマ" defaultValue={window.dashboardTheme?.get() ?? 'system'}>
        <option value="system">自動</option>
        <option value="light">ライト</option>
        <option value="dark">ダーク</option>
      </select>
    </label>
  )
}
