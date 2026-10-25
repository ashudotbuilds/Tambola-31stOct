import assert from 'node:assert/strict'
import { readConfig } from '../src/config'
import { createTelemetry } from '../src/telemetry'

const config = readConfig()
if (!config.POSTHOG_PROJECT_KEY) throw new Error('Set POSTHOG_PROJECT_KEY in backend/.env first')
const originalFetch = globalThis.fetch
let acceptedStatus: number | undefined
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init)
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  // This isolated client enqueues only the exception. The SDK compresses its batch.
  if (url.origin === config.POSTHOG_HOST && url.pathname.replace(/\/$/, '') === '/batch') {
    assert.ok(response.ok, `PostHog error ingestion returned HTTP ${response.status}`)
    acceptedStatus = response.status
  }
  return response
}
try {
  const telemetry = createTelemetry({ projectKey: config.POSTHOG_PROJECT_KEY, host: config.POSTHOG_HOST, environment: 'installation-check' })!
  telemetry.exception(new Error('Tambola error tracking installation check — intentional test exception'), { request_id: `setup-check-${Date.now()}` })
  await telemetry.shutdown()
  assert.ok(acceptedStatus, 'No successful exception ingestion response was observed')
  console.log(`PostHog accepted the intentional test exception (HTTP ${acceptedStatus}). Check Error Tracking in the configured project.`)
} finally {
  globalThis.fetch = originalFetch
}
