import test from 'node:test'
import assert from 'node:assert/strict'
import { testDatabase } from './helpers'
import { runMigrations } from '../src/db/migrations'
import { runIdempotently } from '../src/modules/idempotency/service'
import type { Database } from '../src/db/database'
import { fileURLToPath } from 'node:url'

const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url))

test('idempotency replays the committed response and rejects key reuse with another payload', async () => {
  const db: Database = await testDatabase()
  try {
    await runMigrations(db, migrationDir)
    const { rows: [user] } = await db.query<{ id: string }>(
      `INSERT INTO users(email,password_hash,name) VALUES ('idem@test.local','hash','Idempotency Test') RETURNING id`,
    )
    let effects = 0
    const first = await runIdempotently({
      db, actorId: user.id, operation: 'test.once', key: 'stable-retry-key-001', payload: { roundId: 'r1', action: 'claim' },
      work: async tx => {
        effects++
        await tx.query("INSERT INTO audit_logs(actor_id,action,resource_type,metadata) VALUES ($1,'IDEMPOTENCY_TEST','test','{}')", [user.id])
        return { ok: true, claimId: 'claim-1' }
      },
    })
    const replay = await runIdempotently({
      db, actorId: user.id, operation: 'test.once', key: 'stable-retry-key-001', payload: { action: 'claim', roundId: 'r1' },
      work: async () => { effects++; return { ok: true, claimId: 'unexpected' } },
    })
    assert.deepEqual(replay, first)
    assert.equal(effects, 1)
    await assert.rejects(runIdempotently({
      db, actorId: user.id, operation: 'test.once', key: 'stable-retry-key-001', payload: { roundId: 'r2', action: 'claim' },
      work: async () => ({ ok: true }),
    }), /different request/)
    const { rows: [count] } = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE action='IDEMPOTENCY_TEST'")
    assert.equal(count.count, 1)
  } finally {
    await db.close()
  }
})
