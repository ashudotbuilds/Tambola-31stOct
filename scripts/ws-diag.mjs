/**
 * Realtime diagnostic: dumps the RAW payload of every event the app receives.
 *
 * Reproduces the client sequence in src/hooks/useGameRoom.ts against the real
 * backend and reports ACCEPT/DROP for each payload using the same filter the
 * app applies (channelOf in src/lib/channel.ts, mirrored here because the
 * harness cannot import TypeScript). Exits non-zero if anything is dropped.
 *
 * When the UI "stops receiving events" but the socket looks healthy, run this
 * first: it shows the exact bytes that arrived and which filter rejected them.
 *
 * Run: node scripts/ws-diag.mjs
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
const newClient = () => createClient({ baseUrl: URL_, anonKey: KEY })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpc(client, name, args) {
  const { data, error } = await client.database.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data
  if (value?.ok === false) throw new Error(`${name}: ${value.error}`)
  return value
}

const game = newClient()
const host = await rpc(game, 'create_game', { p_host_name: 'DiagHost' })
const channel = `game:${host.game_id}`
console.log(`\nws-diag  game ${host.code}  channel ${channel}\n`)

// ---- exactly what useGameRoom does -------------------------------------
const bus = newClient().realtime
const seen = []

// The hook registers listeners AFTER connect() + subscribe() resolve.
await bus.connect()
const res = await bus.subscribe(channel)
console.log('subscribe:', JSON.stringify({ ok: res.ok, error: res.error?.message ?? null }))
console.log('presence members:', res.presence?.members?.length)

// Mirrors channelOf() in src/lib/channel.ts.
const strip = (c) =>
  typeof c === 'string' && c.startsWith('realtime:') ? c.slice('realtime:'.length) : c
const guard = (room, name) => (payload) => {
  const metaChannel = payload && typeof payload === 'object' ? payload?.meta?.channel : null
  const accepted = !metaChannel || strip(metaChannel) === room
  seen.push({ name, accepted, metaChannel, payload })
}

for (const name of [
  'player_joined',
  'status_changed',
  'number_called',
  'claim_result',
  'scoreboard',
  'ticket_updated',
  'connect',
  'disconnect',
  'connect_error',
  'error',
]) {
  bus.on(name, guard(channel, name))
}
// ------------------------------------------------------------------------

await sleep(800)
const player = await rpc(game, 'join_game', { p_code: host.code, p_name: 'DiagPlayer' })
await sleep(1500)
await rpc(game, 'start_game', { p_game_id: host.game_id, p_host_token: host.host_token })
await sleep(1500)
await rpc(game, 'draw_number', { p_game_id: host.game_id, p_host_token: host.host_token })
await sleep(2000)
await rpc(game, 'submit_claim', {
  p_game_id: host.game_id,
  p_player_token: player.player_token,
  p_claim: 'full_house',
})
await sleep(2500)

// --- self-cut attribution -------------------------------------------------
// A rejection cuts one marked number, and the event carries tickets.player_id
// — a game_players.id, never the secret token the client holds. The hook used
// to compare the two, so cuts never reached the player's own ticket.
let me = null
for (let i = 0; i < 12 && !(me?.marked?.length); i++) {
  await rpc(game, 'draw_number', { p_game_id: host.game_id, p_host_token: host.host_token })
  await sleep(400)
  const snapshot = await rpc(game, 'get_game_state', {
    p_game_id: host.game_id,
    p_player_token: player.player_token,
  })
  me = snapshot.me
}

let cutFailure = null
if (!me?.marked?.length) {
  cutFailure = 'no marked number after 12 draws, could not exercise a cut'
} else {
  const rejected = await rpc(game, 'submit_claim', {
    p_game_id: host.game_id,
    p_player_token: player.player_token,
    p_claim: 'early_five',
  })
  await sleep(2500)
  const evt = seen.find((s) => s.name === 'ticket_updated')
  if (rejected?.cut === null || rejected?.cut === undefined) {
    cutFailure = `expected a cut, got ${JSON.stringify(rejected)}`
  } else if (!evt) {
    cutFailure = 'ticket_updated never arrived'
  } else if (evt.payload.player_id !== me.player_id) {
    cutFailure = `event.player_id ${evt.payload.player_id} !== me.player_id ${me.player_id}`
  } else if (evt.payload.player_id === player.player_token) {
    cutFailure = 'event.player_id is the token, so the old comparison would still pass by luck'
  }
}
console.log(
  `\nself-cut attribution: ${
    cutFailure ? `FAIL — ${cutFailure}` : `OK — player_id matches me.player_id and is not the token`
  }`,
)

console.log('\nraw payloads received by the hook-shaped listener:\n')
for (const s of seen) {
  console.log(
    `  ${s.accepted ? 'ACCEPT' : 'DROP  '}  event.meta.channel=${JSON.stringify(s.metaChannel)}`,
  )
  console.log(`          ${JSON.stringify(s.payload).slice(0, 400)}`)
}
if (seen.length === 0) console.log('  (nothing arrived at all)')

const dropped = seen.filter((s) => !s.accepted).length
console.log('\nsummary:', JSON.stringify({
  received: seen.length,
  dropped,
  noMeta: seen.filter((s) => !s.metaChannel).length,
}))

await bus.disconnect()
await game.database.from('games').delete().eq('id', host.game_id)
console.log('cleaned up\n')
if (dropped > 0 || cutFailure) {
  if (dropped > 0) console.error(`${dropped} event(s) were dropped by the app's channel filter`)
  if (cutFailure) console.error(`self-cut attribution failed: ${cutFailure}`)
  process.exit(1)
}
process.exit(0)
