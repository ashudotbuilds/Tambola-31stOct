/**
 * Parity test: the TypeScript claim mirror must agree with the SQL rules.
 *
 * The claim buttons in the player UI are gated by isClaimEligible() in
 * src/lib/claims.ts, a hand-written mirror of the SQL function
 * tambola_claim_ok(). Drift between the two is invisible at runtime: a player
 * either cannot claim a line they earned, or gets a button the server punishes.
 *
 * So: ask the server for its verdict on hundreds of random tickets, recompute
 * each verdict with the mirror, and compare.
 *
 * Run:  node --experimental-strip-types scripts/claims-parity.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@insforge/sdk'
import { isClaimEligible } from '../src/lib/claims.ts'
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
