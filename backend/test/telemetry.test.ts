import test from 'node:test'
import assert from 'node:assert/strict'
import { redactTelemetryText, scrubTelemetry, telemetryError } from '../src/shared/telemetryPrivacy'
import { readConfig } from '../src/config'
import { createTelemetry, type RequestTelemetry } from '../src/telemetry'
import { createApplication } from '../src/app'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

test('telemetry removes credentials, emails, ticket data, and URL queries', () => {
  const secret = 'a'.repeat(64)
  const clean = scrubTelemetry({
    route: '/api/games/:id/claims', game_id: 'safe-game-id', status_code: 200,
    password: 'should-not-appear', authorization: `Bearer ${secret}`, cookie: 'tt_session=secret',
    ticket: [[1, 2]], marked: [1], email: 'member@example.com',
    message: `Bearer ${secret} phc_exampleproject phx_examplepersonal member@example.com postgresql://user:pass@host/db`,
    $current_url: 'https://game.example/play?token=secret#private',
  }) as Record<string, unknown>
  assert.equal(clean.$current_url, 'https://game.example/play')
  assert.equal(clean.game_id, 'safe-game-id')
  assert.equal(clean.status_code, 200)
  for (const key of ['password', 'authorization', 'cookie', 'ticket', 'marked', 'email']) assert.ok(!(key in clean))
  assert.doesNotMatch(JSON.stringify(clean), /should-not-appear|member@example|phc_|phx_|user:pass|aaaaaaaa/)
  assert.match(redactTelemetryText(secret), /redacted/)
  assert.doesNotMatch(telemetryError(new Error(`Login failed for member@example.com Bearer ${secret}`)).stack!, /member@example|aaaaaaaa/)
})

test('PostHog is optional and config rejects personal credentials without echoing them', () => {
  assert.equal(createTelemetry({ host: 'https://us.i.posthog.com', environment: 'test' }), undefined)
  const base = { DATABASE_URL: 'postgresql://user:password@localhost/db' }
  assert.equal(readConfig(base).POSTHOG_PROJECT_KEY, undefined)
  assert.equal(readConfig({ ...base, POSTHOG_PROJECT_KEY: 'phc_example' }).POSTHOG_HOST, 'https://us.i.posthog.com')
  assert.throws(() => readConfig({ ...base, POSTHOG_PROJECT_KEY: 'phx_private' }), error => {
    assert.match((error as Error).message, /POSTHOG_PROJECT_KEY/)
    assert.doesNotMatch((error as Error).message, /phx_private/)
    return true
  })
})

test('request logging excludes payloads and a failed telemetry sink does not affect responses', async () => {
  const records: RequestTelemetry[] = []
  const db = { query: async () => ({ rows: [] }), transaction: async () => { throw new Error('unused') }, close: async () => {} }
  const app = createApplication(db, { origins: ['http://localhost:5173'], telemetry: {
    request: record => { records.push(record); throw new Error('Export unavailable') },
    exception: () => { throw new Error('Export unavailable') }, shutdown: async () => {},
  } })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/not-a-route?token=private`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'private', ticket: [1] }),
    })
    assert.equal(response.status, 404)
    assert.equal(records.length, 1)
    assert.equal(records[0].route, '/api/not-a-route')
    assert.doesNotMatch(JSON.stringify(records), /private|password|ticket/)
  } finally { await new Promise<void>(resolve => app.io.close(() => resolve())) }
})

test('configured telemetry flushes redacted logs and events to a local test collector', async () => {
  const received: Array<{ path: string; body: string }> = []
  const collector = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes).toString() : bytes.toString()
    received.push({ path: req.url!, body })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}')
  })
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve))
  const address = collector.address()
  assert.ok(address && typeof address !== 'string')
  const telemetry = createTelemetry({ projectKey: 'phc_testcollector', host: `http://127.0.0.1:${address.port}`, environment: 'test' })!
  try {
    telemetry.request({ request_id: 'test-request', method: 'POST', route: '/api/games/:id/claims',
      user_id: 'test-member', status_code: 200, duration_ms: 25, game_id: 'test-game', claim: 'early_five', accepted: true, points: 10 })
    telemetry.exception(new Error(`Synthetic error for member@example.com Bearer ${'a'.repeat(64)}`), { request_id: 'test-request', user_id: 'test-member' })
    await telemetry.shutdown()
    assert.ok(received.some(r => r.path.startsWith('/i/v1/logs') && r.body.includes('HTTP request completed')))
    assert.ok(received.some(r => r.body.includes('game_action_completed')))
    assert.ok(received.some(r => r.body.includes('$exception')))
    assert.doesNotMatch(JSON.stringify(received), /member@example|aaaaaaaa/)
  } finally { await telemetry.shutdown(); await new Promise<void>(resolve => collector.close(() => resolve())) }
})
