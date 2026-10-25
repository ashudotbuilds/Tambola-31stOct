// Run against a freshly started npm run dev:demo (restart between runs).
// Set PLAYWRIGHT_MODULE to a Playwright module path
// if it is not installed locally. Uses isolated browser contexts for each role.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = process.env.AUDIT_WEB_URL || 'http://localhost:5173'
const apiOrigin = process.env.AUDIT_API_URL || 'http://localhost:3001'
const out = process.env.AUDIT_OUTPUT || 'artifacts/audit'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
const results = []
let hostPage
async function role(id, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 640, hasTouch: width < 640 })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(`${id}: ${error.message}`))
  page.on('dialog', dialog => dialog.accept())
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(`^${id === 'superadmin' ? 'Super Admin' : id === 'admin1' ? 'Admin 1' : `Member ${id.slice(-1)}`} `) }).click()
  await page.waitForURL(id.startsWith('user') ? '**/account' : id === 'superadmin' ? '**/super-admin' : '**/admin')
  await page.getByRole('heading', { name: id.startsWith('user') ? 'Got a game code?' : id === 'superadmin' ? 'Super Admin' : 'Game control.', exact: true }).waitFor()
  return { context, page, id }
}
async function measure(actor, name) {
  const sizes = []
  for (const width of [320, 360, 390, 768, 1280]) {
    await actor.page.setViewportSize({ width, height: 844 })
    await actor.page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true })
    const size = await actor.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
    sizes.push(size)
  }
  await actor.page.setViewportSize({ width: 390, height: 844 })
  results.push({ name, sizes })
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
}
async function gameRequest(actor, host, action, method = 'GET', body, token) {
  const response = await actor.context.request.fetch(`${apiOrigin}/api/games/${host.game_id}${action}`, {
    method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data: body,
  })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
try {
  const entryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const entry = { page: await entryContext.newPage() }
  await entry.page.goto(origin)
  await entry.page.getByRole('heading', { name: 'Technical Tambola', exact: true }).waitFor()
  await entry.page.getByRole('heading', { name: 'Testing accounts', exact: true }).waitFor()
  assert.equal(await entry.page.locator('html').getAttribute('class'), 'dark')
  await entry.page.getByLabel('Password', { exact: true }).fill('visibility-check')
  await entry.page.getByRole('button', { name: 'Show password', exact: true }).click()
  assert.equal(await entry.page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text')
  await entry.page.getByRole('button', { name: 'Hide password', exact: true }).click()
  await entry.page.getByLabel('Password', { exact: true }).fill('')
  await entry.page.evaluate(() => document.fonts.ready)
  await measure(entry, 'login-dark')
  await entry.page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await entry.page.getByRole('button', { name: 'Toggle theme', exact: true }).count(), 0)
  await entry.page.emulateMedia({ reducedMotion: 'no-preference' })
  await entry.page.evaluate(() => localStorage.setItem('tt.theme', 'light'))
  await entry.page.reload()
  assert.equal(await entry.page.locator('html').getAttribute('class'), 'dark', 'Old light preferences are ignored')
  await entryContext.close()
  const root = await role('superadmin', 1280)
  const admin = await role('admin1')
  hostPage = admin.page
  const diagnostics = await root.context.request.get(`${apiOrigin}/api/v1/super-admin/system`)
  assert.equal((await diagnostics.json()).readiness, true)
  await measure(root, 'super-admin')
  await measure(admin, 'admin')
  await admin.page.getByRole('button', { name: 'Create a game', exact: true }).first().click()
  await admin.page.waitForURL('**/host')
  const host = await admin.page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.host:${localStorage.getItem('tt.account.id')}`)))
  await admin.page.getByRole('button', { name: 'Question Bank', exact: true }).click()
  await admin.page.getByRole('dialog', { name: 'Question bank', exact: true }).waitFor()
  await measure(admin, 'question-bank')
  await admin.page.keyboard.press('Tab')
  assert.equal(await admin.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true)
  await admin.page.keyboard.press('Escape')
  await admin.page.getByRole('dialog').waitFor({ state: 'hidden' })
  const players = []
  for (const id of ['user1', 'user2', 'user3']) {
    const actor = await role(id)
    if (id === 'user1') await measure(actor, 'player-home')
    await actor.page.getByLabel('Game code', { exact: true }).fill(host.code)
    await actor.page.getByRole('button', { name: 'Join game', exact: true }).click()
    await actor.page.waitForURL('**/play')
    players.push(actor)
  }
  const practice = players[0].page.getByRole('region', { name: 'Interactive ticket simulation', exact: true })
  await practice.getByRole('button', { name: 'Simulate Next Clue', exact: true }).click()
  await practice.getByRole('button', { name: 'Reveal practice answer', exact: true }).click()
  await practice.locator('button[aria-pressed]').first().click()
  assert.equal(await practice.locator('button[aria-pressed="true"]').count(), 1)
  const practiceTerms = await practice.locator('button[aria-pressed]').allTextContents()
  await measure(players[0], 'player-lobby')
  await admin.page.getByRole('button', { name: 'Start game with 3', exact: true }).click()
  await players[0].page.getByText('Waiting for the host to start the game').waitFor({ state: 'hidden' })
  await players[0].page.getByRole('region', { name: 'Claim a pattern', exact: true }).waitFor()
  assert.equal(await players[0].page.locator('button[aria-pressed="true"]').count(), 0, 'Practice marks never enter the real game')
  assert.notDeepEqual(await players[0].page.locator('button[aria-pressed]').allTextContents(), practiceTerms)
  assert.equal(await players[0].page.getByText('Standings', { exact: true }).count(), 0)
  const board = { page: await admin.context.newPage() }
  await board.page.goto(`${origin}/board?code=${host.code}`)
  for (let i = 0; i < 4; i++) {
    await admin.page.getByRole('button', { name: /Call Next Question/ }).click()
    await admin.page.getByText(`${i + 1} pending reveal`, { exact: false }).waitFor()
  }
  await admin.page.getByRole('button', { name: 'Show question 2 to players', exact: true }).click()
  await board.page.getByText('Call #2', { exact: true }).waitFor()
  for (const actor of players) {
    await actor.page.locator('section.relative').getByText('Call #2', { exact: true }).waitFor()
  }
  await players[0].page.reload()
  await players[0].page.locator('section.relative').getByText('Call #2', { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: 'Back to live', exact: true }).click()
  await board.page.getByText('Call #4', { exact: true }).waitFor()
  await players[0].page.locator('section.relative').getByText('Call #4', { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: 'Previous Question', exact: true }).click()
  await admin.page.getByText('Call #3', { exact: true }).waitFor()
  assert.equal((await gameRequest(admin, host, '', 'GET', undefined, host.player_token)).calls.length, 4)
  await admin.page.getByRole('button', { name: 'Next Question', exact: true }).click()
  await admin.page.getByText('Call #4', { exact: true }).waitFor()
  await board.page.getByText('No answers revealed yet.' , { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: /Reveal All \(4\) Pending/ }).click()
  for (const actor of players) {
    await actor.page.getByText('✓ Answer Revealed', { exact: true }).waitFor()
    const state = await actor.page.evaluate(async ({ gameId, apiOrigin }) => {
      const s = JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`))
      return (await fetch(`${apiOrigin}/api/games/${gameId}`, { credentials: 'include', headers: { Authorization: `Bearer ${s.player_token}` } })).json()
    }, { gameId: host.game_id, apiOrigin })
    assert.deepEqual(state.settings.revealed_seqs, [1, 2, 3, 4])
    assert.equal(state.me.marked.length, 0, 'Revealing must never auto-mark tickets')
    assert.equal(await actor.page.getByRole('region', { name: 'Current question batch', exact: true }).locator('li').count(), 4)
  }
  await measure(players[0], 'player-active')
  await measure(admin, 'host-active')
  await admin.page.getByRole('button', { name: 'Pause', exact: true }).click()
  await admin.page.getByRole('button', { name: 'Resume', exact: true }).click()
  await admin.page.getByRole('button', { name: 'Resume', exact: true }).waitFor({ state: 'hidden' })
  await players[0].page.reload()
  await players[0].page.getByText('✓ Answer Revealed', { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: /Call Next Question/ }).click()
  for (const actor of players) {
    const batch = actor.page.getByRole('region', { name: 'Current question batch', exact: true })
    const toggle = batch.getByRole('button')
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
    await batch.getByText('Call #5', { exact: true }).waitFor()
    assert.equal(await batch.locator('li').count(), 1, 'A new draw clears the revealed batch')
  }
  await players[0].page.reload()
  const reloadedBatch = players[0].page.getByRole('region', { name: 'Current question batch', exact: true })
  await reloadedBatch.getByRole('button').click()
  await reloadedBatch.getByText('Call #5', { exact: true }).waitFor()
  // Complete a real 90-call game, with three independently authenticated members.
  const third = await players[2].page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))
  const wrong = await gameRequest(players[2], host, '/claims', 'POST', { claim: 'early_five' }, third.player_token)
  assert.equal(wrong.penalty, 0)
  assert.equal(wrong.cut, null)
  await admin.page.getByRole('alert').filter({ hasText: 'Incorrect claim:' }).waitFor()
  for (let i = 5; i < 90; i++) await gameRequest(admin, host, '/calls', 'POST', undefined, host.host_token)
  await gameRequest(admin, host, '/reveals', 'PUT', { seqs: Array.from({ length: 90 }, (_, i) => i + 1) }, host.host_token)
  const sessions = []
  for (const actor of players.slice(0, 2)) {
    const session = await actor.page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))
    sessions.push(session)
    const state = await gameRequest(actor, host, '', 'GET', undefined, session.player_token)
    for (const number of state.me.ticket.flat().filter(Boolean)) await actor.page.locator(`button[title^="#${number}:"]`).click()
    const saved = await gameRequest(actor, host, '', 'GET', undefined, session.player_token)
    // Claims synchronize the last pending tap in the frontend.
    if (actor === players[0]) await actor.page.getByRole('button', { name: /Early Five/ }).click()
    else {
      // The UI disables a taken prize; also verify a stale request is harmless.
      await actor.page.getByRole('button', { name: /Early Five/ }).waitFor()
      await actor.page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Early Five/.test(b.textContent) && b.disabled))
      await gameRequest(actor, host, '/claims', 'POST', { claim: 'early_five' }, session.player_token)
    }
    const after = await gameRequest(actor, host, '', 'GET', undefined, session.player_token)
    assert.equal(after.me.marked.length, 15)
    assert.equal(after.me.wrong_claims, 0, 'Losing an already claimed prize must not penalize')
    assert.equal(saved.calls.length, 90)
  }
  for (const claim of ['four_corners', 'top_line', 'middle_line', 'bottom_line']) {
    const result = await gameRequest(players[0], host, '/claims', 'POST', { claim }, sessions[0].player_token)
    assert.equal(result.accepted, true)
  }
  assert.equal((await gameRequest(players[0], host, '/claims', 'POST', { claim: 'full_house' }, sessions[0].player_token)).accepted, true)
  assert.equal((await gameRequest(players[1], host, '/claims', 'POST', { claim: 'second_full_house' }, sessions[1].player_token)).accepted, true)
  const final = await gameRequest(admin, host, '', 'GET', undefined, host.player_token)
  assert.equal(final.status, 'finished')
  assert.equal(new Set(final.calls.map(call => call.number)).size, 90)
  results.push({ name: 'full-game', players: 3, calls: 90, acceptedClaims: final.claims.filter(c => c.status === 'accepted').length, status: final.status })
  const audit = { entries: [] }
  let cursor = ''
  do {
    const response = await root.context.request.get(`${apiOrigin}/api/v1/admin/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const batch = await response.json()
    assert.equal(response.status(), 200)
    audit.entries.push(...batch.entries)
    cursor = batch.nextCursor
  } while (cursor)
  for (const action of ['GAME_STARTED', 'GAME_ANSWERS_REVEALED', 'GAME_CLAIM_ACCEPTED', 'GAME_CLAIM_REJECTED']) assert.ok(audit.entries.some(entry => entry.action === action && entry.resourceId === host.game_id), action)
  await root.page.goto(`${origin}/admin/audit`)
  await root.page.getByLabel('Activity', { exact: true }).selectOption('GAME_ANSWERS_REVEALED')
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByRole('heading', { name: 'Revealed answers', exact: true }).first().waitFor()
  await root.page.screenshot({ path: `${out}/super-admin-reveal-audit.png`, fullPage: true })
  await root.page.goto(`${origin}/admin/audit?game=${host.game_id}`)
  await root.page.getByRole('heading', { name: `Game ${host.code} · Audit trail`, exact: true }).waitFor()
  await root.page.getByRole('heading', { name: 'Won a claim', exact: true }).first().waitFor()
  await root.page.getByText('user1@demo.local', { exact: true }).first().waitFor()
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(await root.page.locator('#audit').innerText()), 'Audit must not display raw identifiers')
  await measure(root, 'game-audit')
  const failedLogin = await players[2].context.request.post(`${apiOrigin}/api/v1/auth/login`, { headers: { Origin: origin }, data: { email: 'user3@demo.local', password: 'WrongPassword123!' } })
  assert.equal(failedLogin.status(), 401)
  await root.page.getByLabel('Only activity needing review', { exact: true }).check()
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByRole('heading', { name: 'Failed login', exact: true }).first().waitFor()
  await root.page.getByPlaceholder('Search people or games').fill('user3@demo.local')
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByRole('heading', { name: 'Failed login', exact: true }).first().waitFor()
  assert.ok(await root.page.getByText('user3@demo.local', { exact: true }).count())
  await root.page.screenshot({ path: `${out}/game-review-signals.png`, fullPage: true })
  await admin.page.goto(`${origin}/admin`)
  await admin.page.getByText(host.code, { exact: true }).waitFor()
  const gameRow = admin.page.locator('#games > div').filter({ has: admin.page.getByText(host.code, { exact: true }) })
  await gameRow.getByRole('button', { name: 'Delete game', exact: true }).click()
  const deletion = admin.page.getByRole('form', { name: `Delete game ${host.code}`, exact: true })
  await deletion.waitFor()
  assert.equal(await deletion.getByRole('button', { name: 'Confirm delete', exact: true }).isEnabled(), false)
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click()
  await gameRow.getByRole('button', { name: 'Delete game', exact: true }).click()
  await deletion.getByRole('textbox').fill(host.code)
  await admin.page.screenshot({ path: `${out}/delete-game-confirmation.png`, fullPage: true })
  await deletion.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  await admin.page.getByText(host.code, { exact: true }).waitFor({ state: 'hidden' })
  await root.page.getByLabel('Only activity needing review', { exact: true }).uncheck()
  await root.page.getByPlaceholder('Search people or games').fill('')
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByRole('heading', { name: 'Deleted game', exact: true }).first().waitFor()
  await root.page.getByText('Deleted · audit retained', { exact: false }).waitFor()
  results.push({ name: 'audit-and-deletion', identity: true, gameAudit: true, reviewFilters: true, confirmedDeletion: true, retainedHistory: true })
  results.push({ name: 'audit-actions', actions: audit.entries.filter(entry => entry.resourceId === host.game_id).map(entry => entry.action) })
  results.push({ name: 'browser-errors', errors })
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  assert.deepEqual(errors, [])
  for (const result of results.filter(result => result.sizes)) for (const size of result.sizes) assert.ok(size.content <= size.viewport, `${result.name} overflows: ${JSON.stringify(size)}`)
} catch (error) {
  if (hostPage) {
    console.log('Host at failure:', (await hostPage.locator('body').innerText()).slice(0, 3000))
    await hostPage.screenshot({ path: `${out}/game-failure.png`, fullPage: true })
  }
  throw error
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
