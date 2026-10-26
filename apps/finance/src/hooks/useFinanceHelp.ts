import { useEffect, useState } from 'react'

export function useFinanceHelp() {
  const [helpOpen, setHelpOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'help')
  useEffect(() => {
    const syncView = () => setHelpOpen(new URLSearchParams(window.location.search).get('view') === 'help')
    window.addEventListener('popstate', syncView)
    return () => window.removeEventListener('popstate', syncView)
  }, [])
  // 説明はヘルプページにまとめ、ヘッダーの「?」から開く
  const openHelp = () => {
    setHelpOpen(true)
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'help')
    window.history.pushState(null, '', url)
    window.scrollTo(0, 0)
  }

  const closeHelp = () => {
    setHelpOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }

  return { helpOpen, openHelp, closeHelp }
}
