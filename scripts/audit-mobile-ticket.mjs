// Use only with the disposable demo API and frontend on ports 3011 / 5175.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const out = 'artifacts/audit/mobile-ticket'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const errors = [], results = []
async function login(name, destination) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://localhost:5175')
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  await page.waitForURL(`**/${destination}`)
  return { context, page }
}
try {
  const admin = await login('Admin 1', 'admin')
  const player = await login('Member 1', 'account')
  await admin.page.getByRole('button', { name: 'Create a game', exact: true }).first().click()
  await admin.page.waitForURL('**/host')
  const code = await admin.page.locator('[aria-label^="Game code"]').first().textContent()
  await player.page.getByLabel('Game code', { exact: true }).fill(code.trim())
  await player.page.getByRole('button', { name: 'Join game', exact: true }).click()
  await player.page.waitForURL('**/play')
  await admin.page.getByRole('button', { name: 'Start game with 1', exact: true }).click()
  await admin.page.getByRole('button', { name: /Call Next Question/ }).click()
  await admin.page.getByText('Call #1', { exact: true }).waitFor()
  await admin.page.getByRole('button', { name: /Call Next Question/ }).click()
  await admin.page.getByText('Call #2', { exact: true }).waitFor()
  const ticket = player.page.getByRole('region', { name: 'Tambola ticket', exact: true })
  await player.page.getByRole('region', { name: 'Claim a pattern', exact: true }).waitFor()
  for (const [width, height] of [[320,568], [360,640], [390,844], [430,932], [1280,800]]) {
    await player.page.setViewportSize({ width, height })
    await ticket.locator('button').first().click()
    const metrics = await ticket.evaluate(el => {
      const grid = el.querySelector('.ticket-grid')
      return { height: el.getBoundingClientRect().height, gridHeight: grid.getBoundingClientRect().height, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, cells: grid.children.length, pageWidth: document.documentElement.scrollWidth }
    })
    if (width < 640) {
      assert.ok(metrics.height <= height - 64, `Ticket must fit below mobile clue: ${JSON.stringify({ width, height, ...metrics })}`)
      assert.equal(metrics.columns, 3)
      const batch = player.page.getByRole('region', { name: 'Current question batch', exact: true })
      assert.equal(await batch.getByRole('button').getAttribute('aria-expanded'), 'false')
      const claims = player.page.getByRole('region', { name: 'Claim a pattern', exact: true })
      assert.equal(await claims.locator('button').first().evaluate(el => el.getBoundingClientRect().height), 44)
    } else assert.equal(metrics.columns, 9)
    assert.equal(metrics.cells, 27)
    assert.ok(metrics.pageWidth <= width)
    await ticket.evaluate(el => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -64) })
    await player.page.screenshot({ path: `${out}/ticket-${width}.png` })
    results.push({ width, viewportHeight: height, ...metrics })
  }
  await player.page.setViewportSize({ width: 390, height: 844 })
  const batch = player.page.getByRole('region', { name: 'Current question batch', exact: true })
  await batch.getByRole('button').click()
  await batch.locator('ol').waitFor()
  assert.equal(await batch.locator('li').count(), 2)
  await batch.getByRole('button').click()
  assert.equal(await batch.locator('ol').isVisible(), false)
  await player.page.screenshot({ path: `${out}/compact-player-full.png`, fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2))
} finally { await browser.close() }
