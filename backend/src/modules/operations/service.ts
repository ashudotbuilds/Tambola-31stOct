import { z } from 'zod'
import type { Database } from '../../db/database'
import { AppError } from '../../errors'
import type { AuthContext } from '../auth/models'

interface Cursor { createdAt: string; id: string }
const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict()
const safeMetadataKeys = new Set([
  'eventId','roundId','roundNo','seq','pattern','manual','status','created','skipped','failed','total','inputCount',
  'credentialStatus','errorCode','role','sent','principalType','count',
])

function encodeCursor(cursor: Cursor) { return Buffer.from(JSON.stringify(cursor)).toString('base64url') }
function decodeCursor(value: string): Cursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new AppError(400, 'Invalid audit cursor')
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = cursorSchema.safeParse(JSON.parse(decoded))
    if (!parsed.success || encodeCursor(parsed.data) !== value) throw new Error('invalid cursor')
    return parsed.data
  } catch { throw new AppError(400, 'Invalid audit cursor') }
}

function safeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, item]) =>
    safeMetadataKeys.has(key) && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null),
  ))
}

export class OperationsService {
  constructor(readonly db: Database) {}

  async dashboard(socketConnections: number) {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const { rows: [event] } = await tx.query<{ id: string; name: string; status: string; updated_at: Date }>(
        `SELECT id,name,status,updated_at FROM events WHERE status IN ('LIVE','PAUSED')
         ORDER BY updated_at DESC,id DESC LIMIT 1`,
      )
      const { rows: [recovery] } = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM rounds WHERE status='RECOVERY_REQUIRED'")
      if (!event) return { ok: true as const, event: null, round: null, counts: { participants: 0, draws: 0, pendingClaims: 0, verifiedWinners: 0 }, recoveryRequiredRounds: recovery?.count ?? 0, socketConnections }
      const { rows: [round] } = await tx.query<{ id: string; round_no: number; name: string; status: string }>(
        `SELECT id,round_no,name,status FROM rounds WHERE event_id=$1 AND status IN ('ACTIVE','PAUSED','RECOVERY_REQUIRED')
         ORDER BY round_no DESC LIMIT 1`, [event.id],
      )
      if (!round) return { ok: true as const, event: { id: event.id, name: event.name, status: event.status, updated_at: event.updated_at }, round: null, counts: { participants: 0, draws: 0, pendingClaims: 0, verifiedWinners: 0 }, recoveryRequiredRounds: recovery?.count ?? 0, socketConnections }
      const [{ rows: participants }, { rows: draws }, { rows: pending }, { rows: winners }] = await Promise.all([
        tx.query<{ count: number }>('SELECT count(*)::int AS count FROM participant_profiles WHERE event_id=$1', [event.id]),
        tx.query<{ count: number }>('SELECT count(*)::int AS count FROM round_draws WHERE round_id=$1', [round.id]),
        tx.query<{ count: number }>("SELECT count(*)::int AS count FROM round_claims WHERE round_id=$1 AND status='PENDING_VERIFICATION'", [round.id]),
        tx.query<{ count: number }>("SELECT count(*)::int AS count FROM round_claims WHERE round_id=$1 AND status='VERIFIED'", [round.id]),
      ])
      return {
        ok: true as const,
        event: { id: event.id, name: event.name, status: event.status, updated_at: event.updated_at },
        round,
        counts: { participants: participants[0]?.count ?? 0, draws: draws[0]?.count ?? 0, pendingClaims: pending[0]?.count ?? 0, verifiedWinners: winners[0]?.count ?? 0 },
        recoveryRequiredRounds: recovery?.count ?? 0,
        socketConnections,
      }
    })
  }

  async audit(input: { limit: number; actorId?: string; action?: string; from?: string; to?: string; cursor?: string }) {
    if (input.from && input.to && new Date(input.from).getTime() > new Date(input.to).getTime()) {
      throw new AppError(400, '`from` must be earlier than or equal to `to`')
    }
    const conditions: string[] = []
    const values: unknown[] = []
    const add = (condition: (placeholder: string, next?: string) => string, value: unknown, next?: unknown) => {
      values.push(value)
      const first = `$${values.length}`
      if (next !== undefined) { values.push(next); conditions.push(condition(first, `$${values.length}`)) }
      else conditions.push(condition(first))
    }
    if (input.actorId) add(p => `actor_id=${p}::uuid`, input.actorId)
    if (input.action) add(p => `action=${p}`, input.action)
    if (input.from) add(p => `created_at >= ${p}::timestamptz`, input.from)
    if (input.to) add(p => `created_at <= ${p}::timestamptz`, input.to)
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor)
      add((p, id) => `(created_at < ${p}::timestamptz OR (created_at=${p}::timestamptz AND id < ${id}::uuid))`, cursor.createdAt, cursor.id)
    }
    values.push(input.limit + 1)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await this.db.query<{
      id: string; actor_id: string | null; action: string; resource_type: string; resource_id: string | null; metadata: unknown; created_at: Date
    }>(
      `SELECT id,actor_id,action,resource_type,resource_id,metadata,created_at
       FROM audit_logs ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
      values,
    )
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const safeRows = page.map(row => ({
      id: row.id, actorId: row.actor_id, action: row.action, resourceType: row.resource_type,
      resourceId: row.resource_id, metadata: safeMetadata(row.metadata), createdAt: row.created_at,
    }))
    const last = page.at(-1)
    return { ok: true as const, entries: safeRows, nextCursor: hasMore && last ? encodeCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id }) : null }
  }

  async system() {
    let recoveryRequiredRounds: number | null = null
    let latestMigration: string | null = null
    let ready: boolean | null = null
    try {
      const [{ rows: [recovery] }, { rows: [migration] }] = await Promise.all([
        this.db.query<{ count: number }>("SELECT count(*)::int AS count FROM rounds WHERE status='RECOVERY_REQUIRED'"),
        this.db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1'),
      ])
      recoveryRequiredRounds = recovery?.count ?? null
      latestMigration = migration?.name ?? null
      ready = true
    } catch {
      ready = false
    }
    return { ok: true as const, version: process.env.RELEASE_VERSION ?? null, nodeVersion: process.version, readiness: ready, recoveryRequiredRounds, latestMigration }
  }
}
