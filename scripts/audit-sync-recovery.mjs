// Isolated demo only; run API 3011 and frontend 5175 before this scenario.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch()
const web = 'http://localhost:5175', api = 'http://localhost:3011'
const report = { errors: [] }
async function login(name, destination) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto(web)
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  await page.waitForURL(`**/${destination}`)
  return { context, page }
}
try {
  const host = await login('Admin 1', 'admin'), player = await login('Member 1', 'account')
  await host.page.getByRole('button', { name: 'Create a game', exact: true }).first().click()
  await host.page.waitForURL('**/host')
  const session = await host.page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.host:${localStorage.getItem('tt.account.id')}`)))
  await player.page.getByLabel('Game code', { exact: true }).fill(session.code)
  await player.page.getByRole('button', { name: 'Join game', exact: true }).click()
  await player.page.waitForURL('**/play')
  await player.page.getByRole('region', { name: 'Interactive ticket simulation' }).waitFor()
  const initialHostState = await (await host.context.request.get(`${api}/api/games/${session.game_id}`)).json()
  const changedBank = initialHostState.settings.custom_bank.map((item, i) => i === 0 ? { ...item, term: 'SYNC-CHECK' } : item)
  const bankRefresh = player.page.waitForResponse(r => r.request().method() === 'GET' && r.url() === `${api}/api/games/${session.game_id}`)
  const bankWrite = await host.context.request.put(`${api}/api/games/${session.game_id}/bank`, {
    headers: { Origin: web, Authorization: `Bearer ${session.host_token}` }, data: { bank: changedBank },
  })
  assert.equal(bankWrite.status(), 200)
  assert.equal((await (await bankRefresh).json()).settings.custom_bank[0].term, 'SYNC-CHECK')
  report.questionBankRefresh = true
  await host.page.getByRole('button', { name: 'Start game with 1', exact: true }).click()
  await player.page.getByRole('region', { name: 'Claim a pattern' }).waitFor()
  const ticket = player.page.getByRole('region', { name: 'Tambola ticket' })
  await ticket.locator('button[aria-pressed]').first().waitFor()
  const own = await player.page.evaluate(() => JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))
  const state = async () => (await player.context.request.get(`${api}/api/games/${session.game_id}`, { headers: { Authorization: `Bearer ${own.player_token}` } })).json()
  const saved = () => player.page.getByLabel('Ticket save status').getByText('Ticket saved', { exact: true }).waitFor()
  let writes = 0
  player.page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/marks')) writes++ })
  const firstSave = player.page.waitForResponse(r => r.url().endsWith('/marks') && r.status() === 200)
  await ticket.evaluate(el => el.querySelectorAll('button[aria-pressed="false"]').forEach(b => b.click()))
  await firstSave; await saved()
  assert.equal((await state()).me.marked.length, 15)
  assert.ok(writes <= 2, `Expected coalesced saves, got ${writes}`)
  report.rapidTaps = { cells: 15, writes, saved: 15 }
  const deltaResponse = player.page.waitForResponse(r => r.url().includes('/updates?after='))
  await host.page.getByRole('button', { name: /Call Next Question/ }).click()
  await player.page.locator('section.player-clue').getByText('Call #1', { exact: true }).waitFor()
  const delta = await (await deltaResponse).json()
  assert.ok(!('custom_bank' in delta.settings)); assert.ok(!('ticket' in delta.me))
  report.liveDelta = { calls: delta.calls.length, bytes: JSON.stringify(delta).length, fullBytes: JSON.stringify(await state()).length }
  await player.context.setOffline(true)
  await ticket.locator('button[aria-pressed="true"]').first().click()
  await player.page.getByLabel('Ticket save status').getByText(/Offline/).waitFor()
  const reconnectSave = player.page.waitForResponse(r => r.url().endsWith('/marks') && r.status() === 200)
  await player.context.setOffline(false)
  await reconnectSave; await saved(); assert.equal((await state()).me.marked.length, 14)
  report.offlineRecovery = true
  await player.page.route('**/marks', r => r.abort())
  await ticket.locator('button[aria-pressed="false"]').first().click()
  await player.page.getByLabel('Ticket save status').getByText(/retrying/).waitFor()
  await player.page.reload()
  await player.page.getByLabel('Ticket save status').getByText(/retrying/).waitFor()
  assert.equal(await ticket.locator('button[aria-pressed="true"]').count(), 15)
  await player.page.unroute('**/marks')
  const restoredSave = player.page.waitForResponse(r => r.url().endsWith('/marks') && r.status() === 200)
  await player.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await restoredSave; await saved(); assert.equal((await state()).me.marked.length, 15)
  report.reloadRecovery = true
  let markConfirmed = false, claimWaited = false
  player.page.on('response', r => { if (r.url().endsWith('/marks') && r.status() === 200) markConfirmed = true })
  player.page.on('request', r => { if (r.url().endsWith('/claims')) claimWaited = markConfirmed })
  await player.page.route('**/marks', async r => { await new Promise(resolve => setTimeout(resolve, 400)); await r.continue() })
  await ticket.locator('button[aria-pressed="true"]').first().click()
  await player.page.getByRole('region', { name: 'Claim a pattern' }).getByRole('button', { name: /Early Five/ }).click()
  await player.page.getByRole('status').filter({ hasText: 'Incorrect claim' }).waitFor()
  assert.equal(claimWaited, true)
  report.claimWaitedForSave = true
  assert.deepEqual(report.errors, [])
  await mkdir('artifacts/audit/sync-recovery', { recursive: true })
  await writeFile('artifacts/audit/sync-recovery/results.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
