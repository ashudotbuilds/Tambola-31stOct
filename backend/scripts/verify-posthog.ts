import { readConfig } from '../src/config'

const config = readConfig()
if (!config.POSTHOG_PROJECT_KEY) throw new Error('Set POSTHOG_PROJECT_KEY in backend/.env first')
const now = (BigInt(Date.now()) * 1_000_000n).toString()
const response = await fetch(`${config.POSTHOG_HOST}/i/v1/logs`, {
  method: 'POST', signal: AbortSignal.timeout(10_000),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.POSTHOG_PROJECT_KEY}` },
  body: JSON.stringify({ resourceLogs: [{
    resource: { attributes: [
      { key: 'service.name', value: { stringValue: 'tambola-api' } },
      { key: 'deployment.environment.name', value: { stringValue: config.NODE_ENV } },
    ] },
    scopeLogs: [{ scope: { name: 'tambola-setup-check' }, logRecords: [{
      timeUnixNano: now, observedTimeUnixNano: now, severityNumber: 9, severityText: 'INFO',
      body: { stringValue: 'Tambola PostHog logging installation verified' },
    }] }],
  }] }),
})
if (!response.ok) throw new Error(`PostHog log ingestion returned HTTP ${response.status}`)
console.log(`PostHog accepted the setup log (HTTP ${response.status}). Check Logs for service tambola-api.`)
