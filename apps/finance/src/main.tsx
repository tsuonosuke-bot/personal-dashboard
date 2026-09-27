import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './index.dark.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href)
    void navigator.serviceWorker.register(new URL('sw.js', base).pathname, { scope: base.pathname })
  })
}
