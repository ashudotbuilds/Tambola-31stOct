import { randomBytes } from 'node:crypto'
import type { Database, SqlClient } from '../../db/database'
import { AppError, ensure } from '../../errors'
import type { AuthContext } from '../auth/models'
import { createUser, findUserByEmail, recordAudit } from '../auth/repository'
import { hashPassword } from '../auth/password'
import { participantRow } from './validation'
import { runIdempotently } from '../idempotency/service'
import { EmailAdapter } from '../email/adapter'

// Historical participant profiles require a container FK. It is internal only.
const DIRECTORY_ID = '00000000-0000-4000-8000-000000000001'

async function insertParticipant(client: SqlClient, eventId: string, row: { name: string; email: string; external_id?: string }) {
  const existing = await findUserByEmail(client, row.email)
  let userId: string
  if (existing) {
    const { rows: profiles } = await client.query<{ id: string; event_id: string }>(
      `SELECT pp.id, pp.event_id FROM participant_profiles pp
       WHERE pp.user_id = $1 ORDER BY pp.created_at DESC LIMIT 1`, [existing.id],
    )
    if (profiles.length) return 'skipped' as const
    throw new AppError(409, 'Email already belongs to an account')
  } else {
    const inactivePassword = randomBytes(48).toString('base64url')
    const passwordHash = await hashPassword(inactivePassword)
    const user = await createUser(client, row.email, passwordHash, row.name, 'INACTIVE')
    userId = user.id
  }

  await client.query(
    `INSERT INTO participant_profiles(user_id, event_id, external_id)
     VALUES ($1,$2,$3)`,
    [userId, eventId, row.external_id?.trim() || null],
  )
  return 'created' as const
}

export class ParticipantService {
  constructor(readonly db: Database, readonly email: EmailAdapter) {}

  async listParticipants() {
    const { rows } = await this.db.query(
      `SELECT pp.id AS profile_id, u.name, u.email, u.status AS account_status, pp.external_id,
              coalesce(cd.status, 'NOT_ISSUED') AS credential_status, cd.last_sent_at, cd.attempts
       FROM participant_profiles pp JOIN users u ON u.id=pp.user_id
       LEFT JOIN participant_credential_deliveries cd ON cd.participant_profile_id=pp.id
       ORDER BY lower(u.name), pp.id`,
    )
    return { ok: true as const, participants: rows }
  }

  async issueParticipantCredential(actor: AuthContext, profileId: string) {
    if (!this.email.configured) throw new AppError(503, 'Credential email is not configured')
    const temporaryPassword = randomBytes(24).toString('base64url')
    const passwordHash = await hashPassword(temporaryPassword)
    const issued = await this.db.transaction(async tx => {
      const { rows: [participant] } = await tx.query<{
        profile_id: string; user_id: string; name: string; email: string; credential_status: string | null; credential_updated_at: Date | null
      }>(
        `SELECT pp.id AS profile_id, pp.user_id, u.name, u.email, cd.status AS credential_status, cd.updated_at AS credential_updated_at
         FROM participant_profiles pp JOIN users u ON u.id=pp.user_id
         LEFT JOIN participant_credential_deliveries cd ON cd.participant_profile_id=pp.id
         WHERE pp.id=$1 FOR UPDATE OF pp,u`, [profileId],
      )
      ensure(participant, 404, 'Participant not found')
      ensure(!(participant.credential_status === 'PENDING' && participant.credential_updated_at && Date.now() - new Date(participant.credential_updated_at).getTime() < 60_000), 409, 'Credential delivery is already in progress; try again shortly')
      await tx.query("UPDATE users SET password_hash=$2, status='INACTIVE', updated_at=now() WHERE id=$1", [participant.user_id, passwordHash])
      await tx.query('UPDATE sessions SET revoked_at=now() WHERE profile_id=$1 AND revoked_at IS NULL', [profileId])
      const { rows: [delivery] } = await tx.query<{ generation: number }>(
        `INSERT INTO participant_credential_deliveries(participant_profile_id, generation, status, attempts, last_attempt_at)
         VALUES ($1,1,'PENDING',1,now())
         ON CONFLICT (participant_profile_id) DO UPDATE SET
           generation=participant_credential_deliveries.generation+1, status='PENDING',
           attempts=participant_credential_deliveries.attempts+1, last_attempt_at=now(),
           last_error_code=NULL, updated_at=now()
         RETURNING generation`, [profileId],
      )
      await recordAudit(tx, { actorId: actor.user.id, action: 'PARTICIPANT_CREDENTIAL_ISSUED', resourceType: 'participant_profile', resourceId: profileId, metadata: { status: 'PENDING' } })
      return { ...participant, generation: delivery.generation }
    })

    try {
      await this.email.sendCredential(issued.email, issued.name, temporaryPassword)
    } catch {
      await this.db.transaction(async tx => {
        await tx.query(
          `UPDATE participant_credential_deliveries SET status='FAILED', last_error_code='EMAIL_PROVIDER_ERROR', updated_at=now()
           WHERE participant_profile_id=$1 AND generation=$2`, [profileId, issued.generation],
        )
        await recordAudit(tx, { actorId: actor.user.id, action: 'PARTICIPANT_CREDENTIAL_DELIVERY_FAILED', resourceType: 'participant_profile', resourceId: profileId, metadata: { errorCode: 'EMAIL_PROVIDER_ERROR' } })
      })
      throw new AppError(502, 'Account is retained, but credential email failed. Generate a new credential to retry.')
    }

    const { rows: activated } = await this.db.transaction(async tx => {
      const result = await tx.query<{ participant_profile_id: string }>(
        `UPDATE participant_credential_deliveries SET status='SENT', last_sent_at=now(), updated_at=now()
         WHERE participant_profile_id=$1 AND generation=$2 AND status='PENDING' RETURNING participant_profile_id`, [profileId, issued.generation],
      )
      if (result.rows.length) await tx.query("UPDATE users SET status='ACTIVE', updated_at=now() WHERE id=$1", [issued.user_id])
      await recordAudit(tx, { actorId: actor.user.id, action: 'PARTICIPANT_CREDENTIAL_DELIVERY_SENT', resourceType: 'participant_profile', resourceId: profileId, metadata: { sent: result.rows.length > 0 } })
      return result
    })
    ensure(activated.length, 409, 'A newer credential request replaced this delivery. Issue credentials again if needed.')
    return { ok: true as const, credential_status: 'SENT', email: issued.email }
  }

  async importParticipants(actor: AuthContext, rawRows: unknown[], idempotencyKey: string) {
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: 'participants.import', key: idempotencyKey, payload: { rows: rawRows }, work: async tx => {
    const eventId = DIRECTORY_ID
    await tx.query('INSERT INTO events(id,name) VALUES ($1,$2) ON CONFLICT(id) DO NOTHING', [DIRECTORY_ID, 'Participant directory'])
    const result = { ok: true as const, created: 0, skipped: 0, failed: 0, rows: [] as Array<{ row: number; status: string; message?: string }> }

    for (let index = 0; index < rawRows.length; index++) {
      const parsed = participantRow.safeParse(rawRows[index])
      if (!parsed.success) {
        result.failed++
        result.rows.push({ row: index + 2, status: 'failed', message: parsed.error.issues.map(issue => issue.message).join('; ') })
        continue
      }
      const savepoint = `participant_import_${index}`
      await tx.query(`SAVEPOINT ${savepoint}`)
      try {
        const outcome = await insertParticipant(tx, eventId, parsed.data)
        await tx.query(`RELEASE SAVEPOINT ${savepoint}`)
        result[outcome]++
        result.rows.push({ row: index + 2, status: outcome })
      } catch (error) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        await tx.query(`RELEASE SAVEPOINT ${savepoint}`)
        result.failed++
        result.rows.push({ row: index + 2, status: 'failed', message: error instanceof AppError ? error.message : 'Could not import this participant' })
      }
    }

    await recordAudit(tx, {
      actorId: actor.user.id,
      action: 'PARTICIPANTS_IMPORTED',
      resourceType: 'participant_directory',
      metadata: { inputCount: rawRows.length, created: result.created, skipped: result.skipped, failed: result.failed },
    })
    return result
    } })
  }
}
