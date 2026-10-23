import { randomBytes } from 'node:crypto'
import type { Database } from '../../db/database'
import { AppError, ensure } from '../../errors'
import { hashPassword, verifyPassword } from './password'
import type { EmailAdapter } from '../email/adapter'
import type { AdminRole, AuthContext, Principal, SafeUser } from './models'
import {
  countSuperAdmins,
  createAdminProfile,
  createSession,
  createUser,
  deleteAdminProfile,
  findActiveSession,
  findAdminProfileByUserId,
  findParticipantProfileByUserId,
  findUserByEmail,
  hashSessionToken,
  listAdminsWithUsers,
  newSessionToken,
  recordAudit,
  revokeSession,
} from './repository'

export interface AuthServiceOptions {
  bootstrapSecret?: string
  sessionDurationDays?: number
  email?: EmailAdapter
}

export class AuthService {
  private readonly sessionDurationMs: number

  constructor(
    readonly db: Database,
    readonly options: AuthServiceOptions = {},
  ) {
    this.sessionDurationMs = (options.sessionDurationDays ?? 7) * 24 * 60 * 60 * 1000
  }

  async bootstrapSuperAdmin(
    secretHeader: string | undefined,
    data: { email: string; name: string; password: string },
    context: { ip?: string; userAgent?: string } = {},
  ) {
    const configuredSecret = this.options.bootstrapSecret
    ensure(configuredSecret, 503, 'Super admin bootstrap is disabled or secret is unset')
    ensure(secretHeader === configuredSecret, 401, 'Invalid bootstrap secret')

    return this.db.transaction(async tx => {
      // Advisory transaction lock to serialize bootstrap attempts
      await tx.query('SELECT pg_advisory_xact_lock(981273918)')
      const existingSuperAdmins = await countSuperAdmins(tx)
      ensure(
        existingSuperAdmins === 0,
        409,
        'Bootstrap is permanently closed; a super admin already exists',
      )

      const existingUser = await findUserByEmail(tx, data.email)
      ensure(!existingUser, 409, 'A user with that email already exists')

      const passwordHash = await hashPassword(data.password)
      const user = await createUser(tx, data.email, passwordHash, data.name, 'ACTIVE')
      const profile = await createAdminProfile(tx, user.id, 'SUPER_ADMIN')

      await recordAudit(tx, {
        actorId: user.id,
        action: 'BOOTSTRAP_SUPER_ADMIN',
        resourceType: 'admin_profile',
        resourceId: profile.id,
        metadata: { email: user.email, name: user.name, role: 'SUPER_ADMIN' },
        ipAddress: context.ip,
        userAgent: context.userAgent,
      })

      const safeUser: SafeUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      }
      return { ok: true as const, user: safeUser, role: 'SUPER_ADMIN' as const }
    })
  }

  async login(
    email: string,
    passwordPlain: string,
    context: { ip?: string; userAgent?: string } = {},
  ) {
    const user = await findUserByEmail(this.db, email)
    if (!user) {
      await recordAudit(this.db, {
        action: 'LOGIN_FAILED',
        resourceType: 'user',
        metadata: { email, reason: 'user_not_found' },
        ipAddress: context.ip,
        userAgent: context.userAgent,
      })
      throw new AppError(401, 'Invalid email or password')
    }

    const passwordMatches = await verifyPassword(user.password_hash, passwordPlain)
    if (!passwordMatches) {
      await recordAudit(this.db, {
        actorId: user.id,
        action: 'LOGIN_FAILED',
        resourceType: 'user',
        metadata: { email, reason: 'password_mismatch' },
        ipAddress: context.ip,
        userAgent: context.userAgent,
      })
      throw new AppError(401, 'Invalid email or password')
    }

    ensure(user.status === 'ACTIVE', 403, 'Account is inactive or suspended')

    // Determine principal
    const admin = await findAdminProfileByUserId(this.db, user.id)
    let principal: Principal
    if (admin) {
      principal = {
        type: admin.role,
        role: admin.role,
        profileId: admin.id,
      }
    } else {
      const participant = await findParticipantProfileByUserId(this.db, user.id)
      ensure(participant, 403, 'User does not have an active participant or admin profile')
      principal = {
        type: 'PARTICIPANT',
        profileId: participant.id,
      }
    }

    const rawToken = newSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    const expiresAt = new Date(Date.now() + this.sessionDurationMs)

    await createSession(this.db, {
      userId: user.id,
      principalType: principal.type,
      profileId: principal.profileId,
      tokenHash,
      expiresAt,
      ipAddress: context.ip,
      userAgent: context.userAgent,
    })

    await recordAudit(this.db, {
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      resourceType: 'session',
      metadata: { principalType: principal.type, role: principal.role },
      ipAddress: context.ip,
      userAgent: context.userAgent,
    })

    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    }

    return {
      ok: true as const,
      token: rawToken,
      user: safeUser,
      principal,
    }
  }

  async authenticate(rawToken: string): Promise<AuthContext> {
    ensure(rawToken && typeof rawToken === 'string', 401, 'Session token is required')
    const tokenHash = hashSessionToken(rawToken)
    const active = await findActiveSession(this.db, tokenHash)
    ensure(active, 401, 'Session is invalid or has expired')
    ensure(active.user.status === 'ACTIVE', 403, 'Account is inactive or suspended')

    let principal: Principal
    if (active.adminProfile) {
      principal = {
        type: active.adminProfile.role,
        role: active.adminProfile.role,
        profileId: active.adminProfile.id,
      }
    } else if (active.participantProfile) {
      principal = {
        type: 'PARTICIPANT',
        profileId: active.participantProfile.id,
      }
    } else {
      throw new AppError(403, 'Associated profile is no longer active')
    }

    const safeUser: SafeUser = {
      id: active.user.id,
      email: active.user.email,
      name: active.user.name,
      status: active.user.status,
    }

    return {
      user: safeUser,
      principal,
      session: active.session,
    }
  }

  async logout(rawToken: string, actorId?: string): Promise<{ ok: true }> {
    if (rawToken) {
      const tokenHash = hashSessionToken(rawToken)
      await revokeSession(this.db, tokenHash)
      if (actorId) {
        await recordAudit(this.db, {
          actorId,
          action: 'LOGOUT',
          resourceType: 'session',
        })
      }
    }
    return { ok: true }
  }

  async createAdmin(
    actor: AuthContext,
    data: { email: string; name: string; role: AdminRole },
  ) {
    ensure(actor.principal.type === 'SUPER_ADMIN', 403, 'Only super admins can create administrators')
    ensure(this.options.email?.configured, 503, 'Credential email is not configured')
    const temporaryPassword = randomBytes(24).toString('base64url')
    const passwordHash = await hashPassword(temporaryPassword)

    const created = await this.db.transaction(async tx => {
      const existing = await findUserByEmail(tx, data.email)
      ensure(!existing, 409, 'A user with that email already exists')

      const user = await createUser(tx, data.email, passwordHash, data.name, 'INACTIVE')
      const profile = await createAdminProfile(tx, user.id, data.role)
      await tx.query(
        `INSERT INTO admin_credential_deliveries(admin_profile_id, generation, status, attempts, last_attempt_at)
         VALUES ($1,1,'PENDING',1,now())`, [profile.id],
      )

      await recordAudit(tx, {
        actorId: actor.user.id,
        action: 'ADMIN_CREATED',
        resourceType: 'admin_profile',
        resourceId: profile.id,
        metadata: { email: user.email, name: user.name, role: data.role, credentialStatus: 'PENDING' },
      })

      return { user: { id: user.id, email: user.email, name: user.name }, profile }
    })

    try {
      await this.options.email.sendCredential(created.user.email, created.user.name, temporaryPassword, 'administrator')
    } catch {
      await this.db.transaction(async tx => {
        await tx.query("UPDATE admin_credential_deliveries SET status='FAILED', last_error_code='EMAIL_PROVIDER_ERROR', updated_at=now() WHERE admin_profile_id=$1", [created.profile.id])
        await recordAudit(tx, { actorId: actor.user.id, action: 'ADMIN_CREDENTIAL_DELIVERY_FAILED', resourceType: 'admin_profile', resourceId: created.profile.id, metadata: { errorCode: 'EMAIL_PROVIDER_ERROR' } })
      })
      throw new AppError(502, 'Administrator account is retained, but credential email failed. Generate a new credential to retry.')
    }

    await this.db.transaction(async tx => {
      await tx.query("UPDATE users SET status='ACTIVE', updated_at=now() WHERE id=$1", [created.user.id])
      await tx.query("UPDATE admin_credential_deliveries SET status='SENT', last_sent_at=now(), updated_at=now() WHERE admin_profile_id=$1", [created.profile.id])
      await recordAudit(tx, { actorId: actor.user.id, action: 'ADMIN_CREDENTIAL_DELIVERY_SENT', resourceType: 'admin_profile', resourceId: created.profile.id, metadata: { status: 'SENT' } })
    })
    return { ok: true as const, user: { ...created.user, status: 'ACTIVE' as const }, role: created.profile.role, credential_status: 'SENT' as const }
  }

  async listAdmins(actor: AuthContext) {
    ensure(actor.principal.type === 'SUPER_ADMIN', 403, 'Only super admins can view administrators')
    return listAdminsWithUsers(this.db)
  }

  async regenerateAdminCredential(actor: AuthContext, profileId: string) {
    ensure(actor.principal.type === 'SUPER_ADMIN', 403, 'Only super admins can issue administrator credentials')
    ensure(this.options.email?.configured, 503, 'Credential email is not configured')
    const temporaryPassword = randomBytes(24).toString('base64url')
    const passwordHash = await hashPassword(temporaryPassword)
    const admin = await this.db.transaction(async tx => {
      const { rows: [row] } = await tx.query<{
        id: string; user_id: string; name: string; email: string; credential_status: string | null; credential_updated_at: Date | null
      }>(
        `SELECT ap.id, ap.user_id, u.name, u.email, cd.status AS credential_status, cd.updated_at AS credential_updated_at
         FROM admin_profiles ap JOIN users u ON u.id=ap.user_id
         LEFT JOIN admin_credential_deliveries cd ON cd.admin_profile_id=ap.id
         WHERE ap.id=$1 FOR UPDATE OF ap,u`, [profileId],
      )
      ensure(row, 404, 'Admin profile not found')
      ensure(!(row.credential_status === 'PENDING' && row.credential_updated_at && Date.now() - new Date(row.credential_updated_at).getTime() < 60_000), 409, 'Credential delivery is already in progress; try again shortly')
      await tx.query("UPDATE users SET password_hash=$2, status='INACTIVE', updated_at=now() WHERE id=$1", [row.user_id, passwordHash])
      await tx.query('UPDATE sessions SET revoked_at=now() WHERE profile_id=$1 AND revoked_at IS NULL', [profileId])
      const { rows: [delivery] } = await tx.query<{ generation: number }>(
        `INSERT INTO admin_credential_deliveries(admin_profile_id, generation, status, attempts, last_attempt_at)
         VALUES ($1,1,'PENDING',1,now())
         ON CONFLICT (admin_profile_id) DO UPDATE SET generation=admin_credential_deliveries.generation+1,
           status='PENDING', attempts=admin_credential_deliveries.attempts+1, last_attempt_at=now(),
           last_error_code=NULL, updated_at=now() RETURNING generation`, [profileId],
      )
      return { ...row, generation: delivery.generation }
    })
    try {
      await this.options.email.sendCredential(admin.email, admin.name, temporaryPassword, 'administrator')
    } catch {
      await this.db.transaction(async tx => {
        await tx.query("UPDATE admin_credential_deliveries SET status='FAILED', last_error_code='EMAIL_PROVIDER_ERROR', updated_at=now() WHERE admin_profile_id=$1 AND generation=$2", [profileId, admin.generation])
        await recordAudit(tx, { actorId: actor.user.id, action: 'ADMIN_CREDENTIAL_DELIVERY_FAILED', resourceType: 'admin_profile', resourceId: profileId, metadata: { errorCode: 'EMAIL_PROVIDER_ERROR' } })
      })
      throw new AppError(502, 'Administrator account is retained, but credential email failed. Generate a new credential to retry.')
    }
    const { rows: sent } = await this.db.transaction(async tx => {
      const result = await tx.query(
        `UPDATE admin_credential_deliveries SET status='SENT', last_sent_at=now(), updated_at=now()
         WHERE admin_profile_id=$1 AND generation=$2 AND status='PENDING' RETURNING admin_profile_id`, [profileId, admin.generation],
      )
      if (result.rows.length) await tx.query("UPDATE users SET status='ACTIVE', updated_at=now() WHERE id=$1", [admin.user_id])
      await recordAudit(tx, { actorId: actor.user.id, action: 'ADMIN_CREDENTIAL_DELIVERY_SENT', resourceType: 'admin_profile', resourceId: profileId, metadata: { sent: result.rows.length > 0 } })
      return result
    })
    ensure(sent.length, 409, 'A newer credential request replaced this delivery. Issue credentials again if needed.')
    return { ok: true as const, credential_status: 'SENT', email: admin.email }
  }

  async deleteAdmin(actor: AuthContext, profileId: string) {
    ensure(actor.principal.type === 'SUPER_ADMIN', 403, 'Only super admins can remove administrators')
    ensure(actor.principal.profileId !== profileId, 400, 'Cannot remove your own administrator profile')

    const removed = await deleteAdminProfile(this.db, profileId)
    ensure(removed, 404, 'Admin profile not found')

    await recordAudit(this.db, {
      actorId: actor.user.id,
      action: 'ADMIN_DELETED',
      resourceType: 'admin_profile',
      resourceId: profileId,
    })

    return { ok: true as const }
  }
}
