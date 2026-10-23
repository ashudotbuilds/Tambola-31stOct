// Run against a freshly started npm run dev:demo (restart between runs).
// Set PLAYWRIGHT_MODULE to a Playwright module path
// if it is not installed locally. Uses isolated browser contexts for each role.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = process.env.AUDIT_WEB_URL || 'http://localhost:5173'
const out = process.env.AUDIT_OUTPUT || 'artifacts/audit'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
const results = []
async function role(id, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 640, hasTouch: width < 640 })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(`${id}: ${error.message}`))
  page.on('dialog', dialog => dialog.accept())
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(`^${id === 'superadmin' ? 'Super Admin' : id === 'admin1' ? 'Admin 1' : `Member ${id.slice(-1)}`} `) }).click()
  await page.waitForURL(id.startsWith('user') ? '**/account' : '**/admin')
  await page.getByRole('heading', { name: id.startsWith('user') ? 'Got a game code?' : 'Game control.', exact: true }).waitFor()
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
  const response = await actor.context.request.fetch(`http://localhost:3001/api/games/${host.game_id}${action}`, {
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
  assert.equal(await entry.page.getByRole('button', { name: 'Toggle theme', exact: true }).evaluate(element => getComputedStyle(element).transitionDuration), '1e-05s')
  await entry.page.emulateMedia({ reducedMotion: 'no-preference' })
  await entry.page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
  await entry.page.reload()
  await entry.page.waitForFunction(() => document.documentElement.classList.contains('light'))
  await measure(entry, 'login-light')
  await entryContext.close()
  const root = await role('superadmin', 1280)
  const admin = await role('admin1')
  const diagnostics = await root.context.request.get('http://localhost:3001/api/v1/super-admin/system')
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
  await measure(players[0], 'player-lobby')
  await admin.page.getByRole('button', { name: 'Start game with 3', exact: true }).click()
  await players[0].page.getByText('Waiting for the host to start the game').waitFor({ state: 'hidden' })
  const board = { page: await admin.context.newPage() }
  await board.page.goto(`${origin}/board?code=${host.code}`)
  for (let i = 0; i < 4; i++) {
    await admin.page.getByRole('button', { name: /Call Next Question/ }).click()
    await admin.page.getByText(`${i + 1} pending reveal`, { exact: false }).waitFor()
  }
  await board.page.getByText('No answers revealed yet.', { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: /Reveal All \(4\) Pending/ }).click()
  for (const actor of players) {
    await actor.page.getByText('✓ Answer Revealed', { exact: true }).waitFor()
    const state = await actor.page.evaluate(async (gameId) => {
      const s = JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`))
      return (await fetch(`http://localhost:3001/api/games/${gameId}`, { credentials: 'include', headers: { Authorization: `Bearer ${s.player_token}` } })).json()
    }, host.game_id)
    assert.deepEqual(state.settings.revealed_seqs, [1, 2, 3, 4])
    assert.equal(state.me.marked.length, 0, 'Revealing must never auto-mark tickets')
    await actor.page.getByText('Question and answer history (4 revealed)', { exact: true }).click()
    assert.equal(await actor.page.getByRole('list', { name: 'Question and answer history' }).locator('li').count(), 4)
  }
  await measure(players[0], 'player-active')
  await measure(admin, 'host-active')
  await admin.page.getByRole('button', { name: 'Pause', exact: true }).click()
  await admin.page.getByRole('button', { name: 'Resume', exact: true }).click()
  await admin.page.getByRole('button', { name: 'Resume', exact: true }).waitFor({ state: 'hidden' })
  await players[0].page.reload()
  await players[0].page.getByText('✓ Answer Revealed', { exact: true }).waitFor()
  // Complete a real 90-call game, with three independently authenticated members.
  const third = await players[2].page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))
  const wrong = await gameRequest(players[2], host, '/claims', 'POST', { claim: 'early_five' }, third.player_token)
  assert.equal(wrong.penalty, 10)
  for (let i = 4; i < 90; i++) await gameRequest(admin, host, '/calls', 'POST', undefined, host.host_token)
  await gameRequest(admin, host, '/reveals', 'PUT', { seqs: Array.from({ length: 90 }, (_, i) => i + 1) }, host.host_token)
  const sessions = []
  for (const actor of players.slice(0, 2)) {
    const session = await actor.page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))
    sessions.push(session)
    const state = await gameRequest(actor, host, '', 'GET', undefined, session.player_token)
    for (const number of state.me.ticket.flat().filter(Boolean)) await actor.page.locator(`[role="button"][title^="#${number} "]`).click()
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
  // Exercise the separate event-round workflow and its mobile ticket too.
  async function roundRequest(actor, path, method = 'GET', body) {
    const response = await actor.context.request.fetch(`http://localhost:3001/api/v1${path}`, {
      method, headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() }, data: body,
    })
    assert.ok(response.ok(), await response.text())
    return response.json()
  }
  const events = await roundRequest(admin, '/admin/events')
  const demoEvent = events.events.find(event => event.name === 'Demo event')
  assert.equal(demoEvent.status, 'DRAFT', 'Restart npm run dev:demo before each browser audit')
  const eventId = demoEvent.id
  const created = await roundRequest(admin, `/admin/events/${eventId}/rounds`, 'POST', { name: 'Mobile audit round' })
  const roundId = created.round.id
  const keys = []
  for (let i = 1; i <= 20; i++) {
    const key = await roundRequest(admin, `/admin/events/${eventId}/keys`, 'POST', { value: `Audit ${roundId.slice(0, 8)} technical term ${i}` })
    keys.push(key.key.id)
    await roundRequest(admin, `/admin/rounds/${roundId}/questions`, 'POST', { keyId: key.key.id, question: `Technical clue ${i}` })
  }
  const assigned = await roundRequest(admin, `/admin/rounds/${roundId}/tickets/generate`, 'POST', {})
  assert.equal(assigned.total, 6)
  await roundRequest(admin, `/admin/rounds/${roundId}/ready`, 'POST', {})
  await roundRequest(admin, `/admin/rounds/${roundId}/start`, 'POST', {})
  for (const keyId of keys) {
    const draw = await roundRequest(admin, `/admin/rounds/${roundId}/draws`, 'POST', { keyId })
    await roundRequest(admin, `/admin/rounds/${roundId}/draws/reveal`, 'POST', { seq: draw.draw.seq })
  }
  for (const actor of players) {
    await actor.page.goto(`${origin}/account/round/${roundId}`)
    await actor.page.getByRole('heading', { name: 'Draw history', exact: true }).waitFor()
  }
  await measure(players[0], 'event-round-ticket')
  const roundState = await roundRequest(players[0], `/participant/rounds/${roundId}`)
  assert.equal(roundState.draws.filter(draw => draw.revealed_at).length, 20)
  for (const cell of roundState.ticket.cells.flat().filter(Boolean).slice(0, 5)) {
    await players[0].page.getByRole('button', { name: cell.value, exact: true }).click()
    await players[0].page.getByRole('button', { name: `${cell.value}, marked`, exact: true }).waitFor()
  }
  const claim = await roundRequest(players[0], `/participant/rounds/${roundId}/claims`, 'POST', { pattern: 'early_five' })
  assert.equal(claim.claim.status, 'PENDING_VERIFICATION')
  const verified = await roundRequest(admin, `/admin/claims/${claim.claim.id}/review`, 'POST', { decision: 'verify' })
  assert.equal(verified.claim.status, 'VERIFIED')
  await players[0].page.getByRole('heading', { name: 'Verified winners', exact: true }).waitFor()
  await roundRequest(admin, `/admin/rounds/${roundId}/pause`, 'POST', {})
  await roundRequest(admin, `/admin/rounds/${roundId}/resume`, 'POST', {})
  await roundRequest(admin, `/admin/rounds/${roundId}/complete`, 'POST', {})
  results.push({ name: 'event-round', assigned: assigned.total, testedPlayers: 3, revealed: 20, verifiedClaims: 1, status: 'COMPLETED' })
  const audit = { entries: [] }
  let cursor = ''
  do {
    const response = await root.context.request.get(`http://localhost:3001/api/v1/admin/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const batch = await response.json()
    assert.equal(response.status(), 200)
    audit.entries.push(...batch.entries)
    cursor = batch.nextCursor
  } while (cursor)
  for (const action of ['GAME_STARTED', 'GAME_ANSWERS_REVEALED', 'GAME_CLAIM_ACCEPTED', 'GAME_CLAIM_REJECTED']) assert.ok(audit.entries.some(entry => entry.action === action && entry.resourceId === host.game_id), action)
  await root.page.reload()
  await root.page.getByPlaceholder('Exact action').fill('GAME_ANSWERS_REVEALED')
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByText('GAME_ANSWERS_REVEALED', { exact: false }).first().waitFor()
  await root.page.screenshot({ path: `${out}/super-admin-reveal-audit.png`, fullPage: true })
  results.push({ name: 'audit-actions', actions: audit.entries.filter(entry => entry.resourceId === host.game_id).map(entry => entry.action) })
  results.push({ name: 'browser-errors', errors })
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  assert.deepEqual(errors, [])
  for (const result of results.filter(result => result.sizes)) for (const size of result.sizes) assert.ok(size.content <= size.viewport, `${result.name} overflows: ${JSON.stringify(size)}`)
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
