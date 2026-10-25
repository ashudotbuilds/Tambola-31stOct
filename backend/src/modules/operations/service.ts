import { z } from 'zod'
import type { Database } from '../../db/database'
import { AppError } from '../../errors'

interface Cursor { createdAt: string; id: string }
const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict()
const safeMetadataKeys = new Set([
  'eventId','roundId','roundNo','seq','pattern','manual','status','created','skipped','failed','total','inputCount',
  'credentialStatus','errorCode','role','sent','principalType','count','reason','points','score','warningCount','suspicious','number','question','gameCode','connections','method','path',
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
    const { rows: [counts] } = await this.db.query<{
      participants: number; games: number; activeGames: number; draws: number; acceptedClaims: number; rejectedClaims: number
    }>(`SELECT
      (SELECT count(*)::int FROM participant_profiles) AS participants,
      (SELECT count(*)::int FROM games WHERE deleted_at IS NULL) AS games,
      (SELECT count(*)::int FROM games WHERE deleted_at IS NULL AND status IN ('playing','closing','paused')) AS "activeGames",
      (SELECT count(*)::int FROM game_calls) AS draws,
      (SELECT count(*)::int FROM claims WHERE status='accepted') AS "acceptedClaims",
      (SELECT count(*)::int FROM claims WHERE status='rejected') AS "rejectedClaims"`)
    return { ok: true as const, counts, socketConnections }
  }

  async audit(input: { limit: number; actorId?: string; search?: string; gameId?: string; suspicious?: boolean; action?: string; from?: string; to?: string; cursor?: string }) {
    if (input.from && input.to && new Date(input.from) > new Date(input.to)) throw new AppError(400, '`from` must be earlier than or equal to `to`')
    let game: { code: string; status: string; deleted: boolean; host: string | null } | null = null
    if (input.gameId) {
      const { rows } = await this.db.query<{ code: string; status: string; deleted: boolean; host: string | null }>(
        'SELECT g.code,g.status,(g.deleted_at IS NOT NULL) AS deleted,u.name AS host FROM games g LEFT JOIN users u ON u.id=g.account_user_id WHERE g.id=$1', [input.gameId])
      if (!rows[0]) throw new AppError(404, 'Game not found')
      game = rows[0]
    }
    const conditions: string[] = []
    const values: unknown[] = []
    const add = (condition: (p: string) => string, value: unknown) => { values.push(value); conditions.push(condition(`$${values.length}`)) }
    if (input.actorId) add(p => `a.actor_id=${p}::uuid`, input.actorId)
    if (input.action) add(p => `a.action=${p}`, input.action)
    if (input.search) add(p => `position(lower(${p}) in lower(concat_ws(' ',coalesce(a.actor_name,u.name),coalesce(a.actor_email,u.email),a.metadata->>'email',t.name,t.email,g.code))) > 0`, input.search)
    if (input.gameId) add(p => `((a.resource_type='game' AND a.resource_id=${p}) OR
      (a.action IN ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT') AND EXISTS (
        SELECT 1 FROM game_players gp JOIN games scope ON scope.id=gp.game_id
        WHERE gp.game_id=${p}::uuid AND gp.account_user_id=a.actor_id
          AND a.created_at >= scope.created_at AND a.created_at <= coalesce(scope.deleted_at,now()))))`, input.gameId)
    const suspiciousSql = `(a.action IN ('LOGIN_FAILED','ACCESS_DENIED','GAME_CONNECTION_DENIED','GAME_ADDITIONAL_CONNECTION') OR a.metadata->>'suspicious'='true')`
    if (input.suspicious) conditions.push(suspiciousSql)
    if (input.from) add(p => `a.created_at >= ${p}::timestamptz`, input.from)
    if (input.to) add(p => `a.created_at <= ${p}::timestamptz`, input.to)
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor)
      values.push(cursor.createdAt, cursor.id)
      conditions.push(`(a.created_at < $${values.length - 1}::timestamptz OR (a.created_at=$${values.length - 1}::timestamptz AND a.id < $${values.length}::uuid))`)
    }
    values.push(input.limit + 1)
    const { rows } = await this.db.query<{
      id: string; actor_id: string | null; actor_name: string | null; actor_email: string | null;
      target_name: string | null; target_email: string | null; game_code: string | null;
      action: string; resource_type: string; resource_id: string | null; metadata: unknown; created_at: Date;
      ip_address: string | null; user_agent: string | null; suspicious: boolean
    }>(`SELECT a.id,a.actor_id,coalesce(a.actor_name,u.name) AS actor_name,
      coalesce(a.actor_email,u.email,a.metadata->>'email') AS actor_email,
      t.name AS target_name,t.email AS target_email,g.code AS game_code,
      a.action,a.resource_type,a.resource_id,a.metadata,a.created_at,a.ip_address,a.user_agent,
      coalesce(${suspiciousSql},false) AS suspicious
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      LEFT JOIN games g ON g.id::text=a.resource_id AND a.resource_type='game'
      LEFT JOIN admin_profiles ap ON ap.id::text=a.resource_id AND a.resource_type='admin_profile'
      LEFT JOIN participant_profiles pp ON pp.id::text=a.resource_id AND a.resource_type='participant_profile'
      LEFT JOIN users t ON (t.id::text=a.resource_id AND a.resource_type='user') OR t.id=ap.user_id OR t.id=pp.user_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC,a.id DESC LIMIT $${values.length}`, values)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page.at(-1)
    return { ok: true as const, game, entries: page.map(row => ({
      id: row.id, actorId: row.actor_id, actorName: row.actor_name, actorEmail: row.actor_email,
      targetName: row.target_name, targetEmail: row.target_email, gameCode: row.game_code,
      action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
      metadata: safeMetadata(row.metadata), createdAt: row.created_at,
      ipAddress: row.ip_address, userAgent: row.user_agent, suspicious: row.suspicious,
    })), nextCursor: hasMore && last ? encodeCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id }) : null }
  }

  async system() {
    try {
      await this.db.query('SELECT id FROM games LIMIT 0')
      const { rows: [migration] } = await this.db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')
      return { ok: true as const, version: process.env.RELEASE_VERSION ?? null, nodeVersion: process.version, readiness: true, latestMigration: migration?.name ?? null }
    } catch {
      return { ok: true as const, version: process.env.RELEASE_VERSION ?? null, nodeVersion: process.version, readiness: false, latestMigration: null }
    }
  }
}
