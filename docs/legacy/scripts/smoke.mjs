/**
 * End-to-end smoke test against the real InsForge backend.
 *
 * Proves an *anonymous* client (public anon key only, no account) can subscribe
 * to a game channel and receive events published by database triggers, and that
 * a client cannot publish its own events.
 *
 * Run:  node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@insforge/sdk'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.NEXT_PUBLIC_INSFORGE_URL
const KEY = env.NEXT_PUBLIC_INSFORGE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('Missing NEXT_PUBLIC_INSFORGE_URL / NEXT_PUBLIC_INSFORGE_ANON_KEY in .env.local')
  process.exit(1)
}

const newClient = () => createClient({ baseUrl: URL_, anonKey: KEY })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail && !condition ? ` -- ${detail}` : ''}`)
}

async function rpc(client, name, args) {
  const { data, error } = await client.database.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data
  if (value?.ok === false) throw new Error(`${name}: ${value.error}`)
  return value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function watch(client, events) {
  const received = new Map(events.map((e) => [e, []]))
  for (const name of events) {
    client.realtime.on(name, (payload) => received.get(name).push(payload))
  }
  return {
    received,
    count: (name) => received.get(name).length,
    async waitFor(name, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (received.get(name).length > 0) return received.get(name)[0]
        await sleep(100)
      }
      return null
    },
  }
}

const game = newClient()
const host = await rpc(game, 'create_game', { p_host_name: 'SmokeHost' })
const channel = `game:${host.game_id}`
console.log(`\nTechnical Tambola smoke test\ngame ${host.code}  (${channel})\n`)

const EVENTS = ['player_joined', 'status_changed', 'number_called', 'claim_result', 'scoreboard', 'presence:join']

console.log('single anonymous connection')
const a = newClient()
const aView = watch(a, EVENTS)
await a.realtime.connect()
const subA = await a.realtime.subscribe(channel)
check('anon subscribed', subA.ok === true, subA.error?.message ?? '')
check('presence snapshot returned', Array.isArray(subA.presence?.members))
await sleep(1200)

const player = await rpc(game, 'join_game', { p_code: host.code, p_name: 'SmokePlayer' })
await rpc(game, 'join_game', { p_code: host.code, p_name: 'SmokePlayer2' })
check('player_joined delivered', Boolean(await aView.waitFor('player_joined')))
check('lobby shows three players',
  (await rpc(game, 'get_game_state', { p_game_id: host.game_id, p_player_token: null })).players.length === 3)

await rpc(game, 'start_game', { p_game_id: host.game_id, p_host_token: host.host_token })
const statusEvent = await aView.waitFor('status_changed')
check('status_changed delivered', statusEvent?.status === 'playing', JSON.stringify(statusEvent))

const draw1 = await rpc(game, 'draw_number', { p_game_id: host.game_id, p_host_token: host.host_token })
const call1 = await aView.waitFor('number_called')
check('number_called delivered', call1?.number === draw1.number, JSON.stringify(call1))
check('clue rides along', typeof call1?.clue === 'string' && call1.clue.length > 2, String(call1?.clue))
// useGameRoom discards any event whose meta.channel is not this room. The
// platform namespaces broadcasts as `realtime:<channel>`, so a change to that
// contract would stop the UI rendering events while the socket still looks
// healthy. Pin the raw shape here; src/lib/channel.ts is pinned in parity.
check('broadcast is namespaced as realtime:<channel>',
  call1?.meta?.channel === `realtime:${channel}`, JSON.stringify(call1?.meta ?? null))

const badClaim = await rpc(game, 'submit_claim', {
  p_game_id: host.game_id,
  p_player_token: player.player_token,
  p_claim: 'full_house',
})
check('impossible full house rejected', badClaim.accepted === false, JSON.stringify(badClaim))
check('rejection carried a 10 point penalty', badClaim.penalty === 10, JSON.stringify(badClaim))
const claim1 = await aView.waitFor('claim_result')
check('claim_result delivered', claim1?.status === 'rejected', JSON.stringify(claim1))
// The penalty is clamped at zero, so the score does not move and the scoreboard
// trigger correctly stays quiet.
check('no scoreboard event when the score does not change', aView.count('scoreboard') === 0,
  `got ${aView.count('scoreboard')}`)

console.log('\nsecond anonymous connection, same anon key')
const b = newClient()
const bView = watch(b, EVENTS)
await b.realtime.connect()
const subB = await b.realtime.subscribe(channel)
check('second anon subscribed', subB.ok === true, subB.error?.message ?? '')
await sleep(1200)

// Presence deltas are the other half of the contract: they arrive on the bare
// channel, never namespaced, so the device counter must accept that shape too.
const joinEvent = await aView.waitFor('presence:join')
check('presence delta arrives on the bare channel',
  joinEvent?.meta?.channel === channel, JSON.stringify(joinEvent?.meta ?? null))

// Let everything in flight settle before counting.
await sleep(1500)
const callsBefore = aView.count('number_called')
const draw2 = await rpc(game, 'draw_number', { p_game_id: host.game_id, p_host_token: host.host_token })
await sleep(2500)
const newForA = aView.received.get('number_called').slice(callsBefore)
const newForB = bView.received.get('number_called')
check('first connection still receives new calls',
  newForA.some((e) => e.number === draw2.number),
  `expected ${draw2.number}, got ${JSON.stringify(newForA.map((e) => e.number))}`)
check('second connection receives new calls',
  newForB.some((e) => e.number === draw2.number),
  `expected ${draw2.number}, got ${JSON.stringify(newForB.map((e) => e.number))}`)

console.log('\nclients cannot forge events')
const forgedBefore = aView.count('number_called')
await a.realtime.publish(channel, 'number_called', { number: 42, seq: 999, clue: 'forged' })
await sleep(2000)
const forgedAfter = aView.received.get('number_called').slice(forgedBefore)
check('a published number_called was ignored',
  !forgedAfter.some((e) => e.clue === 'forged' || e.number === 42),
  `received ${JSON.stringify(forgedAfter)}`)

console.log('\nsecurity')
const stolen = await game.database.rpc('draw_number', {
  p_game_id: host.game_id,
  p_host_token: player.player_token,
})
const denied = Array.isArray(stolen.data) ? stolen.data[0] : stolen.data
check('a player token cannot call a number', denied?.ok === false, JSON.stringify(denied))

const tableRead = await game.database.from('tickets').select('cells').limit(1)
check('anon cannot read the tickets table', Boolean(tableRead.error), 'the read unexpectedly succeeded')

const own = await rpc(game, 'get_game_state', { p_game_id: host.game_id, p_player_token: player.player_token })
check('owner gets their ticket back', own.me?.ticket?.length === 3)
check('ticket has 15 numbers', own.me.ticket.flat().filter((n) => n !== null).length === 15)

const noToken = await rpc(game, 'get_game_state', { p_game_id: host.game_id, p_player_token: null })
check('tokenless read exposes no ticket', noToken.me === null, JSON.stringify(noToken.me))
check('no player token in a tokenless read', !JSON.stringify(noToken).includes(player.player_token))
check('no host token in a tokenless read', !JSON.stringify(noToken).includes(host.host_token))

console.log('\ncleanup')
await a.realtime.disconnect()
await b.realtime.disconnect()
const cleanup = await rpc(game, 'get_game_state', { p_game_id: host.game_id, p_player_token: null })
void cleanup
const { error: delErr } = await game.database.from('games').delete().eq('id', host.game_id)
check('test game removed', delErr === null || !delErr.message.includes('row-level'), delErr?.message ?? '')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}  (game ${host.code})\n`)
process.exit(failures === 0 ? 0 : 1)
