import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = process.env.AUDIT_WEB_URL || 'http://localhost:5173'
await mkdir('artifacts/audit', { recursive: true })
const browser = await chromium.launch()
const errors = []
async function login(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  return { context, page }
}
try {
  const root = await login('Super Admin')
  await root.page.waitForURL('**/super-admin')
  await root.page.getByRole('heading', { name: 'System diagnostics', exact: true }).waitFor()
  assert.equal(await root.page.getByLabel('Name', { exact: true }).count(), 0)
  assert.equal(await root.page.getByPlaceholder('Exact action').count(), 0)
  for (const [path, heading] of [['/super-admin', 'Super Admin'], ['/super-admin/admins', 'Create admin'], ['/admin/audit', 'Audit trail'], ['/admin', 'Game control.'], ['/admin/participants', 'Participants']]) {
    await root.page.goto(origin + path)
    await root.page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor()
    await root.page.evaluate(() => document.fonts.ready)
    for (const width of [320, 390, 1280]) {
      await root.page.setViewportSize({ width, height: 844 })
      await root.page.screenshot({ path: `artifacts/audit/admin-pages-${path.replaceAll('/', '-')}-${width}.png`, fullPage: true })
      assert.ok(await root.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} overflows at ${width}`)
    }
    await root.page.reload()
    await root.page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor()
  }
  await root.page.goto(origin + '/admin/audit')
  await root.page.getByLabel('Activity', { exact: true }).selectOption('LOGIN_SUCCESS')
  await root.page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await root.page.getByRole('heading', { name: 'Logged in', exact: true }).first().waitFor()
  await root.page.getByRole('link', { name: 'Create admin', exact: true }).click()
  await root.page.waitForURL('**/super-admin/admins')
  await root.page.getByRole('heading', { level: 1, name: 'Create admin', exact: true }).waitFor()
  assert.equal(await root.page.getByPlaceholder('Exact action').count(), 0)
  // Verify the form wiring without sending email or creating real accounts.
  let submitted
  await root.page.route('**/api/v1/super-admin/admins', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Test delivery unavailable' }) })
  })
  await root.page.getByLabel('Name', { exact: true }).fill('Navigation Test')
  await root.page.getByLabel('Email', { exact: true }).fill('navigation@example.test')
  await root.page.getByRole('button', { name: 'Create administrator', exact: true }).click()
  await root.page.getByRole('alert').filter({ hasText: 'Test delivery unavailable' }).waitFor()
  assert.deepEqual(submitted, { email: 'navigation@example.test', name: 'Navigation Test', role: 'ADMIN' })
  const admin = await login('Admin 1')
  await admin.page.waitForURL('**/admin')
  await admin.page.getByRole('heading', { name: 'Game control.', exact: true }).waitFor()
  assert.equal(await admin.page.getByLabel('Event name', { exact: true }).count(), 0)
  assert.equal(await admin.page.getByPlaceholder('Exact action').count(), 0)
  for (const path of ['/super-admin', '/super-admin/admins']) {
    await admin.page.goto(origin + path)
    await admin.page.waitForURL('**/admin')
    await admin.page.getByRole('heading', { name: 'Game control.', exact: true }).waitFor()
  }
  await admin.page.getByRole('link', { name: 'Audit trail', exact: true }).click()
  await admin.page.waitForURL('**/admin/audit')
  await admin.page.getByRole('heading', { level: 1, name: 'Audit trail', exact: true }).waitFor()
  assert.equal(await admin.page.getByRole('link', { name: 'Create admin', exact: true }).count(), 0)
  await admin.page.getByRole('link', { name: 'Participants', exact: true }).click()
  await admin.page.getByRole('heading', { level: 1, name: 'Participants', exact: true }).waitFor()
  const suffix = Date.now()
  await admin.page.getByLabel('Participant CSV', { exact: true }).setInputFiles({ name: 'participants.csv', mimeType: 'text/csv', buffer: Buffer.from(`name,email\nPage Audit Member,page-${suffix}@example.test`) })
  await admin.page.getByRole('button', { name: 'Import participants', exact: true }).click()
  await admin.page.getByText('Import finished: 1 created, 0 skipped, 0 failed.', { exact: true }).waitFor()
  assert.equal(await admin.page.getByRole('link', { name: 'Rounds', exact: true }).count(), 0)
  assert.equal(await admin.page.getByLabel('Event name', { exact: true }).count(), 0)
  const member = await login('Member 1')
  await member.page.waitForURL('**/account')
  for (const path of ['/admin/audit', '/admin/participants']) {
    await member.page.goto(origin + path)
    await member.page.waitForURL('**/account')
  }
  assert.deepEqual(errors, [])
  console.log('PASS: separate pages, direct reloads, navigation, role restrictions, audit filtering, form submission/errors, and 320/390/1280px layouts; no browser errors.')
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1)
  if (page) {
    await page.screenshot({ path: 'artifacts/audit/admin-pages-failure.png', fullPage: true })
    console.log(page.url(), (await page.locator('body').innerText()).slice(-4500))
  }
  throw error
} finally { await browser.close() }
