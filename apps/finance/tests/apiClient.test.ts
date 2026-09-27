import assert from 'node:assert/strict'
import test from 'node:test'
import { readApiResponse } from '../src/lib/http.ts'

test('API clientはHTML成功応答を利用者向けエラーへ変換する', async () => {
  await assert.rejects(
    () => readApiResponse(new Response('<!doctype html><title>proxy</title>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    (error: unknown) => error instanceof Error && /想定外の応答/.test(error.message) && !/Unexpected token/.test(error.message),
  )
})

test('API clientは壊れたJSONの解析詳細を表示しない', async () => {
  await assert.rejects(
    () => readApiResponse(new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    (error: unknown) => error instanceof Error && /想定外の応答/.test(error.message) && !/JSON|position|token/i.test(error.message),
  )
})
