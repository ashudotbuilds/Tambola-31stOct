import type { Database } from '../../db/database'
import { hashPassword } from './password'
import { createAdminProfile, createUser, findUserByEmail, recordAudit } from './repository'

export interface TestingAccount { id: string; name: string; email: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'PARTICIPANT' }
export const TESTING_ACCOUNTS: TestingAccount[] = [
  { id: 'tt-test-superadmin', name: 'Super Admin', email: 'superadmin@testing.tambola.invalid', role: 'SUPER_ADMIN' },
  ...Array.from({ length: 3 }, (_, i) => ({ id: `tt-test-admin${i + 1}`, name: `Admin ${i + 1}`, email: `admin${i + 1}@testing.tambola.invalid`, role: 'ADMIN' as const })),
  ...Array.from({ length: 50 }, (_, i) => ({ id: `tt-test-user${i + 1}`, name: `Member ${i + 1}`, email: `user${i + 1}@testing.tambola.invalid`, role: 'PARTICIPANT' as const })),
]

// Temporary public testing accounts use normal password hashing and sessions.
// Reserved IDs keep real accounts separate and preserve identity on redeploy.
export async function configureTestingAccounts(db: Database, enabled: boolean): Promise<TestingAccount[] | undefined> {
  const passwordHash = enabled ? await hashPassword('DemoPass123!') : undefined
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(981273919)')
    if (!enabled) {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE users SET status='SUSPENDED',updated_at=now()
         WHERE email=ANY($1::text[]) AND login_id=ANY($2::text[]) AND status<>'SUSPENDED' RETURNING id`,
        [TESTING_ACCOUNTS.map(account => account.email), TESTING_ACCOUNTS.map(account => account.id)],
      )
      if (rows.length) {
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL', [rows.map(user => user.id)])
        await recordAudit(tx, { action: 'TEST_ACCOUNTS_DISABLED', resourceType: 'system', metadata: { count: rows.length } })
      }
      return undefined
    }
    const directoryId = '00000000-0000-4000-8000-000000000001'
    await tx.query("INSERT INTO events(id,name) VALUES ($1,'Participant directory') ON CONFLICT (id) DO NOTHING", [directoryId])
    for (const account of TESTING_ACCOUNTS) {
      const existing = await findUserByEmail(tx, account.email)
      if (existing) {
        const { rows } = await tx.query<{ login_id: string }>('SELECT login_id FROM users WHERE id=$1', [existing.id])
        if (rows[0]?.login_id !== account.id) throw new Error('Testing account namespace is already in use')
        await tx.query("UPDATE users SET status='ACTIVE',updated_at=now() WHERE id=$1 AND status='SUSPENDED'", [existing.id])
        continue
      }
      const user = await createUser(tx, account.email, passwordHash!, account.name)
      await tx.query('UPDATE users SET login_id=$2 WHERE id=$1', [user.id, account.id])
      if (account.role === 'PARTICIPANT') {
        await tx.query('INSERT INTO participant_profiles(user_id,event_id) VALUES ($1,$2)', [user.id, directoryId])
      } else await createAdminProfile(tx, user.id, account.role)
      await recordAudit(tx, { action: 'TEST_ACCOUNT_CREATED', resourceType: 'user', resourceId: user.id, metadata: { role: account.role } })
    }
    return TESTING_ACCOUNTS
  })
}
