# Personal Dashboard instructions

## UI defaults

- Build compact, information-dense, mobile-first dashboard screens.
- Do not add hero sections, oversized slogans, decorative dates, or large empty introductory areas unless the user explicitly asks for them.
- Use the existing top bar for page identity and primary actions. Start the main content with useful status, counts, filters, or records.
- Keep frequent actions above the fold and make touch targets practical without making cards unnecessarily tall.
- Prefer clear hierarchy, readable contrast, and functional states over decorative copy.
- Give each dashboard route a distinct but restrained accent color; do not reuse another route's visual identity.
- Check both a narrow phone viewport and desktop layout after UI changes.
- Before reporting a deployment complete, verify the normal production URL and live data rather than relying only on deployment status.

## Dark mode

- `public/static/theme.js` loads before every stylesheet and sets `data-theme="light|dark"` on `<html>` from the saved choice (`dashboard-theme` in localStorage: 自動/ライト/ダーク) or the OS setting. Knowledge and Finance ship the same script, so the choice is shared under the Hub origin.
- The Idea screen (`/compass/`) is `public/app.js` (event wiring and boot only) plus ES modules in `public/compass/`: `state` / `constants` / `format` (shared parts), `list`, `data`, `bulk`, `route` and `project-route` (triage flow), `todos` (ToDo and Calendar), `calendar` / `calendar-grid` (the ToDo month view with drag-and-drop rescheduling; `calendar-grid` is DOM-free so tests import it directly), `edit-forms`, `drawer`. Vite bundles them into one script, so no build setting is involved. UI tests read the whole screen through `tests/compassScript.ts` instead of a single file. After adding a module, `npm run check` syntax-checks every file in `public/compass/`.
- Author light CSS only. After editing any stylesheet, run `npm run theme` to regenerate the matching `*.dark.css`; `tests/darkTheme.test.ts` fails when a generated file is stale. Never edit `*.dark.css` by hand.
- A new page must load `/theme.js` before its stylesheets, link `X.dark.css` right after each `X.css`, and include the `select[data-theme-select]` switcher.

## Page header and tab bar

- Every page uses the shared `.dashboard-header` from `public/dashboard-shell.css` (brand mark, page name, ← Hub, page switcher, refresh, primary action). Keep the switcher links in this order on every page: Idea, Projects, Writing, Habits, Finance, Knowledge, 接続状態.
- At 680px and below the header hides ← Hub and the switcher; `public/static/tabbar.js` draws the bottom tab bar instead. Load it on every page with `<script src="/tabbar.js" data-page="<id>" defer></script>`.
- `tabbar.js` and the `/* tabbar:start */ … /* tabbar:end */` CSS block are shared verbatim with Knowledge and Finance; change all three copies together (`tests/hub-ui.test.ts` checks they match).
- Fixed-position toasts add `var(--tabbar-space, 0px)` to their bottom offset so they stay above the tab bar.
