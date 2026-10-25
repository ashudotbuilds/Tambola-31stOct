import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { testDatabase } from './helpers'
import { runMigrations } from '../src/db/migrations'
import { createApplication } from '../src/app'
import { configureTestingAccounts, TESTING_ACCOUNTS } from '../src/modules/auth/testingAccounts'
import { createUser, createAdminProfile } from '../src/modules/auth/repository'
import { hashPassword } from '../src/modules/auth/password'

test('production shortcuts provision real roles, survive redeployment, and disable without touching real users', async () => {
  const db = await testDatabase()
  const oldEnvironment = process.env.NODE_ENV
  let application: ReturnType<typeof createApplication> | undefined
  try {
    await runMigrations(db, fileURLToPath(new URL('../migrations/', import.meta.url)))
    const real = await createUser(db, 'real@example.test', await hashPassword('RealPassword123!'), 'Real Admin')
    await createAdminProfile(db, real.id, 'SUPER_ADMIN')
    const accounts = await configureTestingAccounts(db, true)
    assert.equal(accounts?.length, 54)
    process.env.NODE_ENV = 'production'
    application = createApplication(db, { origins: ['https://tambola.example'], demoAccounts: accounts })
    await new Promise<void>(resolve => application!.server.listen(0, '127.0.0.1', resolve))
    const address = application.server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/demo/accounts`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await response.json() as { accounts: unknown }).accounts, TESTING_ACCOUNTS)
    // A manually configured Render service can omit NODE_ENV. HTTPS browser
    // requests must still receive usable Secure cookies in that case.
    delete process.env.NODE_ENV
    const login = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://tambola.example' },
      body: JSON.stringify({ email: TESTING_ACCOUNTS[0].id, password: 'DemoPass123!' }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')!
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /; Secure/)
    assert.match(cookie, /SameSite=None/)
    const me = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/me`, { headers: { Cookie: cookie.split(';')[0] } })
    assert.equal(me.status, 200)
    process.env.NODE_ENV = 'production'
    const sessions: Awaited<ReturnType<NonNullable<typeof application>['auth']['login']>>[] = []
    for (const account of TESTING_ACCOUNTS) {
      const session: Awaited<ReturnType<NonNullable<typeof application>['auth']['login']>> = await application.auth.login(account.id, 'DemoPass123!')
      assert.equal(session.principal.type, account.role)
      sessions.push(session)
    }
    const host = await application.games.create('Super Admin', undefined, sessions[0].user.id)
    await configureTestingAccounts(db, true)
    assert.equal((await application.auth.login(TESTING_ACCOUNTS[0].id, 'DemoPass123!')).user.id, sessions[0].user.id)
    assert.equal((await application.games.state(host.game_id)).code, host.code)
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM users')).rows[0].count, 55)
    assert.equal(await configureTestingAccounts(db, false), undefined)
    for (let i = 0; i < TESTING_ACCOUNTS.length; i++) {
      await assert.rejects(application.auth.login(TESTING_ACCOUNTS[i].id, 'DemoPass123!'), /inactive|suspended/)
      await assert.rejects(application.auth.authenticate(sessions[i].token))
    }
    assert.equal((await application.auth.login(real.email, 'RealPassword123!')).principal.type, 'SUPER_ADMIN')
    assert.equal((await application.games.state(host.game_id)).code, host.code)
  } finally {
    if (oldEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = oldEnvironment
    if (application) await new Promise<void>(resolve => application!.io.close(() => resolve()))
    await db.close()
  }
})
