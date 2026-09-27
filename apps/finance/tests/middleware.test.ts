import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../functions/_middleware.ts'

function request(authorization?: string) {
  return new Request('https://dashboard.example/', {
    headers: authorization ? { Authorization: authorization } : undefined,
  })
}

test('認証設定がなければフェイルクローズする', async () => {
  const response = await onRequest({ request: request(), env: {}, next: async () => new Response('secret') })
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})

test('Basic認証とプライバシーヘッダーを全レスポンスへ適用する', async () => {
  const env = { DASHBOARD_USER: 'owner', DASHBOARD_PASSWORD: 'long-password' }
  const unauthorized = await onRequest({ request: request(), env, next: async () => new Response('secret') })
  assert.equal(unauthorized.status, 401)
  assert.match(unauthorized.headers.get('WWW-Authenticate') ?? '', /financial-dashboard/)

  const authorization = `Basic ${btoa('owner:long-password')}`
  const response = await onRequest({ request: request(authorization), env, next: async () => new Response('secret') })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'secret')
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY')
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /connect-src 'self'/)
})

test('Cloudflare Accessモードは設定不足と不正JWTを拒否する', async () => {
  const missing = await onRequest({
    request: request(),
    env: { AUTH_MODE: 'access' },
    next: async () => new Response('secret'),
  })
  assert.equal(missing.status, 503)

  const invalid = await onRequest({
    request: new Request('https://dashboard.example/', { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } }),
    env: { AUTH_MODE: 'access', TEAM_DOMAIN: 'https://owner.cloudflareaccess.com', POLICY_AUD: 'audience' },
    next: async () => new Response('secret'),
  })
  assert.equal(invalid.status, 403)
  assert.doesNotMatch(await invalid.text(), /not-a-jwt/)
})

test('Hubサービスキーは読み取り専用の家計簿・書き出し・接続状態だけを許可する', async () => {
  const token = 'hub-service-token-that-is-at-least-32-characters'
  const env = { HUB_SERVICE_TOKEN: token, DASHBOARD_PASSWORD: 'password' }
  const allowed = await onRequest({
    request: new Request('https://dashboard.example/api/expenses?limit=5', { headers: { 'X-Hub-Service': token } }),
    env,
    next: async () => new Response('expenses'),
  })
  assert.equal(allowed.status, 200)
  assert.equal(await allowed.text(), 'expenses')

  for (const path of ['/api/export', '/api/status']) {
    const readOnly = await onRequest({
      request: new Request(`https://dashboard.example${path}`, { headers: { 'X-Hub-Service': token } }),
      env,
      next: async () => new Response(path),
    })
    assert.equal(readOnly.status, 200)
    assert.equal(await readOnly.text(), path)
  }

  const denied = await onRequest({
    request: new Request('https://dashboard.example/api/budget-categories', { headers: { 'X-Hub-Service': token } }),
    env,
    next: async () => new Response('categories'),
  })
  assert.equal(denied.status, 401)
})
