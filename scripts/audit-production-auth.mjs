import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ashut/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const dist = resolve('frontend/dist')
const origin = 'http://localhost:5174'
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
// Emulate the deployment's external rewrites against the isolated local demo.
const server = createServer(async (req, res) => {
  if (/^\/(api|socket\.io)(\/|\?)/.test(req.url)) {
    const upstream = request('http://127.0.0.1:3001' + req.url, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:3001' } }, response => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => res.writeHead(502).end())
    req.pipe(upstream)
    res.on('close', () => upstream.destroy())
    return
  }
  const path = resolve(dist, '.' + new URL(req.url, origin).pathname)
  if (path !== dist && !path.startsWith(dist + sep)) { res.writeHead(403).end(); return }
  try { res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)) }
  catch { res.setHeader('Content-Type', 'text/html'); res.end(await readFile(resolve(dist, 'index.html'))) }
})
await new Promise(resolve => server.listen(5174, '127.0.0.1', resolve))
const browser = await chromium.launch({ args: ['--test-third-party-cookie-phaseout'] })
const errors = []
async function login(label, path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp('^' + label + ' ') }).click()
  await page.waitForURL('**' + path)
  await page.getByRole('heading', { level: 1 }).waitFor()
  const cookies = await context.cookies()
  assert.ok(cookies.some(cookie => cookie.name === 'tt_session' && cookie.httpOnly && cookie.domain === 'localhost'))
  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  assert.ok(page.url().endsWith(path))
  return { page, context }
}
try {
  const root = await login('Super Admin', '/super-admin')
  const admin = await login('Admin 1', '/admin')
  const member = await login('Member 1', '/account')
  await root.page.waitForResponse(response => response.url().includes('/socket.io/') && response.status() === 200)
  const create = await admin.context.request.post(origin + '/api/games', { headers: { Origin: origin }, data: { hostName: 'Admin 1' } })
  assert.equal(create.status(), 201)
  const game = await create.json()
  const row = root.page.locator('#games > div').filter({ has: root.page.getByText(game.code, { exact: true }) })
  await row.getByText('lobby', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal((await member.context.request.post(origin + '/api/games/join', { headers: { Origin: origin }, data: { code: game.code, name: 'Member 1' } })).status(), 201)
  assert.equal((await admin.context.request.post(origin + `/api/games/${game.game_id}/start`, { headers: { Origin: origin, Authorization: `Bearer ${game.host_token}` }, data: {} })).status(), 200)
  await row.getByText('playing', { exact: true }).waitFor({ timeout: 5000 })
  await member.page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await member.page.waitForURL('**/login')
  assert.ok(!(await member.context.cookies()).some(cookie => cookie.name === 'tt_session'))
  assert.deepEqual(errors, [])
  console.log('Production build: 3 role logins, persistent reloads, same-origin HttpOnly cookies, live polling updates and logout passed; third-party cookie phaseout enabled.')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
