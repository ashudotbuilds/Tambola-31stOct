import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const web = 'http://localhost:5173'
const api = 'http://localhost:3001'
const browser = await chromium.launch()
const errors = []
async function login(name, path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(web)
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  await page.waitForURL(`**${path}`)
  return { context, page }
}
const row = (page, code) => page.locator('#games > div').filter({ has: page.getByText(code, { exact: true }) })
try {
  const root = await login('Super Admin', '/super-admin')
  const owner = await login('Admin 1', '/admin')
  const observer = await login('Admin 2', '/admin')
  for (const { page } of [root, owner, observer]) {
    await page.getByRole('button', { name: 'Refresh games', exact: true }).waitFor()
    await page.getByText('Loading games…', { exact: true }).waitFor({ state: 'hidden' })
  }
  const response = owner.page.waitForResponse(r => r.url() === api + '/api/games' && r.request().method() === 'POST')
  await owner.page.getByRole('button', { name: 'Create a game', exact: true }).first().click()
  const host = await (await response).json()
  await owner.page.waitForURL('**/host')
  for (const { page } of [root, observer]) await row(page, host.code).getByText('lobby', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await row(root.page, host.code).getByRole('button', { name: 'Manage game' }).count(), 1)
  assert.equal(await row(observer.page, host.code).getByRole('button', { name: 'Manage game' }).count(), 0)
  const member = await login('Member 1', '/account')
  async function mutation(context, path, body, token, method = 'POST') {
    const result = await context.request.fetch(api + path, { method, headers: { Origin: web, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data: body })
    assert.ok(result.ok(), await result.text())
    return result.json()
  }
  await mutation(member.context, '/api/games/join', { code: host.code, name: 'Member 1' })
  await mutation(owner.context, `/api/games/${host.game_id}/start`, {}, host.host_token)
  for (const { page } of [root, observer]) await row(page, host.code).getByText('playing', { exact: true }).waitFor({ timeout: 5000 })
  await mutation(owner.context, `/api/games/${host.game_id}/status`, { status: 'paused' }, host.host_token, 'PATCH')
  for (const { page } of [root, observer]) await row(page, host.code).getByText('paused', { exact: true }).waitFor({ timeout: 5000 })
  await owner.page.goto(web + '/admin')
  await row(owner.page, host.code).getByText('paused', { exact: true }).waitFor()
  for (const { context } of [root, owner, observer]) {
    const games = await (await context.request.get(api + '/api/games')).json()
    assert.equal(games.games.find(g => g.id === host.game_id).status, 'paused')
  }
  await mkdir('artifacts/audit', { recursive: true })
  for (const [name, session] of [['root', root], ['owner', owner], ['observer', observer]]) {
    for (const width of [320, 390, 1280]) {
      await session.page.setViewportSize({ width, height: 844 })
      assert.ok(await session.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`)
      await session.page.screenshot({ path: `artifacts/audit/game-sync-${name}-${width}.png`, fullPage: true })
    }
  }
  await row(observer.page, host.code).getByRole('link', { name: 'View game' }).click()
  await observer.page.waitForURL('**/board?code=' + host.code)
  await observer.page.getByText('Game not found').waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  const report = { game: host.code, sharedAcross: ['super admin', 'admin owner', 'other admin'], liveStatuses: ['lobby', 'playing', 'paused'], widths: [320, 390, 1280], errors }
  await writeFile('artifacts/audit/game-sync-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
