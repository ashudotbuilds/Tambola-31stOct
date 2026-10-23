import { createHash } from 'node:crypto'
import type { Database, SqlClient } from '../../db/database'
import { AppError } from '../../errors'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function runIdempotently<T>(input: {
  db: Database
  actorId: string
  operation: string
  key: string
  payload: unknown
  work: (tx: SqlClient) => Promise<T>
}): Promise<T> {
  if (!/^[A-Za-z0-9._~-]{8,128}$/.test(input.key)) {
    throw new AppError(400, 'Idempotency-Key must be 8 to 128 safe characters')
  }
  const payloadHash = createHash('sha256').update(stable(input.payload)).digest('hex')
  return input.db.transaction(async tx => {
    await tx.query(
      `INSERT INTO idempotency_records(actor_id, operation, idempotency_key, payload_hash)
       VALUES ($1,$2,$3,$4) ON CONFLICT(actor_id, operation, idempotency_key) DO NOTHING`,
      [input.actorId, input.operation, input.key, payloadHash],
    )
    const { rows: [record] } = await tx.query<{ payload_hash: string; response: T | null }>(
      `SELECT payload_hash, response FROM idempotency_records
       WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE`,
      [input.actorId, input.operation, input.key],
    )
    if (record.payload_hash !== payloadHash) {
      throw new AppError(409, 'Idempotency-Key was already used with a different request')
    }
    if (record.response !== null) return record.response
    const result = await input.work(tx)
    await tx.query(
      `UPDATE idempotency_records SET response=$4::jsonb WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3`,
      [input.actorId, input.operation, input.key, JSON.stringify(result)],
    )
    return result
  })
}
