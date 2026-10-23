import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { io as socketClient, type Socket } from 'socket.io-client'
import type { createApplication as createApplicationFn } from '../src/app'
import { runMigrations } from '../src/db/migrations'
import type { Database } from '../src/db/database'
import { testDatabase } from './helpers'
import { recoverInterruptedRounds } from '../src/modules/recovery/service'

const origin = 'http://localhost:5173'
const bootstrapSecret = 'critical-flow-bootstrap-secret-with-32-chars'
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url))
let db: Database
let createApplication: typeof createApplicationFn
let application: ReturnType<typeof createApplicationFn>
let base: string
let displayCookie: string
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
  method?: string; body?: unknown; cookie?: string; key?: string
} = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = {}
  if(path.startsWith('/api/v1/public/'))headers.Cookie=displayCookie
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.cookie) { headers.Cookie = options.cookie; headers.Origin = origin }
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

test('black-box account to verified winner flow preserves privacy and ownership', async () => {
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
  displayCookie=rootCookie

  const eventResponse = await request<{ event: { id: string } }>('/api/v1/admin/events', {
    method: 'POST', cookie: rootCookie, body: { name: 'Critical Flow' },
  })
  assert.equal(eventResponse.status, 201)
  const eventId = eventResponse.body.event.id
  const importBody = { rows: [
    { name: 'Player One', email: 'player@flow.test', external_id: 'seat-1' },
    { name: 'Bad Row', email: 'invalid' },
  ] }
  const imported = await request<{ created: number; failed: number }>(`/api/v1/admin/events/${eventId}/participants/import`, {
    method: 'POST', cookie: rootCookie, key: 'flow-import-0001', body: importBody,
  })
  assert.equal(imported.status, 200)
  assert.equal(imported.body.created, 1)
  assert.equal(imported.body.failed, 1)
  const replay = await request<{ created: number }>(`/api/v1/admin/events/${eventId}/participants/import`, {
    method: 'POST', cookie: rootCookie, key: 'flow-import-0001', body: importBody,
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.created, 1)

  const participantList = await request<{ participants: { profile_id: string }[] }>(`/api/v1/admin/events/${eventId}/participants`, { cookie: rootCookie })
  assert.equal(participantList.body.participants.length, 1)
  const profileId = participantList.body.participants[0].profile_id
  const issued = await request(`/api/v1/admin/events/${eventId}/participants/${profileId}/credentials`, {
    method: 'POST', cookie: rootCookie,
  })
  assert.equal(issued.status, 200)
  const email = delivered.at(-1)!
  assert.equal(email.to, 'player@flow.test')
  assert.equal(email.authorization, 'Bearer critical-flow-test-key')
  assert.match(email.contentType ?? '', /application\/json/)
  const password = email.text.match(/Temporary password: ([^\s]+)/)?.[1]
  assert.ok(password)
  const playerLogin = await request<{ token?: string; principal: { type: string; eventId: string } }>('/api/v1/auth/login', {
    method: 'POST', body: { email: 'player@flow.test', password },
  })
  assert.equal(playerLogin.status, 200)
  assert.equal(playerLogin.body.token, undefined)
  assert.equal(playerLogin.body.principal.type, 'PARTICIPANT')
  const playerCookie = playerLogin.headers.get('set-cookie')!.split(';')[0]

  const secondEvent = await request<{ event: { id: string } }>('/api/v1/admin/events', {
    method: 'POST', cookie: rootCookie, body: { name: 'Separate Event' },
  })
  const otherRound = await request<{ round: { id: string } }>(`/api/v1/admin/events/${secondEvent.body.event.id}/rounds`, {
    method: 'POST', cookie: rootCookie, body: { name: 'Private Round' },
  })
  const forbiddenTicket = await request(`/api/v1/participant/rounds/${otherRound.body.round.id}`, { cookie: playerCookie })
  assert.equal(forbiddenTicket.status, 404, 'participants cannot cross event boundaries')

  const roundResponse = await request<{ round: { id: string; round_no: number } }>(`/api/v1/admin/events/${eventId}/rounds`, {
    method: 'POST', cookie: rootCookie, body: { name: 'Round One' },
  })
  assert.equal(roundResponse.status, 201)
  assert.equal(roundResponse.body.round.round_no, 1)
  const roundId = roundResponse.body.round.id
  const keyIds: string[] = []
  for (let i = 1; i <= 20; i++) {
    const key = await request<{ key: { id: string } }>(`/api/v1/admin/events/${eventId}/keys`, {
      method: 'POST', cookie: rootCookie, body: { value: `TERM-${i}` },
    })
    assert.equal(key.status, 201)
    keyIds.push(key.body.key.id)
    const question = await request(`/api/v1/admin/rounds/${roundId}/questions`, {
      method: 'POST', cookie: rootCookie, body: { keyId: key.body.key.id, question: `Question ${i}` },
    })
    assert.equal(question.status, 201)
  }
  const generated = await request<{ created: number; total: number }>(`/api/v1/admin/rounds/${roundId}/tickets/generate`, {
    method: 'POST', cookie: rootCookie, key: 'flow-ticket-0001',
  })
  assert.equal(generated.status, 200)
  assert.equal(generated.body.created, 1)
  assert.equal(generated.body.total, 1)
  assert.equal((await request(`/api/v1/admin/rounds/${roundId}/ready`, { method: 'POST', cookie: rootCookie, key: 'flow-ready-0001' })).status, 200)
  assert.equal((await request(`/api/v1/admin/rounds/${roundId}/start`, { method: 'POST', cookie: rootCookie, key: 'flow-start-0001' })).status, 200)

  const participantSocket: Socket = socketClient(base, {
    auth: { roundId }, extraHeaders: { Cookie: playerCookie }, transports: ['websocket'],
    reconnection: false,
  })
  const firstTicket = await request<{ ticket: { cells: ({ id: string } | null)[][] } }>(`/api/v1/participant/rounds/${roundId}`, { cookie: playerCookie })
  const ticketIds = new Set(firstTicket.body.ticket.cells.flat().filter((cell): cell is { id: string } => !!cell).map(cell => cell.id))
  const socketOnlyKey = keyIds.find(id => !ticketIds.has(id))
  assert.ok(socketOnlyKey)
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Participant socket did not join')), 2_000)
    participantSocket.once('room_ready', () => { clearTimeout(timeout); resolve() })
    participantSocket.once('connect_error', error => { clearTimeout(timeout); reject(error) })
  })
  await ready
  const update = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Committed round update was not delivered')), 2_000)
    participantSocket.once('round_changed', () => { clearTimeout(timeout); resolve() })
  })
  const firstDraw = await request(`/api/v1/admin/rounds/${roundId}/draws`, {
    method: 'POST', cookie: rootCookie, key: 'flow-socket-draw-001', body: { keyId: socketOnlyKey },
  })
  assert.equal(firstDraw.status, 200)
  await update
  assert.equal((await request(`/api/v1/admin/rounds/${roundId}/draws/reveal`, {
    method: 'POST', cookie: rootCookie, body: { seq: 1 },
  })).status, 200)
  const foreignCellMark = await request(`/api/v1/participant/rounds/${roundId}/marks`, {
    method: 'POST', cookie: playerCookie, key: 'flow-mark-foreign-cell', body: { keyId: socketOnlyKey },
  })
  assert.equal(foreignCellMark.status, 422, 'participants cannot mark a key absent from their assigned ticket')
  participantSocket.disconnect()

  const assigned = await request<{ ticket: { cells: ({ id: string; value: string } | null)[][] } }>(`/api/v1/participant/rounds/${roundId}`, { cookie: playerCookie })
  assert.equal(assigned.status, 200)
  const cells = assigned.body.ticket.cells
  assert.equal(cells.length, 3)
  assert.ok(cells.every(row => row.length === 9 && row.filter(Boolean).length === 5))
  const ticketKeys = cells.flat().filter((cell): cell is { id: string; value: string } => !!cell)
  assert.equal(ticketKeys.length, 15)
  assert.equal(new Set(ticketKeys.map(cell => cell.id)).size, 15)

  for (const [index, cell] of ticketKeys.slice(0, 5).entries()) {
    const drawn = await request(`/api/v1/admin/rounds/${roundId}/draws`, {
      method: 'POST', cookie: rootCookie, key: `flow-draw-${String(index).padStart(4, '0')}`, body: { keyId: cell.id },
    })
    assert.equal(drawn.status, 200)
    const hidden = await request<{ draws: { seq: number; key: string | null; question: string | null }[] }>(`/api/v1/public/rounds/${roundId}`)
    assert.equal(hidden.status, 200)
    assert.equal(hidden.body.draws.at(-1)?.key, null)
    assert.equal(hidden.body.draws.at(-1)?.question, null)
    const beforeReveal = await request(`/api/v1/participant/rounds/${roundId}/marks`, {
      method: 'POST', cookie: playerCookie, key: `flow-mark-early-${String(index).padStart(4, '0')}`, body: { keyId: cell.id },
    })
    assert.equal(beforeReveal.status, 422)
    assert.equal((await request(`/api/v1/admin/rounds/${roundId}/draws/reveal`, {
      method: 'POST', cookie: rootCookie, body: { seq: index + 2 },
    })).status, 200)
    const markKey = `flow-mark-valid-${String(index).padStart(4, '0')}`
    const marked = await request<{ marked_cell_ids: string[] }>(`/api/v1/participant/rounds/${roundId}/marks`, {
      method: 'POST', cookie: playerCookie, key: markKey, body: { keyId: cell.id },
    })
    assert.equal(marked.status, 200)
    const replayedMark = await request<{ marked_cell_ids: string[] }>(`/api/v1/participant/rounds/${roundId}/marks`, {
      method: 'POST', cookie: playerCookie, key: markKey, body: { keyId: cell.id },
    })
    assert.equal(replayedMark.status, 200)
    assert.deepEqual(replayedMark.body.marked_cell_ids, marked.body.marked_cell_ids)
  }
  const submitted = await request<{ accepted: boolean; claim: { id: string; status: string } }>(`/api/v1/participant/rounds/${roundId}/claims`, {
    method: 'POST', cookie: playerCookie, key: 'flow-claim-0001', body: { pattern: 'early_five' },
  })
  assert.equal(submitted.status, 201)
  assert.equal(submitted.body.accepted, true)
  assert.equal(submitted.body.claim.status, 'PENDING_VERIFICATION')
  const duplicateClaim = await request<{ duplicate: boolean; claim: { id: string } }>(`/api/v1/participant/rounds/${roundId}/claims`, {
    method: 'POST', cookie: playerCookie, key: 'flow-claim-0002', body: { pattern: 'early_five' },
  })
  assert.equal(duplicateClaim.status, 200)
  assert.equal(duplicateClaim.body.duplicate, true)
  assert.equal(duplicateClaim.body.claim.id, submitted.body.claim.id)
  const reviewed = await request<{ claim: { status: string; points: number } }>(`/api/v1/admin/claims/${submitted.body.claim.id}/review`, {
    method: 'POST', cookie: rootCookie, key: 'flow-review-0001', body: { decision: 'verify' },
  })
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.body.claim.status, 'VERIFIED')
  const publicFinal = await request<{ winners: { name: string; points: number }[]; standings: { name: string; score: number }[]; claims?: unknown }>(`/api/v1/public/rounds/${roundId}`)
  assert.equal(publicFinal.status, 200)
  assert.equal(publicFinal.body.winners[0]?.name, 'Player One')
  assert.equal(publicFinal.body.standings[0]?.score, reviewed.body.claim.points)
  assert.equal(publicFinal.body.claims, undefined, 'public state omits internal claim data')

  assert.deepEqual(await recoverInterruptedRounds(db), [roundId])
  const recoveryCheck = await request<{ valid: boolean; issues: string[]; status: string }>(`/api/v1/super-admin/rounds/${roundId}/recovery`, { cookie: rootCookie })
  assert.equal(recoveryCheck.status, 200)
  assert.equal(recoveryCheck.body.status, 'RECOVERY_REQUIRED')
  assert.equal(recoveryCheck.body.valid, true)
  assert.deepEqual(recoveryCheck.body.issues, [])
  const recovered = await request<{ status: string }>(`/api/v1/super-admin/rounds/${roundId}/recover`, { method: 'POST', cookie: rootCookie })
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.status, 'PAUSED')

  // Simulate persisted corruption at process restart and prove recovery blocks it.
  await db.query("UPDATE events SET status='LIVE' WHERE id=$1", [eventId])
  await db.query("UPDATE rounds SET status='ACTIVE' WHERE id=$1", [roundId])
  await db.query('UPDATE round_tickets SET marked_cell_ids=array_append(marked_cell_ids,gen_random_uuid()) WHERE round_id=$1', [roundId])
  assert.deepEqual(await recoverInterruptedRounds(db), [roundId])
  const invalidRecovery = await request<{ valid: boolean; issues: string[] }>(`/api/v1/super-admin/rounds/${roundId}/recovery`, { cookie: rootCookie })
  assert.equal(invalidRecovery.body.valid, false)
  assert.ok(invalidRecovery.body.issues.includes('TICKET_MARK_STATE_INVALID'))
  assert.equal((await request(`/api/v1/super-admin/rounds/${roundId}/recover`, { method: 'POST', cookie: rootCookie })).status, 409)
})
