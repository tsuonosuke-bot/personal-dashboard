// Custom dialog focus lifecycle. Existing controllers keep their own close/save guards.
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';
const stack = [];
const inertBefore = new Map();
let originalOverflow = "";
let pendingNativeRestores = 0;

function visible(element) {
  return element instanceof HTMLElement && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function focusable(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter((element) =>
    visible(element) && !element.matches(':disabled') && element.tabIndex >= 0 &&
    !element.closest('details:not([open]) > :not(summary)'));
}

function scope() {
  const nativeDialogs = [...document.querySelectorAll('dialog[open]')];
  return nativeDialogs.at(-1) || stack.at(-1)?.dialog;
}

function restoreInert() {
  for (const [element, inert] of inertBefore) element.inert = inert;
  inertBefore.clear();
}

function blockBackground() {
  restoreInert();
  const top = stack.at(-1);
  if (!top) return;
  const native = [...document.querySelectorAll('dialog[open]')].at(-1);
  // showModal already makes the document inert. Explicit inert on the parent would
  // prevent the browser from restoring its opener synchronously during close().
  if (native) return;
  const allowed = top.container;
  let branch = allowed;
  while (branch && branch !== document.body) {
    for (const sibling of branch.parentElement?.children || []) {
      if (sibling === branch || top.allowOutside.includes(sibling) || sibling.matches('script, style, link')) continue;
      inertBefore.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    branch = branch.parentElement;
  }
}

function focusInside(dialog) {
  const target = focusable(dialog)[0] || dialog;
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  target.focus({ preventScroll: true });
}

export function activateModal(container, { fallback, allowOutside = [] } = {}) {
  if (stack.some((entry) => entry.container === container)) return;
  const dialog = container.matches('[role="dialog"], dialog') ? container : container.querySelector('[role="dialog"], dialog');
  if (!dialog) throw new Error('A named dialog is required');
  if (stack.length === 0 && pendingNativeRestores === 0) originalOverflow = document.body.style.overflow;
  stack.push({ container, dialog, opener: document.activeElement, fallback, allowOutside });
  dialog.setAttribute('aria-modal', 'true');
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  blockBackground();
  document.body.style.overflow = 'hidden';
  focusInside(dialog);
}

export function deactivateModal(container) {
  const index = stack.findIndex((entry) => entry.container === container);
  if (index < 0) return;
  const [entry] = stack.splice(index, 1);
  blockBackground();
  const restore = () => {
    const native = document.querySelector('dialog[open]');
    if (native) {
      // A linked-ToDo save may close its custom parent before its native child.
      // The browser cannot focus the background until that child's close event.
      pendingNativeRestores++;
      document.body.style.overflow = 'hidden';
      native.addEventListener('close', () => { pendingNativeRestores--; restore(); }, { once: true });
      return;
    }
    blockBackground();
    if (stack.length === 0 && pendingNativeRestores === 0) document.body.style.overflow = originalOverflow;
    const fallback = typeof entry.fallback === 'function' ? entry.fallback() : entry.fallback;
    const target = visible(entry.opener) && entry.opener !== document.body && !entry.opener.matches(':disabled') ? entry.opener : fallback;
    const current = scope();
    if (current && !(target instanceof HTMLElement && current.contains(target))) focusInside(current);
    else if (target instanceof HTMLElement && visible(target)) {
      if (!target.matches(FOCUSABLE)) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } else if (current) focusInside(current);
    // Saving or route restoration may replace the opener in the same render turn.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!stack.length && (!target?.isConnected || !visible(target)) &&
        (active === document.body || active?.closest('[hidden],[inert],[aria-hidden="true"]'))) {
        const next = typeof entry.fallback === 'function' ? entry.fallback() : entry.fallback;
        if (next instanceof HTMLElement && visible(next)) {
          if (!next.matches(FOCUSABLE)) next.tabIndex = -1;
          next.focus({ preventScroll: true });
        }
      }
    });
  };
  restore();
}

document.addEventListener('keydown', (event) => {
  if (stack.length && event.key === 'Escape' && document.querySelector('dialog[open]')) {
    // Keep the native cancel/save guard in charge; do not also close its custom parent.
    event.stopImmediatePropagation();
    return;
  }
  if (event.key !== 'Tab' || !stack.length) return;
  const dialog = scope();
  if (!dialog) return;
  const controls = focusable(dialog);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.focus(); }
  else if (!dialog.contains(document.activeElement) || document.activeElement === dialog ||
    (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}, true);

document.addEventListener('focusin', (event) => {
  if (!stack.length) return;
  const dialog = scope();
  if (dialog && !dialog.contains(event.target)) focusInside(dialog);
});

// Native child dialogs own Escape/return focus; only update the surrounding inert branches.
new MutationObserver((changes) => {
  if (stack.length && changes.some((change) => change.target instanceof HTMLDialogElement)) blockBackground();
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
