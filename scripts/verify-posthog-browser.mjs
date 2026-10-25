// Run against a local configured Vite frontend; sends one explicit installation-check event.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch()
try {
  // Start Vite with VITE_POSTHOG_VERIFY_AUTOMATION=true for this local-only check.
  const page = await browser.newPage()
  const errors = []
  const network = []
  const sdkMessages = []
  page.on('console', message => { if (/posthog/i.test(message.text())) sdkMessages.push(message.text().replace(/ph[cx]_[a-zA-Z0-9_-]+/g, '[redacted]')) })
  page.on('requestfailed', request => { if (request.url().includes('posthog.com')) network.push({ host: new URL(request.url()).hostname, failure: request.failure()?.errorText }) })
  page.on('response', response => { if (response.url().includes('posthog.com')) network.push({ host: new URL(response.url()).hostname, method: response.request().method(), status: response.status() }) })
  page.on('pageerror', error => errors.push(error.message))
  const capture = page.waitForResponse(response => {
    const url = new URL(response.url())
    return ['us.i.posthog.com', 'eu.i.posthog.com'].includes(url.hostname) && response.request().method() === 'POST' && response.ok()
  }, { timeout: 20_000 })
  await page.goto(process.env.AUDIT_WEB_URL || 'http://localhost:5175')
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
  if (process.env.POSTHOG_VERIFY_ERRORS === 'true') {
    for (const kind of ['error', 'unhandledrejection']) {
      const exceptionResponse = page.waitForResponse(response => {
        const url = new URL(response.url())
        return ['us.i.posthog.com', 'eu.i.posthog.com'].includes(url.hostname) && response.request().method() === 'POST' && response.ok()
      }, { timeout: 20_000 })
      await page.evaluate(kind => {
        const error = new Error(`Tambola ${kind} installation check — intentional test exception`)
        window.dispatchEvent(kind === 'error'
          ? new ErrorEvent('error', { error, message: error.message })
          : new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: error }))
      }, kind)
      const response = await exceptionResponse
      console.log(JSON.stringify({ source: kind, accepted: true, status: response.status() }))
    }
  }
} finally { await browser.close() }
