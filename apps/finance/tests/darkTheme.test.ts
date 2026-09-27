import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('generated dark stylesheet is up to date with index.css', () => {
  assert.doesNotThrow(() => execFileSync('node', ['scripts/build-dark-theme.mjs', '--check', 'src/index.css'], { stdio: 'pipe' }))
})

test('theme resolves before styles load and the switcher sits in the dashboard menu', async () => {
  const [html, main, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(html, /<script src="\.\/theme\.js"><\/script>/)
  assert.ok(html.indexOf('theme.js') < html.indexOf('/src/main.tsx'))
  assert.match(main, /import '\.\/index\.css'\nimport '\.\/index\.dark\.css'/)
  assert.match(app, /<ThemeSelect \/>/)
})

test('theme script pins the browser color scheme to the resolved theme', async () => {
  const script = await readFile(new URL('../public/theme.js', import.meta.url), 'utf8')
  assert.match(script, /root\.style\.colorScheme = theme;/)
  assert.match(script, /if \(scheme\) scheme\.content = theme;/)
})
