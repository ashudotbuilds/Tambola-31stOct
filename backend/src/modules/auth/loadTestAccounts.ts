import { randomBytes } from 'node:crypto'
import type { Database, SqlClient } from '../../db/database'
import { AppError } from '../../errors'
import { hashPassword } from './password'
import { createUser, findUserByEmail, recordAudit } from './repository'

export const LOAD_TEST_ACCOUNT_COUNT = 500
const LOAD_TEST_ACCOUNT_IDS = Array.from({ length: LOAD_TEST_ACCOUNT_COUNT }, (_, index) =>
  `tt-load-user${String(index + 1).padStart(4, '0')}`)
const DIRECTORY_ID = '00000000-0000-4000-8000-000000000001'

export interface LoadTestAccountSetup {
  count: number
  loginIdPrefix: string
  firstLoginId: string
  lastLoginId: string
  password: string
}

async function lockLoadTestAccounts(tx: SqlClient) {
  await tx.query('SELECT pg_advisory_xact_lock(981273920)')
  await tx.query("INSERT INTO events(id,name) VALUES ($1,'Participant directory') ON CONFLICT (id) DO NOTHING", [DIRECTORY_ID])
}

/** Create or rotate only the reserved load-test identities. The shared password is returned once. */
export async function provisionLoadTestAccounts(db: Database, actorId: string): Promise<LoadTestAccountSetup> {
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await hashPassword(password)
  await db.transaction(async tx => {
    await lockLoadTestAccounts(tx)
    for (const [index, loginId] of LOAD_TEST_ACCOUNT_IDS.entries()) {
      const email = `${loginId}@loadtest.tambola.invalid`
      const existing = await findUserByEmail(tx, email)
      if (existing) {
        const { rows: [reserved] } = await tx.query<{ login_id: string | null; email: string }>(
          'SELECT login_id,email FROM users WHERE id=$1 FOR UPDATE', [existing.id])
        if (reserved?.login_id !== loginId || reserved.email.toLowerCase() !== email.toLowerCase()) {
          throw new AppError(409, 'Load-test account namespace is already in use')
        }
        await tx.query("UPDATE users SET password_hash=$2,status='ACTIVE',updated_at=now() WHERE id=$1", [existing.id, passwordHash])
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [existing.id])
      } else {
        const user = await createUser(tx, email, passwordHash, `Load Test ${String(index + 1).padStart(3, '0')}`)
        await tx.query('UPDATE users SET login_id=$2 WHERE id=$1', [user.id, loginId])
        await tx.query('INSERT INTO participant_profiles(user_id,event_id,external_id) VALUES ($1,$2,$3)', [user.id, DIRECTORY_ID, loginId])
      }
    }
    await recordAudit(tx, { actorId, action: 'LOAD_TEST_ACCOUNTS_PROVISIONED', resourceType: 'system', metadata: { count: LOAD_TEST_ACCOUNT_COUNT } })
  })
  return { count: LOAD_TEST_ACCOUNT_COUNT, loginIdPrefix: 'tt-load-user', firstLoginId: LOAD_TEST_ACCOUNT_IDS[0], lastLoginId: LOAD_TEST_ACCOUNT_IDS.at(-1)!, password }
}

/** Suspend and revoke sessions for the reserved load-test identities, preserving game and audit history. */
export async function disableLoadTestAccounts(db: Database, actorId: string): Promise<{ disabled: number }> {
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(981273920)')
    const { rows } = await tx.query<{ id: string }>(
      "UPDATE users SET status='SUSPENDED',updated_at=now() WHERE login_id=ANY($1::text[]) AND email=ANY($2::text[]) AND status<>'SUSPENDED' RETURNING id",
      [LOAD_TEST_ACCOUNT_IDS, LOAD_TEST_ACCOUNT_IDS.map(id => `${id}@loadtest.tambola.invalid`)])
    if (rows.length) {
      await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL', [rows.map(user => user.id)])
    }
    await recordAudit(tx, { actorId, action: 'LOAD_TEST_ACCOUNTS_DISABLED', resourceType: 'system', metadata: { count: rows.length } })
    return { disabled: rows.length }
  })
}
