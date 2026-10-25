// Reproduce the root Heroku build in a disposable copy with no environment files.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const workspace = await mkdtemp(join(tmpdir(), 'tambola-heroku-'))
const npm = process.env.npm_execpath
assert.ok(npm, 'Run this check with npm run check:heroku')
let passed = false
async function run(args) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [npm, ...args], {
      cwd: workspace, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
    })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? accept() : reject(new Error(`npm ${args.join(' ')} exited ${code}`)))
  })
}
try {
  for (const path of ['package.json', 'package-lock.json', 'Procfile', 'app.json',
    'scripts/sync-shared.mjs', 'backend/package.json', 'backend/package-lock.json',
    'backend/tsconfig.json', 'backend/tsup.config.ts', 'backend/scripts/upload-sourcemaps.mjs',
    'backend/src', 'backend/migrations', 'frontend/src/shared']) {
    const destination = join(workspace, path)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(root, path), destination, { recursive: true })
  }
  assert.equal(await stat(join(workspace, 'backend/.env')).then(() => true, () => false), false)
  await run(['ci', '--include=dev'])
  await run(['run', 'heroku-postbuild'])
  for (const tool of ['typescript', 'tsx', 'tsup']) {
    assert.equal(await stat(join(workspace, 'backend/node_modules', tool)).then(() => true, () => false), false, `${tool} must be pruned`)
  }
  assert.equal(await stat(join(workspace, 'frontend/node_modules')).then(() => true, () => false), false, 'Heroku should not install the frontend')
  const manifest = JSON.parse(await readFile(join(workspace, 'app.json'), 'utf8'))
  assert.equal(manifest.formation.web.quantity, 1)
  assert.equal(manifest.buildpacks[0].url, 'heroku/nodejs')
  const procfile = await readFile(join(workspace, 'Procfile'), 'utf8')
  assert.match(procfile, /release: node backend\/dist\/migrate\.js/)
  assert.match(procfile, /web: node backend\/dist\/index\.js/)
  const require = createRequire(new URL('../backend/package.json', import.meta.url))
  const { tsImport } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href)
  const { testDatabase } = await tsImport('../backend/test/helpers.ts', import.meta.url)
  const { runMigrations } = await tsImport('../backend/src/db/migrations.ts', import.meta.url)
  const { createApplication } = await import(pathToFileURL(join(workspace, 'backend/dist/app.js')).href)
  const db = await testDatabase()
  let application
  try {
    await runMigrations(db, join(workspace, 'backend/migrations'))
    const origin = 'http://localhost:5173'
    const secret = 'heroku-packaging-smoke-bootstrap-secret'
    application = createApplication(db, { origins: [origin], bootstrapSecret: secret, trustProxyHops: 1 })
    await new Promise(accept => application.server.listen(0, '127.0.0.1', accept))
    const address = application.server.address()
    const base = `http://127.0.0.1:${address.port}`
    for (const path of ['/health', '/ready']) {
      const response = await fetch(base + path)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
    }
    const credentials = { email: 'heroku-smoke@example.test', name: 'Smoke Host', password: 'SmokePassword123!' }
    const bootstrap = await fetch(base + '/api/v1/auth/bootstrap-super-admin', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-bootstrap-secret': secret },
      body: JSON.stringify(credentials),
    })
    assert.equal(bootstrap.status, 201)
    const login = await fetch(base + '/api/v1/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const created = await fetch(base + '/api/games', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: credentials.name }),
    })
    assert.equal(created.status, 201)
    const socket = await fetch(base + '/socket.io/?EIO=4&transport=polling')
    assert.equal(socket.status, 200)
    assert.match(await socket.text(), /^0\{/)
  } finally {
    if (application) await new Promise(accept => application.io.close(accept))
    await db.close()
  }
  passed = true
  console.log('Heroku build verified: production-only dependencies, compiled API, migrations, readiness, login, game creation, Socket.IO polling. No cloud database used.')
} finally {
  if (passed && dirname(resolve(workspace)) === resolve(tmpdir()) && basename(workspace).startsWith('tambola-heroku-')) {
    try { await rm(workspace, { recursive: true, force: true }) }
    catch (error) {
      // Windows locks a loaded .node DLL until this process exits. The checks
      // have passed; cleanup must not turn that OS restriction into a build failure.
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code)) throw error
      console.log(`Windows retained an in-use native module in temporary check directory: ${workspace}`)
    }
  } else console.log(`Build-check files retained at ${workspace}`)
}
