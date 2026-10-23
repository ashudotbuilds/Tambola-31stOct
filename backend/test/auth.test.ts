import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createApplication } from '../src/app'
import { testDatabase } from './helpers'
import type { Database } from '../src/db/database'
import { runMigrations } from '../src/db/migrations'
import { createServer, type Server } from 'node:http'

let db: Database
let application: ReturnType<typeof createApplication>
let base: string
let mailServer: Server
let mailUrl: string
let capturedEmail: { to: string; text: string } | null = null
const bootstrapSecret = 'test-secret-at-least-32-chars-long-bootstrap'
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url))

before(async () => {
  db = await testDatabase()
  await runMigrations(db, migrationDir)
  mailServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    capturedEmail = JSON.parse(Buffer.concat(chunks).toString()) as { to: string; text: string }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>(resolve => mailServer.listen(0, '127.0.0.1', resolve))
  const mailAddress = mailServer.address()
  assert.ok(mailAddress && typeof mailAddress !== 'string')
  mailUrl = `http://127.0.0.1:${mailAddress.port}`
  application = createApplication(db, {
    origins: ['http://localhost:5173'],
    bootstrapSecret,
    email: { url: mailUrl, apiKey: 'test-email-key', from: 'noreply@test.local' },
  })
  await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve))
  const address = application.server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (application) await new Promise<void>(resolve => application.io.close(() => resolve()))
  if (mailServer) await new Promise<void>(resolve => mailServer.close(() => resolve()))
  await db?.close()
})

interface ApiResponse<T = unknown> {
  status: number
  headers: Headers
  body: T
}

async function request<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string
    body?: unknown
    token?: string
    cookie?: string
    headers?: Record<string, string>
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    ...options.headers,
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }
  if (options.cookie) {
    headers['Cookie'] = options.cookie
  }

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  let body: T
  const text = await response.text()
  try {
    body = JSON.parse(text) as T
  } catch {
    body = text as unknown as T
  }

  return { status: response.status, headers: response.headers, body }
}

test('Auth: Super Admin bootstrap lifecycle and protection', async () => {
  // 1. Missing bootstrap secret -> 401
  const missingSecret = await request('/api/v1/auth/bootstrap-super-admin', {
    method: 'POST',
    body: {
      email: 'admin@tambola.com',
      name: 'Super Admin',
      password: 'SecurePassword123!',
    },
  })
  assert.equal(missingSecret.status, 401)

  // 2. Wrong bootstrap secret -> 401
  const wrongSecret = await request('/api/v1/auth/bootstrap-super-admin', {
    method: 'POST',
    headers: { 'x-bootstrap-secret': 'short-or-wrong-secret' },
    body: {
      email: 'admin@tambola.com',
      name: 'Super Admin',
      password: 'SecurePassword123!',
    },
  })
  assert.equal(wrongSecret.status, 401)

  // 3. Valid bootstrap -> 201 Created
  const bootstrapSuccess = await request<{
    ok: boolean
    user: { id: string; email: string; name: string }
    role: string
  }>('/api/v1/auth/bootstrap-super-admin', {
    method: 'POST',
    headers: { 'x-bootstrap-secret': bootstrapSecret },
    body: {
      email: 'super@tambola.com',
      name: 'Root Admin',
      password: 'RootPassword123!',
    },
  })
  assert.equal(bootstrapSuccess.status, 201)
  assert.equal(bootstrapSuccess.body.ok, true)
  assert.equal(bootstrapSuccess.body.user.email, 'super@tambola.com')
  assert.equal(bootstrapSuccess.body.role, 'SUPER_ADMIN')

  // Verify Argon2id password hash was stored in DB
  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE email = $1',
    ['super@tambola.com'],
  )
  assert.ok(rows[0].password_hash.startsWith('$argon2id$'))

  // 4. Repeated bootstrap attempt -> 409 Conflict (permanently closed)
  const repeatedBootstrap = await request('/api/v1/auth/bootstrap-super-admin', {
    method: 'POST',
    headers: { 'x-bootstrap-secret': bootstrapSecret },
    body: {
      email: 'another@tambola.com',
      name: 'Another Root',
      password: 'AnotherPassword123!',
    },
  })
  assert.equal(repeatedBootstrap.status, 409)
})

test('Auth: Login, cookie issuance, /me context, and logout invalidation', async () => {
  // 1. Invalid password -> 401
  const badPassword = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'super@tambola.com', password: 'WrongPassword!' },
  })
  assert.equal(badPassword.status, 401)

  // 2. Unknown user -> 401
  const unknownUser = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'nonexistent@tambola.com', password: 'Password123!' },
  })
  assert.equal(unknownUser.status, 401)

  // 3. Successful login -> 200, HttpOnly cookie, no JavaScript-visible token
  const login = await request<{
    ok: boolean
    token?: string
    user: { id: string; email: string; name: string }
    principal: { type: string; role: string; profileId: string }
  }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'super@tambola.com', password: 'RootPassword123!' },
  })
  assert.equal(login.status, 200)
  assert.equal(login.body.ok, true)
  assert.equal(login.body.token, undefined)
  assert.equal(login.body.principal.type, 'SUPER_ADMIN')

  const setCookie = login.headers.get('set-cookie')
  assert.ok(setCookie && setCookie.includes('tt_session='))
  assert.ok(setCookie.includes('HttpOnly'))

  const cookie = setCookie!.split(';')[0]

  // 4. Call /me with the HttpOnly session cookie
  const meWithBearer = await request<{
    ok: boolean
    user: { id: string; email: string }
    principal: { type: string }
  }>('/api/v1/auth/me', { cookie })
  assert.equal(meWithBearer.status, 200)
  assert.equal(meWithBearer.body.ok, true)
  assert.equal(meWithBearer.body.user.email, 'super@tambola.com')
  assert.equal(meWithBearer.body.principal.type, 'SUPER_ADMIN')

  // 5. Logout with the cookie revokes the session
  const logout = await request('/api/v1/auth/logout', { method: 'POST', cookie, headers: { Origin: 'http://localhost:5173' } })
  assert.equal(logout.status, 200)

  // 6. Revoked cookie can no longer authenticate
  const meAfterLogout = await request<{ ok: boolean }>(
    '/api/v1/auth/me',
    { cookie },
  )
  assert.equal(meAfterLogout.status, 401)
})

test('Auth: Role-based authorization and Admin management', async () => {
  // Login as Super Admin
  const superLogin = await request<{ token?: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'super@tambola.com', password: 'RootPassword123!' },
  })
  assert.equal(superLogin.status, 200)
  const superCookie = superLogin.headers.get('set-cookie')!.split(';')[0]

  // 1. Super Admin creates an Admin
  const createAdmin = await request<{
    ok: boolean
    user: { id: string; email: string }
    role: string
  }>('/api/v1/super-admin/admins', {
    method: 'POST',
    cookie: superCookie,
    headers: { Origin: 'http://localhost:5173' },
    body: {
      email: 'host1@tambola.com',
      name: 'Event Host 1',
      role: 'ADMIN',
    },
  })
  assert.equal(createAdmin.status, 201)
  assert.equal(createAdmin.body.role, 'ADMIN')
  assert.equal(capturedEmail?.to, 'host1@tambola.com')
  assert.match(capturedEmail?.text ?? '', /Temporary password:/)
  const temporaryPassword = capturedEmail!.text.match(/Temporary password: ([^\n]+)/)?.[1]
  assert.ok(temporaryPassword)

  // 2. Normal Admin logs in
  const adminLogin = await request<{
    token?: string
    principal: { type: string; role: string }
  }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'host1@tambola.com', password: 'HostPassword123!' },
  })
  assert.equal(adminLogin.status, 401)
  const deliveredLogin = await request<{ token?: string; principal: { type: string; role: string } }>('/api/v1/auth/login', {
    method: 'POST', body: { email: 'host1@tambola.com', password: temporaryPassword },
  })
  assert.equal(deliveredLogin.status, 200)
  assert.equal(deliveredLogin.body.principal.type, 'ADMIN')
  const adminCookie = deliveredLogin.headers.get('set-cookie')!.split(';')[0]

  // 3. Normal Admin cannot access Super Admin endpoint -> 403 Forbidden
  const adminAccessSuper = await request('/api/v1/super-admin/admins', {
    cookie: adminCookie,
  })
  assert.equal(adminAccessSuper.status, 403)

  // 4. Anonymous cannot access Super Admin endpoint -> 401 Unauthorized
  const anonAccessSuper = await request('/api/v1/super-admin/admins')
  assert.equal(anonAccessSuper.status, 401)

  // 5. Super Admin lists admins
  const list = await request<{
    ok: boolean
    admins: Array<{ id: string; email: string; role: string }>
  }>('/api/v1/super-admin/admins', { cookie: superCookie })
  assert.equal(list.status, 200)
  assert.ok(list.body.admins.some(a => a.email === 'host1@tambola.com'))

  // 6. Super Admin deletes the created admin
  const targetAdmin = list.body.admins.find(a => a.email === 'host1@tambola.com')!
  const deleteAdmin = await request(`/api/v1/super-admin/admins/${targetAdmin.id}`, {
    method: 'DELETE',
    cookie: superCookie,
    headers: { Origin: 'http://localhost:5173' },
  })
  assert.equal(deleteAdmin.status, 200)

  // 7. Deleted admin can no longer log in or access session
  const deletedLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'host1@tambola.com', password: 'HostPassword123!' },
  })
  assert.equal(deletedLogin.status, 401)
})

test('Profile: stable login ID, password confirmation, email change and session revocation', async () => {
  await db.query("UPDATE users SET login_id='root-id' WHERE email='super@tambola.com'")
  const login = await request('/api/v1/auth/login',{method:'POST',body:{email:'root-id',password:'RootPassword123!'}})
  assert.equal(login.status,200)
  const cookie=login.headers.get('set-cookie')!.split(';')[0]
  const second=await request('/api/v1/auth/login',{method:'POST',body:{email:'root-id',password:'RootPassword123!'}})
  const secondCookie=second.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await request('/api/v1/auth/profile',{method:'PATCH',cookie,headers:{Origin:'http://localhost:5173'},body:{name:'Updated Root',email:'newroot@tambola.com',currentPassword:'wrong'}})).status,401)
  assert.equal((await request('/api/v1/auth/profile',{method:'PATCH',cookie,headers:{Origin:'http://localhost:5173'},body:{name:'Updated Root',email:'newroot@tambola.com',currentPassword:'RootPassword123!',password:'NewPassword123!'}})).status,200)
  assert.equal((await request('/api/v1/auth/me',{cookie:secondCookie})).status,401)
  assert.equal((await request('/api/v1/auth/me',{cookie})).status,200)
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:{email:'root-id',password:'NewPassword123!'}})).status,200)
})
