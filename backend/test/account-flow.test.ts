import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { createApplication as createApplicationFn } from '../src/app'
import { runMigrations } from '../src/db/migrations'
import type { Database } from '../src/db/database'
import { testDatabase } from './helpers'

const origin = 'http://localhost:5173'
const bootstrapSecret = 'critical-flow-bootstrap-secret-with-32-chars'
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url))
let db: Database
let createApplication: typeof createApplicationFn
let application: ReturnType<typeof createApplicationFn>
let base: string
let mailServer: Server
let mailUrl: string
let delivered: { to: string; text: string; authorization: string | undefined; contentType: string | undefined }[] = []

before(async () => {
  const compiledApp = await import(new URL('../dist/app.js', import.meta.url).href) as typeof import('../src/app')
  createApplication = compiledApp.createApplication
  db = await testDatabase()
  await runMigrations(db, migrationDir)
  mailServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    delivered.push({
      ...(JSON.parse(Buffer.concat(chunks).toString()) as { to: string; text: string }),
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
    })
    res.writeHead(202).end('{}')
  })
  await new Promise<void>(resolve => mailServer.listen(0, '127.0.0.1', resolve))
  const mailAddress = mailServer.address()
  assert.ok(mailAddress && typeof mailAddress !== 'string')
  mailUrl = `http://127.0.0.1:${mailAddress.port}`
  application = createApplication(db, {
    origins: [origin], bootstrapSecret,
    email: { url: mailUrl, apiKey: 'critical-flow-test-key', from: 'noreply@test.local' },
  })
  await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve))
  const address = application.server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (application) await new Promise<void>(resolve => application.io.close(() => resolve()))
  if (mailServer) await new Promise<void>(resolve => mailServer.close(() => resolve()))
  await db?.close()
})

async function request<T = any>(path: string, options: {
  method?: string; body?: unknown; cookie?: string; key?: string; token?: string
} = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.cookie) { headers.Cookie = options.cookie; headers.Origin = origin }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.key) headers['Idempotency-Key'] = options.key
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let body: T
  try { body = JSON.parse(text) as T } catch { body = text as T }
  return { status: response.status, body, headers: response.headers }
}

test('participant import and credentials lead directly to a continuous game without events or rounds', async () => {
  const bootstrap = await request('/api/v1/auth/bootstrap-super-admin', {
    method: 'POST', body: { email: 'owner@flow.test', name: 'Owner', password: 'OwnerPassword123!' },
  })
  assert.equal(bootstrap.status, 401, 'bootstrap requires the secret')
  const createdRoot = await fetch(`${base}/api/v1/auth/bootstrap-super-admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bootstrap-secret': bootstrapSecret },
    body: JSON.stringify({ email: 'owner@flow.test', name: 'Owner', password: 'OwnerPassword123!' }),
  })
  assert.equal(createdRoot.status, 201)
  const rootLogin = await request<{ token?: string }>('/api/v1/auth/login', {
    method: 'POST', body: { email: 'owner@flow.test', password: 'OwnerPassword123!' },
  })
  assert.equal(rootLogin.status, 200)
  assert.equal(rootLogin.body.token, undefined)
  const rootCookie = rootLogin.headers.get('set-cookie')!.split(';')[0]

  const importBody = { rows: [
    { name: 'Player One', email: 'player@flow.test', external_id: 'seat-1' },
    { name: 'Bad Row', email: 'invalid' },
  ] }
  const imported = await request<{ created: number; failed: number }>('/api/v1/admin/participants/import', {
    method: 'POST', cookie: rootCookie, key: 'flow-import-0001', body: importBody,
  })
  assert.equal(imported.status, 200)
  assert.equal(imported.body.created, 1)
  assert.equal(imported.body.failed, 1)
  const replay = await request<{ created: number }>('/api/v1/admin/participants/import', {
    method: 'POST', cookie: rootCookie, key: 'flow-import-0001', body: importBody,
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.created, 1)

  const participantList = await request<{ participants: { profile_id: string }[] }>('/api/v1/admin/participants', { cookie: rootCookie })
  assert.equal(participantList.body.participants.length, 1)
  const profileId = participantList.body.participants[0].profile_id
  const issued = await request(`/api/v1/admin/participants/${profileId}/credentials`, {
    method: 'POST', cookie: rootCookie,
  })
  assert.equal(issued.status, 200)
  const email = delivered.at(-1)!
  assert.equal(email.to, 'player@flow.test')
  assert.equal(email.authorization, 'Bearer critical-flow-test-key')
  assert.match(email.contentType ?? '', /application\/json/)
  const password = email.text.match(/Temporary password: ([^\s]+)/)?.[1]
  assert.ok(password)
  const playerLogin = await request<{ token?: string; principal: { type: string } }>('/api/v1/auth/login', {
    method: 'POST', body: { email: 'player@flow.test', password },
  })
  assert.equal(playerLogin.status, 200)
  assert.equal(playerLogin.body.token, undefined)
  assert.equal(playerLogin.body.principal.type, 'PARTICIPANT')
  const playerCookie = playerLogin.headers.get('set-cookie')!.split(';')[0]

  // One continuous game: no event or round creation/assignment is needed.
  const host = await request('/api/games', { method: 'POST', cookie: rootCookie, body: { hostName: 'Owner' } })
  assert.equal(host.status, 201)
  const gameId = host.body.game_id
  const joined = await request('/api/games/join', { method: 'POST', cookie: playerCookie, body: { code: host.body.code, name: 'Player One' } })
  assert.equal(joined.status, 201)
  const token = joined.body.player_token
  const state = await request(`/api/games/${gameId}`, { cookie: playerCookie, token })
  assert.equal(state.body.me.ticket.flat().filter(Boolean).length, 15)
  assert.equal((await request(`/api/games/${gameId}/start`, { method: 'POST', cookie: playerCookie, token })).status, 403)
  assert.equal((await request(`/api/games/${gameId}/start`, { method: 'POST', cookie: rootCookie, token: host.body.host_token })).status, 200)
  for (let i = 0; i < 90; i++) assert.equal((await request(`/api/games/${gameId}/calls`, { method: 'POST', cookie: rootCookie, token: host.body.host_token })).status, 200)
  assert.equal((await request(`/api/games/${gameId}/reveals`, { method: 'PUT', cookie: rootCookie, token: host.body.host_token, body: { seqs: Array.from({length:90}, (_, i) => i+1) } })).status, 200)
  assert.equal((await request(`/api/games/${gameId}/marks`, { method: 'PUT', cookie: playerCookie, token, body: { marked: state.body.me.ticket.flat().filter(Boolean) } })).status, 200)
  for (const claim of ['early_five', 'full_house']) {
    const result = await request(`/api/games/${gameId}/claims`, { method: 'POST', cookie: playerCookie, token, body: { claim } })
    assert.equal(result.status, 200)
    assert.equal(result.body.accepted, true)
  }
  const final = await request(`/api/games/${gameId}`, { cookie: playerCookie, token })
  assert.equal(final.body.status, 'closing')
  assert.equal(final.body.calls.length, 90)
  assert.equal(final.body.me.score, 60)
  assert.equal((await request(`/api/games/${gameId}/status`, { method: 'PATCH', cookie: rootCookie, token: host.body.host_token, body: { status: 'finished' } })).status, 200)
  const dashboard = await request('/api/v1/admin/dashboard', { cookie: rootCookie })
  assert.equal(dashboard.body.counts.draws, 90)
  assert.equal(dashboard.body.counts.acceptedClaims, 2)
  assert.equal(dashboard.body.counts.activeGames, 0)
  assert.equal(dashboard.body.round, undefined)
  assert.equal(dashboard.body.event, undefined)
  const denied = await request('/api/v1/admin/participants', { cookie: playerCookie })
  assert.equal(denied.status, 403)
  for (const path of ['/api/v1/admin/events', '/api/v1/participant/rounds', '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/state']) {
    assert.equal((await request(path, { cookie: rootCookie })).status, 404)
  }
})
