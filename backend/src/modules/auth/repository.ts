import { createHash, randomBytes } from 'node:crypto'
import type { SqlClient } from '../../db/database'
import type {
  AdminProfileRecord,
  AdminRole,
  AuditLogRecord,
  ParticipantProfileRecord,
  SessionRecord,
  UserRecord,
  UserStatus,
} from './models'

export function newSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function findUserByEmail(client: SqlClient, email: string): Promise<UserRecord | undefined> {
  const { rows } = await client.query<UserRecord>(
    'SELECT * FROM users WHERE lower(trim(email)) = lower(trim($1)) OR lower(login_id)=lower(trim($1)) OR id::text=trim($1)',
    [email],
  )
  return rows[0]
}

export async function findUserById(client: SqlClient, id: string): Promise<UserRecord | undefined> {
  const { rows } = await client.query<UserRecord>(
    'SELECT * FROM users WHERE id = $1',
    [id],
  )
  return rows[0]
}

export async function createUser(
  client: SqlClient,
  email: string,
  passwordHash: string,
  name: string,
  status: UserStatus = 'ACTIVE',
): Promise<UserRecord> {
  const { rows } = await client.query<UserRecord>(
    `INSERT INTO users (email, password_hash, name, status)
     VALUES (trim($1), $2, trim($3), $4)
     RETURNING *`,
    [email, passwordHash, name, status],
  )
  return rows[0]
}

export async function createAdminProfile(
  client: SqlClient,
  userId: string,
  role: AdminRole,
): Promise<AdminProfileRecord> {
  const { rows } = await client.query<AdminProfileRecord>(
    `INSERT INTO admin_profiles (user_id, role)
     VALUES ($1, $2)
     RETURNING *`,
    [userId, role],
  )
  return rows[0]
}

export async function findAdminProfileByUserId(
  client: SqlClient,
  userId: string,
): Promise<AdminProfileRecord | undefined> {
  const { rows } = await client.query<AdminProfileRecord>(
    'SELECT * FROM admin_profiles WHERE user_id = $1',
    [userId],
  )
  return rows[0]
}

export async function countSuperAdmins(client: SqlClient): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM admin_profiles WHERE role = 'SUPER_ADMIN'",
  )
  return rows[0]?.count ?? 0
}

export interface AdminWithUser {
  id: string
  user_id: string
  role: AdminRole
  name: string
  email: string
  created_at: Date
  credential_status: string | null
  credential_last_sent_at: Date | null
}

export async function listAdminsWithUsers(client: SqlClient): Promise<AdminWithUser[]> {
  const { rows } = await client.query<AdminWithUser>(
    `SELECT ap.id, ap.user_id, ap.role, u.name, u.email, ap.created_at,
            cd.status AS credential_status, cd.last_sent_at AS credential_last_sent_at
     FROM admin_profiles ap
     JOIN users u ON u.id = ap.user_id
     LEFT JOIN admin_credential_deliveries cd ON cd.admin_profile_id=ap.id
     ORDER BY ap.created_at ASC`,
  )
  return rows
}

export async function deleteAdminProfile(client: SqlClient, profileId: string): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    'DELETE FROM admin_profiles WHERE id = $1 RETURNING id',
    [profileId],
  )
  return rows.length > 0
}

export async function findParticipantProfileByUserId(
  client: SqlClient,
  userId: string,
): Promise<ParticipantProfileRecord | undefined> {
  const { rows } = await client.query<ParticipantProfileRecord>(
    'SELECT * FROM participant_profiles WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  )
  return rows[0]
}

export async function createSession(
  client: SqlClient,
  session: {
    userId: string
    principalType: 'PARTICIPANT' | 'ADMIN' | 'SUPER_ADMIN'
    profileId: string
    tokenHash: string
    expiresAt: Date
    ipAddress?: string | null
    userAgent?: string | null
  },
): Promise<SessionRecord> {
  const { rows } = await client.query<SessionRecord>(
    `INSERT INTO sessions (user_id, principal_type, profile_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      session.userId,
      session.principalType,
      session.profileId,
      session.tokenHash,
      session.expiresAt,
      session.ipAddress ?? null,
      session.userAgent ?? null,
    ],
  )
  return rows[0]
}

export interface SessionWithUserAndProfile {
  session: SessionRecord
  user: UserRecord
  adminProfile?: AdminProfileRecord
  participantProfile?: ParticipantProfileRecord
}

export async function findActiveSession(
  client: SqlClient,
  tokenHash: string,
): Promise<SessionWithUserAndProfile | undefined> {
  const { rows: sessionRows } = await client.query<SessionRecord>(
    `SELECT * FROM sessions
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [tokenHash],
  )
  const session = sessionRows[0]
  if (!session) return undefined

  const { rows: userRows } = await client.query<UserRecord>(
    'SELECT * FROM users WHERE id = $1',
    [session.user_id],
  )
  const user = userRows[0]
  if (!user) return undefined

  let adminProfile: AdminProfileRecord | undefined
  let participantProfile: ParticipantProfileRecord | undefined

  if (session.principal_type === 'ADMIN' || session.principal_type === 'SUPER_ADMIN') {
    const { rows: adminRows } = await client.query<AdminProfileRecord>(
      'SELECT * FROM admin_profiles WHERE id = $1',
      [session.profile_id],
    )
    adminProfile = adminRows[0]
  } else if (session.principal_type === 'PARTICIPANT') {
    const { rows: partRows } = await client.query<ParticipantProfileRecord>(
      'SELECT * FROM participant_profiles WHERE id = $1',
      [session.profile_id],
    )
    participantProfile = partRows[0]
  }

  return { session, user, adminProfile, participantProfile }
}

export async function revokeSession(client: SqlClient, tokenHash: string): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id',
    [tokenHash],
  )
  return rows.length > 0
}

export async function recordAudit(
  client: SqlClient,
  audit: {
    actorId?: string | null
    action: string
    resourceType: string
    resourceId?: string | null
    metadata?: Record<string, unknown>
    ipAddress?: string | null
    userAgent?: string | null
  },
): Promise<AuditLogRecord> {
  const { rows } = await client.query<AuditLogRecord>(
    `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata, ip_address, user_agent, actor_name, actor_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       (SELECT name FROM users WHERE id = $1), (SELECT email FROM users WHERE id = $1))
     RETURNING *`,
    [
      audit.actorId ?? null,
      audit.action,
      audit.resourceType,
      audit.resourceId ?? null,
      JSON.stringify(audit.metadata ?? {}),
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
    ],
  )
  return rows[0]
}
