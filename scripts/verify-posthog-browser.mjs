// Run against a local configured Vite frontend; sends one explicit installation-check event.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch()
try {
  // Match a regular browser: PostHog filters known automation user agents.
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36' })
  const errors = []
  const network = []
  const sdkMessages = []
  page.on('console', message => { if (/posthog/i.test(message.text())) sdkMessages.push(message.text().replace(/ph[cx]_[a-zA-Z0-9_-]+/g, '[redacted]')) })
  page.on('requestfailed', request => { if (request.url().includes('posthog.com')) network.push({ host: new URL(request.url()).hostname, failure: request.failure()?.errorText }) })
  page.on('response', response => { if (response.url().includes('posthog.com')) network.push({ host: new URL(response.url()).hostname, method: response.request().method(), status: response.status() }) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.AUDIT_WEB_URL || 'http://localhost:5175')
  const capture = page.waitForResponse(response => {
    const url = new URL(response.url())
    return ['us.i.posthog.com', 'eu.i.posthog.com'].includes(url.hostname) && response.request().method() === 'POST' && response.ok()
  }, { timeout: 20_000 })
  await page.evaluate(async () => {
    const { trackTelemetry } = await import('/src/lib/telemetry.ts')
    trackTelemetry('posthog_setup_verified', { source: 'installation-check' })
  })
  let accepted
  try { accepted = await capture }
  catch (error) {
    console.log(JSON.stringify({ network, sdkMessages, browserErrors: errors, state: await page.evaluate(() => ({
      sdkAvailable: Boolean(window.posthog), loaded: window.posthog?.__loaded,
      optedOut: window.posthog?.has_opted_out_capturing?.(),
    })) }))
    throw error
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ accepted: true, status: accepted.status(), host: new URL(accepted.url()).hostname, browserErrors: errors }))
} finally { await browser.close() }
