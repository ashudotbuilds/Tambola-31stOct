import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { io as connect, type Socket } from 'socket.io-client'
import { createApplication } from '../src/app'
import { testDatabase } from './helpers'
import type { Database } from '../src/db/database'
import { runMigrations } from '../src/db/migrations'
import { DEFAULT_TECHNICAL_BANK } from '../src/shared/bank'
import { createUser,createAdminProfile } from '../src/modules/auth/repository'
import { hashPassword } from '../src/modules/auth/password'
import type { CreateGameResult, JoinGameResult, GameState, ClaimResult, DrawResult } from '../src/shared/types'

let db: Database
let application: ReturnType<typeof createApplication>
let base: string
let adminCookie:string
let participantEvent:string
let passwordHash:string
let nextAccount=0
const tokenCookies=new Map<string,string>()
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url))
before(async () => {
  db = await testDatabase()
  await runMigrations(db, migrationDir)
  application = createApplication(db, { origins: ['http://localhost:5173'] })
  passwordHash=await hashPassword('TestPassword123!')
  const root=await createUser(db,'root@test.local',passwordHash,'Host')
  await createAdminProfile(db,root.id,'SUPER_ADMIN')
  adminCookie=`tt_session=${(await application.auth.login(root.email,'TestPassword123!')).token}`
  const {rows:[fixtureEvent]}=await db.query<{id:string}>("INSERT INTO events(name) VALUES ('Game test') RETURNING id")
  participantEvent=fixtureEvent.id
  await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve))
  const address = application.server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})
after(async () => {
  if (application) await new Promise<void>(resolve => application.io.close(() => resolve()))
  await db?.close()
})

async function api<T>(path: string, method = 'GET', body?: unknown, token?: string, expected = 200): Promise<T> {
  let cookie=tokenCookies.get(token??'')??adminCookie
  if(path==='/api/games/join'){
    const name=(body as {name:string}).name
    const user=await createUser(db,`member${++nextAccount}@test.local`,passwordHash,name)
    await db.query('INSERT INTO participant_profiles(user_id,event_id) VALUES ($1,$2)',[user.id,participantEvent])
    cookie=`tt_session=${(await application.auth.login(user.email,'TestPassword123!')).token}`
  }
  const response = await fetch(`${base}${path}`, { method,
    headers: {Cookie:cookie,Origin:'http://localhost:5173', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  const issued=result as {player_token?:string;host_token?:string}
  if(issued.player_token)tokenCookies.set(issued.player_token,cookie)
  if(issued.host_token)tokenCookies.set(issued.host_token,cookie)
  assert.equal(response.status, expected, JSON.stringify(result))
  return result as T
}
const create = () => api<CreateGameResult>('/api/games', 'POST', { hostName: 'Host' }, undefined, 201)
const join = (code: string, name: string) => api<JoinGameResult>('/api/games/join', 'POST', { code, name }, undefined, 201)

test('batch reveals survive stale host requests and are audited without private data', async () => {
  const host = await create()
  const players = await Promise.all(['Reveal A', 'Reveal B', 'Reveal C'].map(name => join(host.code, name)))
  await api(`/api/games/${host.game_id}/start`, 'POST', undefined, host.host_token)
  for (let i = 0; i < 4; i++) await api(`/api/games/${host.game_id}/calls`, 'POST', undefined, host.host_token)
  await Promise.all([
    api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [1, 2] }, host.host_token),
    api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [3, 4] }, host.host_token),
  ])
  await api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [] }, host.host_token)
  for (const player of players) {
    const state = await api<GameState>(`/api/games/${host.game_id}`, 'GET', undefined, player.player_token)
    assert.deepEqual(state.settings.revealed_seqs, [1, 2, 3, 4])
    assert.deepEqual(state.me!.marked, [], 'A reveal never marks a ticket')
  }
  await api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [5] }, host.host_token, 400)
  await api(`/api/games/${host.game_id}/bank`, 'PUT', { bank: DEFAULT_TECHNICAL_BANK }, host.host_token)
  await api(`/api/games/${host.game_id}/claims`, 'POST', { claim: 'early_five' }, players[0].player_token)
  const audit = await api<{ entries: { action: string; metadata: unknown; actorId: string | null }[] }>('/api/v1/admin/audit?limit=100')
  const serialized = JSON.stringify(audit)
  for (const token of [host.host_token, ...players.map(player => player.player_token)]) assert.ok(!serialized.includes(token))
  assert.ok(audit.entries.some(entry => entry.action === 'GAME_ANSWERS_REVEALED' && entry.actorId))
  assert.ok(audit.entries.some(entry => entry.action === 'GAME_BANK_UPDATED'))
  assert.ok(audit.entries.some(entry => entry.action === 'GAME_CLAIM_REJECTED' && entry.actorId))
})
const event = <T>(socket: Socket, name: string) => new Promise<T>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Missing ${name} event`)), 5000)
  socket.once(name, value => { clearTimeout(timeout); resolve(value as T) })
})

test('admins share the live game catalogue while only owners and super admins manage games', async () => {
  const admins = await Promise.all(['First', 'Second'].map(async name => {
    const user = await createUser(db, `${name.toLowerCase()}@sync.test`, passwordHash, name)
    await createAdminProfile(db, user.id, 'ADMIN')
    return `tt_session=${(await application.auth.login(user.email, 'TestPassword123!')).token}`
  }))
  async function as<T = { games: Array<{ id: string; can_manage: boolean; host_name: string; status: string }> }>(cookie: string, path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() as T }
  }
  const sockets = [adminCookie, ...admins].map(cookie => connect(base, {
    autoConnect: false, extraHeaders: { Cookie: cookie }, auth: { channel: 'admin-dashboard' },
  }))
  try {
    await Promise.all(sockets.map(async socket => { const ready = event(socket, 'room_ready'); socket.connect(); await ready }))
    const created = sockets.map(socket => event(socket, 'dashboard_changed'))
    const host = await as<CreateGameResult>(admins[0], '/api/games', 'POST', { hostName: 'First' })
    assert.equal(host.status, 201)
    assert.deepEqual(await Promise.all(created), [undefined, undefined, undefined], 'invalidation carries no private data')
    const id = host.body.game_id
    const catalogues = await Promise.all([adminCookie, ...admins].map(cookie => as(cookie, '/api/games')))
    const ids = catalogues.map(result => result.body.games.map((game: { id: string }) => game.id))
    assert.deepEqual(ids[0], ids[1]); assert.deepEqual(ids[1], ids[2])
    for (const [index, catalogue] of catalogues.entries()) {
      const game = catalogue.body.games.find((game: { id: string }) => game.id === id)
      assert.ok(game)
      assert.equal(game.can_manage, index !== 2)
      assert.equal(game.host_name, 'First')
      assert.equal(game.status, 'lobby')
    }
    assert.equal((await as(admins[1], `/api/games/${id}/session`, 'POST', {})).status, 403)
    assert.equal((await as(admins[1], `/api/games/${id}/start`, 'POST', {}, host.body.host_token)).status, 403)
    const member = await join(host.body.code, 'Sync Member')
    const memberCookie = tokenCookies.get(member.player_token)!
    assert.equal((await as(memberCookie, '/api/games')).status, 403)
    const denied = connect(base, { autoConnect: false, reconnection: false, extraHeaders: { Cookie: memberCookie }, auth: { channel: 'admin-dashboard' } })
    try { const failure = event<Error>(denied, 'connect_error'); denied.connect(); assert.match((await failure).message, /Administrator/) }
    finally { denied.disconnect() }
    const started = sockets.map(socket => event(socket, 'dashboard_changed'))
    assert.equal((await as(admins[0], `/api/games/${id}/start`, 'POST', {}, host.body.host_token)).status, 200)
    await Promise.all(started)
    for (const cookie of [adminCookie, ...admins]) {
      const catalogue = await as(cookie, '/api/games')
      assert.equal(catalogue.body.games.find((game: { id: string }) => game.id === id)?.status, 'playing')
    }
  } finally { sockets.forEach(socket => socket.disconnect()) }
})

test('migration application is repeatable and tracked', async () => {
  assert.deepEqual(await runMigrations(db, migrationDir), [
    'applied 001_initial.sql', 'applied 002_auth.sql', 'applied 003_event_participants.sql',
    'applied 004_round_content_tickets.sql', 'applied 005_idempotency.sql',
    'applied 006_credential_delivery.sql', 'applied 007_admin_credential_delivery.sql',
    'applied 008_round_recovery.sql',
    'applied 009_game_accounts.sql', 'applied 010_login_ids.sql',
  ])
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM schema_migrations')
  assert.equal(rows[0].count, 10)
})

test('HTTP: sessions, privacy, authorization, custom bank, join validation and lifecycle', async () => {
  await api('/health')
  await api('/ready')
  await api('/api/games', 'POST', { hostName: '' }, undefined, 400)
  const host = await create()
  await api(`/api/games/${host.game_id}/start`, 'POST', undefined, host.host_token, 409)
  const alice = await join(host.code.toLowerCase(), 'Alice')
  await api('/api/games/join', 'POST', { code: host.code, name: 'alice' }, undefined, 409)
  const publicState = await api<GameState>(`/api/games/code/${host.code}`)
  assert.equal(publicState.me, null)
  assert.ok(!JSON.stringify(publicState).includes(host.host_token))
  assert.ok(!JSON.stringify(publicState).includes(alice.player_token))
  const state = await api<GameState>(`/api/games/${host.game_id}`, 'GET', undefined, alice.player_token)
  assert.equal(state.me?.player_id, alice.player_id)
  assert.equal(state.me?.ticket.flat().filter(n => n !== null).length, 15)
  assert.equal((await api<GameState>(`/api/games/${host.game_id}`, 'GET', undefined, host.player_token)).me?.ticket.length, 0)
  await api(`/api/games/${host.game_id}`, 'GET', undefined, 'f'.repeat(64), 401)
  await api(`/api/games/${host.game_id}/start`, 'POST', undefined, alice.player_token, 403)
  await api('/api/games/not-a-uuid', 'GET', undefined, undefined, 400)
  const bank = DEFAULT_TECHNICAL_BANK.map(item => ({ ...item, clue: `Custom clue ${item.id}` }))
  await api(`/api/games/${host.game_id}/bank`, 'PUT', { bank: bank.slice(1) }, host.host_token, 400)
  await api(`/api/games/${host.game_id}/bank`, 'PUT', { bank }, host.host_token)
  await api(`/api/games/${host.game_id}/start`, 'POST', undefined, host.host_token)
  await api('/api/games/join', 'POST', { code: host.code, name: 'Late' }, undefined, 409)
  const draws = await Promise.all(Array.from({ length: 6 }, () => api<DrawResult>(`/api/games/${host.game_id}/calls`, 'POST', undefined, host.host_token)))
  assert.equal(new Set(draws.map(call => call.number)).size, 6)
  assert.deepEqual(draws.map(call => call.seq).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6])
  assert.ok(draws.every(call => call.clue === `Custom clue ${call.number}`))
  assert.equal((await api<GameState>(`/api/games/${host.game_id}`, 'GET', undefined, alice.player_token)).me?.marked.length, 0)
  await api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [1, 3, 6] }, host.host_token)
  await api(`/api/games/${host.game_id}/reveals`, 'PUT', { seqs: [7] }, host.host_token, 400)
  const revealed = await api<GameState>(`/api/games/${host.game_id}`)
  assert.deepEqual(revealed.settings.revealed_seqs, [1, 3, 6])
  await api(`/api/games/${host.game_id}/status`, 'PATCH', { status: 'paused' }, host.host_token)
  await api(`/api/games/${host.game_id}/calls`, 'POST', undefined, host.host_token, 409)
  await api(`/api/games/${host.game_id}/claims`, 'POST', { claim: 'early_five' }, alice.player_token, 409)
  await api(`/api/games/${host.game_id}/status`, 'PATCH', { status: 'playing' }, host.host_token)
  await api(`/api/games/${host.game_id}/status`, 'PATCH', { status: 'finished' }, host.host_token)
  await api(`/api/games/${host.game_id}/calls`, 'POST', undefined, host.host_token, 409)
  const denied = await fetch(`${base}/health`, { headers: { Origin: 'https://untrusted.example' } })
  assert.equal(denied.status, 403)
  const { rows: raw } = await db.query<{ host_token_hash: string }>('SELECT host_token_hash FROM games WHERE id = $1', [host.game_id])
  assert.notEqual(raw[0].host_token_hash, host.host_token)
})

test('claims: manual and official marks, penalties, concurrent winners and both full houses', async () => {
  const host = await create()
  const first = await join(host.code, 'First')
  const second = await join(host.code, 'Second')
  const wrong = await join(host.code, 'Wrong')
  const firstState = await application.games.state(host.game_id, first.player_token)
  const numbers = firstState.me!.ticket.flat().filter((n): n is number => n !== null)
  // Identical tickets produce a deterministic race between equally valid claims.
  await db.query('UPDATE tickets SET cells = $1 WHERE player_id = $2', [JSON.stringify(firstState.me!.ticket), second.player_id])
  await application.games.start(host.game_id, host.host_token)
  await application.games.marks(host.game_id, first.player_token, numbers)
  const invalid = await application.claims.submit(host.game_id, first.player_token, 'early_five')
  assert.equal(invalid.accepted, false) // pre-marking uncalled numbers cannot win
  assert.equal(invalid.penalty, 10)
  assert.ok(invalid.cut)
  assert.equal((await application.games.state(host.game_id, first.player_token)).me!.wrong_claims, 1)
  assert.equal((await application.games.marks(host.game_id, first.player_token, numbers)).marked.includes(invalid.cut!), false)
  await db.query("UPDATE tickets SET cut = '{}', marked = '{}' WHERE player_id = $1", [first.player_id])
  await db.query(`INSERT INTO game_calls (game_id, seq, number, clue)
    SELECT $1, n, n, 'Fixture clue' FROM generate_series(1,90) n`, [host.game_id])
  await db.query('UPDATE games SET next_seq = 91 WHERE id = $1', [host.game_id])
  await application.games.marks(host.game_id, first.player_token, numbers)
  await application.games.marks(host.game_id, second.player_token, numbers)
  const race = await Promise.all([
    application.claims.submit(host.game_id, first.player_token, 'early_five'),
    application.claims.submit(host.game_id, second.player_token, 'early_five'),
  ])
  assert.equal(race.filter(result => result.accepted).length, 1)
  assert.ok(race.some(result => result.reason === 'Already claimed by another player' && !result.penalty))
  await assert.rejects(application.claims.submit(host.game_id, first.player_token, 'second_full_house'))
  for (const claim of ['four_corners', 'top_line', 'middle_line', 'bottom_line'] as const) {
    assert.equal((await application.claims.submit(host.game_id, second.player_token, claim)).accepted, true)
  }
  assert.equal((await application.claims.submit(host.game_id, first.player_token, 'full_house')).accepted, true)
  assert.equal((await application.games.state(host.game_id)).status, 'closing')
  await application.games.status(host.game_id, host.host_token, 'paused')
  assert.equal((await application.games.status(host.game_id, host.host_token, 'playing')).status, 'closing')
  assert.equal((await application.claims.submit(host.game_id, second.player_token, 'second_full_house')).accepted, true)
  assert.equal((await application.games.state(host.game_id)).status, 'finished')
  await assert.rejects(application.claims.submit(host.game_id, wrong.player_token, 'full_house'))
})

test('closing ends ten calls after full house; draws exhaust at 90 without duplicates', async () => {
  const host = await create()
  await join(host.code, 'Player')
  await application.games.start(host.game_id, host.host_token)
  for (let i = 0; i < 90; i++) await application.games.draw(host.game_id, host.host_token)
  const full = await application.games.state(host.game_id)
  assert.equal(new Set(full.calls.map(call => call.number)).size, 90)
  await assert.rejects(application.games.draw(host.game_id, host.host_token), /All 90/)
  const closingHost = await create()
  await join(closingHost.code, 'Player')
  await application.games.start(closingHost.game_id, closingHost.host_token)
  await db.query(`UPDATE games SET status = 'closing', settings = jsonb_set(settings, '{closing_seq}', '0'::jsonb) WHERE id = $1`, [closingHost.game_id])
  for (let i = 0; i < 10; i++) await application.games.draw(closingHost.game_id, closingHost.host_token)
  assert.equal((await application.games.state(closingHost.game_id)).status, 'finished')
})

test('Socket.IO: room readiness, presence, committed updates, reconnect, and isolation', async () => {
  const host = await create()
  const other = await create()
  const socket = connect(base, { autoConnect: false, extraHeaders: { Cookie: adminCookie }, auth: { gameId: host.game_id, token: host.player_token } })
  const foreign = connect(base, { autoConnect: false, extraHeaders: { Cookie: adminCookie }, auth: { gameId: other.game_id } })
  try {
    const ready = event(socket, 'room_ready'); socket.connect(); await ready
    const foreignReady = event(foreign, 'room_ready'); foreign.connect(); await foreignReady
    let foreignEvents = 0
    foreign.on('game_changed', () => { foreignEvents++ })
    const update = event(socket, 'game_changed')
    await join(host.code, 'Socket Player')
    await update
    assert.equal((await application.games.state(host.game_id)).players.length, 2)
    assert.equal(foreignEvents, 0)
    socket.emit('game_changed', { status: 'finished' })
    assert.equal((await application.games.state(host.game_id)).status, 'lobby')
    socket.disconnect()
    const reconnected = event(socket, 'room_ready'); socket.connect(); await reconnected
    const projector = connect(base, { autoConnect: false, extraHeaders: { Cookie: adminCookie }, auth: { gameId: host.game_id } })
    try {
      const count = event<number>(socket, 'presence')
      const readyProjector = event(projector, 'room_ready'); projector.connect(); await readyProjector
      assert.equal(await count, 2)
    } finally { projector.disconnect() }
    const invalid = connect(base, { autoConnect: false, extraHeaders: { Cookie: adminCookie }, reconnection: false, auth: { gameId: host.game_id, token: 'f'.repeat(64) } })
    try {
      const failure = event<Error>(invalid, 'connect_error'); invalid.connect(); await failure
      assert.equal(invalid.connected, false)
    } finally { invalid.disconnect() }
  } finally { socket.disconnect(); foreign.disconnect() }
})

test('Game API requires an account and denies member game creation', async () => {
  assert.equal((await fetch(`${base}/api/games`)).status,401)
  const host=await create()
  const member=await join(host.code,'Role check member')
  await api('/api/games','POST',{hostName:'Pretend admin'},member.player_token,403)
})

test('Admins can list and restore their games; members cannot restore a host session', async () => {
  const host=await create()
  const member=await join(host.code,'Restore member')
  const games=await api<{games:Array<{id:string}>}>('/api/games')
  assert.ok(games.games.some(game=>game.id===host.game_id))
  await api(`/api/games/${host.game_id}/session`,'POST',{},member.player_token,403)
  const restored=await api<CreateGameResult>(`/api/games/${host.game_id}/session`,'POST',{})
  assert.notEqual(restored.host_token,host.host_token)
  await api(`/api/games/${host.game_id}/start`,'POST',undefined,host.host_token,403)
  await api(`/api/games/${host.game_id}/start`,'POST',undefined,restored.host_token)
})
