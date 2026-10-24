/** Explicit local demo only: isolated database, no cloud connections or email. */
import { fileURLToPath } from 'node:url'
import { testDatabase } from './helpers'
import { runMigrations } from '../src/db/migrations'
import { createApplication } from '../src/app'
import { createUser, createAdminProfile } from '../src/modules/auth/repository'
import { hashPassword } from '../src/modules/auth/password'

if (process.env.NODE_ENV === 'production')
  throw new Error('Demo mode is unavailable in production')
const db = await testDatabase()
await runMigrations(
  db,
  fileURLToPath(new URL('../migrations/', import.meta.url)),
)
const {
  rows: [event],
} = await db.query<{ id: string }>(
  "INSERT INTO events(name) VALUES ('Participant directory') RETURNING id",
)
const accounts = []
const passwordHash = await hashPassword('DemoPass123!')
for (const [role, count, prefix] of [
  ['SUPER_ADMIN', 1, 'superadmin'],
  ['ADMIN', 3, 'admin'],
  ['PARTICIPANT', 20, 'user'],
] as const) {
  for (let i = 1; i <= count; i++) {
    const id = prefix === 'superadmin' ? prefix : `${prefix}${i}`
    const name =
      prefix === 'superadmin'
        ? 'Super Admin'
        : `${prefix === 'admin' ? 'Admin' : 'Member'} ${i}`
    const email = `${id}@demo.local`
    const user = await createUser(db, email, passwordHash, name)
    await db.query('UPDATE users SET login_id=$2 WHERE id=$1', [user.id, id])
    if (role === 'PARTICIPANT')
      await db.query(
        'INSERT INTO participant_profiles(user_id,event_id) VALUES ($1,$2)',
        [user.id, event.id],
      )
    else await createAdminProfile(db, user.id, role)
    accounts.push({ id, name, email, role })
  }
}
const application = createApplication(db, {
  origins: [5173, 5174, 5175].flatMap((port) => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]),
  demoAccounts: accounts,
})
application.server.listen(3001, '127.0.0.1', () =>
  console.log(
    'Local demo API ready on http://127.0.0.1:3001 (data resets on restart)',
  ),
)
process.on('SIGINT', () =>
  application.io.close(() => {
    void db.close()
  }),
)
