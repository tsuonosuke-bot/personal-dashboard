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
- Author light CSS only. After editing any stylesheet, run `npm run theme` to regenerate the matching `*.dark.css`; `tests/darkTheme.test.ts` fails when a generated file is stale. Never edit `*.dark.css` by hand.
- A new page must load `/theme.js` before its stylesheets, link `X.dark.css` right after each `X.css`, and include the `select[data-theme-select]` switcher.
