import { useEffect, useLayoutEffect, useRef } from 'react'

const dialogs: HTMLElement[] = []
const selector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex]'
const visible = (element: HTMLElement) => !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'

/** Modal keyboard/inert lifecycle; saving guards remain owned by the form. */
export function useModalDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  const blocked = useRef(busy)
  useLayoutEffect(() => { close.current = onClose; blocked.current = busy }, [onClose, busy])
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    const inert = new Map<HTMLElement, boolean>()
    let branch: HTMLElement | null = dialog.parentElement
    while (branch && branch !== document.body) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.matches('script,style,link')) {
          inert.set(sibling, sibling.inert)
          sibling.inert = true
        }
      }
      branch = branch.parentElement
    }
    dialogs.push(dialog)
    document.body.style.overflow = 'hidden'
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(selector)].filter(element => visible(element) && !element.matches(':disabled') && element.tabIndex >= 0 && !element.closest('details:not([open]) > :not(summary)'))
    const focusFirst = () => (controls()[0] ?? dialog).focus({ preventScroll: true })
    if (!dialog.contains(document.activeElement)) {
      const initial = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]')
      if (initial && visible(initial)) initial.focus({ preventScroll: true })
      else focusFirst()
    }
    const onKey = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!blocked.current) close.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (document.activeElement === dialog || !dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (dialogs.at(-1) === dialog && !dialog.contains(event.target as Node)) focusFirst()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      dialogs.splice(dialogs.indexOf(dialog), 1)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
      for (const [element, prior] of inert) element.inert = prior
      document.body.style.overflow = overflow
      const fallback = dialogs.at(-1) ?? document.querySelector<HTMLElement>('.app-header h1,main h1,main h2,.dashboard-header button')
      const target = opener && opener !== document.body && visible(opener) && !opener.matches(':disabled') ? opener : fallback
      if (target && visible(target)) {
        if (!target.matches(selector)) target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
    }
  }, [])
  return ref
}
