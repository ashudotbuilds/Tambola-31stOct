/**
 * Parity test: the TypeScript mirrors must agree with the server.
 *
 * The claim buttons in the player UI are gated by isClaimEligible() in
 * src/lib/claims.ts, a hand-written mirror of the SQL function
 * tambola_claim_ok(). Drift between the two is invisible at runtime: a player
 * either cannot claim a line they earned, or gets a button the server punishes.
 *
 * The realtime event feed is filtered by channelOf() in src/lib/channel.ts,
 * which strips the `realtime:` namespace the platform puts on broadcasts. A
 * literal comparison drops every event while the socket still looks healthy —
 * so both shapes the backend emits are pinned here.
 *
 * So: ask the server for its verdict on hundreds of random tickets, recompute
 * each verdict with the mirror, and compare.
 *
 * Run:  node --experimental-strip-types scripts/claims-parity.ts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@insforge/sdk'
import { isClaimEligible } from '../src/lib/claims.ts'
import { channelOf } from '../src/lib/channel.ts'
import type { ClaimType, Ticket } from '../src/lib/types.ts'

const CLAIM_TYPES = [
  'early_five',
  'four_corners',
  'top_line',
  'middle_line',
  'bottom_line',
  'full_house',
  'second_full_house',
]

// ---------------------------------------------------------------------------
// Realtime channel filter
// ---------------------------------------------------------------------------
// Captured verbatim from the live backend: broadcasts arrive namespaced,
// presence deltas arrive bare. useGameRoom must accept both as the same room.
const ROOM = 'game:ea25cbf9-10f5-44d1-93b5-9298efc0e623'
const channelCases: Array<{ label: string; payload: unknown; expect: string | null }> = [
  {
    label: 'database broadcast (number_called, player_joined, ...)',
    payload: { number: 84, meta: { channel: `realtime:${ROOM}` } },
    expect: ROOM,
  },
  { label: 'presence delta (presence:join/leave)', payload: { meta: { channel: ROOM } }, expect: ROOM },
  { label: 'foreign room is not ours', payload: { meta: { channel: 'realtime:game:other' } }, expect: 'game:other' },
  { label: 'connection lifecycle has no channel', payload: undefined, expect: null },
  { label: 'disconnect reason is a bare string', payload: 'transport close', expect: null },
]

const channelFailures = channelCases.filter((c) => channelOf(c.payload) !== c.expect)
console.log(`\nRealtime channel filter: ${channelCases.length - channelFailures.length}/${channelCases.length} shapes`)
if (channelFailures.length > 0) {
  for (const c of channelFailures) {
    console.log(`  MISMATCH ${c.label}: got ${JSON.stringify(channelOf(c.payload))}, want ${JSON.stringify(c.expect)}`)
  }
  console.log('  Every broadcast would be silently discarded by useGameRoom.\n')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const client = createClient({
  baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
  anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
})

const { data, error } = await client.database.rpc('claim_parity_fixture', { p_cases: 25 })
if (error) {
  console.error('fixture call failed:', error.message)
  process.exit(1)
}

// PostgREST returns a scalar jsonb as a bare array of scenarios.
const raw = data as unknown
const cases = (Array.isArray(raw) ? raw : [raw]).filter(
  (c): c is { family: string; cells: Ticket; marked: number[]; cut: number[]; server: Record<string, boolean> } =>
    !!c && typeof c === 'object' && 'server' in (c as object),
)
if (cases.length === 0) {
  console.error('fixture call returned no scenarios:', JSON.stringify(raw).slice(0, 200))
  process.exit(1)
}
console.log(`\nClaim parity: ${cases.length} scenarios x ${CLAIM_TYPES.length} claim types`)

let checked = 0
const mismatches = []
const coverage = Object.fromEntries(CLAIM_TYPES.map((c) => [c, 0]))

for (const testCase of cases) {
  const ticket = testCase.cells as Ticket
  const marked = new Set(testCase.marked as number[])
  const cut = new Set(testCase.cut as number[])

  for (const claim of CLAIM_TYPES) {
    const server = Boolean(testCase.server[claim])
    const client = isClaimEligible(claim as ClaimType, ticket, marked, cut)
    checked += 1
    if (server) coverage[claim] += 1
    if (server !== client) {
      mismatches.push({
        family: testCase.family,
        claim,
        server,
        client,
        marked: testCase.marked,
        cut: testCase.cut,
        cells: testCase.cells,
      })
    }
  }
}

console.log(`\n  comparisons: ${checked}`)
console.log('  server said "eligible" this often:')
for (const claim of CLAIM_TYPES) {
  const bar = '#'.repeat(Math.min(40, coverage[claim]))
  console.log(`    ${claim.padEnd(18)} ${String(coverage[claim]).padStart(4)}  ${bar}`)
}

if (mismatches.length > 0) {
  console.log(`\n  ${mismatches.length} MISMATCH(ES):`)
  for (const m of mismatches.slice(0, 6)) {
    console.log(`    ${m.claim} (${m.family}) server=${m.server} client=${m.client}`)
    console.log(`      marked=${JSON.stringify(m.marked)} cut=${JSON.stringify(m.cut)}`)
    console.log(`      cells=${JSON.stringify(m.cells)}`)
  }
  process.exit(1)
}

console.log('\n  the TypeScript mirror matches the SQL for every scenario\n')
