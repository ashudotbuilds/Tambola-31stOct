import type { PostHog } from 'posthog-js'
import type { AuthUser } from '@/shared/types'
import { scrubTelemetry, telemetryError } from '@/shared/telemetryPrivacy'

const key = import.meta.env.VITE_POSTHOG_PROJECT_KEY?.trim()
const host = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com'
const configured = Boolean(key?.startsWith('phc_') && ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host))
let client: Promise<PostHog | null> | null = null
let identifiedUserId: string | null = null
let listening = false
function getClient(): Promise<PostHog | null> {
  if (!configured) return Promise.resolve(null)
  client ??= import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key!, {
      api_host: host, autocapture: false, capture_pageview: false, capture_pageleave: false,
      capture_exceptions: false, disable_session_recording: true, disable_surveys: true,
      capture_heatmaps: false, capture_dead_clicks: false, capture_performance: false,
      advanced_disable_feature_flags: true, person_profiles: 'identified_only',
      // Only the local delivery check captures an automated browser; production keeps bot filtering.
      opt_out_useragent_filter: import.meta.env.DEV && import.meta.env.VITE_POSTHOG_VERIFY_AUTOMATION === 'true',
      before_send: event => {
        if (!event) return event
        // The browser ingestion envelope requires this public project token.
        // Restore only our configured project token after removing application credentials.
        event.properties = { ...scrubTelemetry(event.properties) as Record<string, unknown>, token: key }
        return event
      },
    })
    posthog.register({ environment: import.meta.env.MODE, service: 'tambola-web' })
    return posthog
  }).catch(error => {
    if (import.meta.env.DEV) console.warn('PostHog initialization failed', telemetryError(error))
    return null
  })
  return client
}

export function trackTelemetry(event: string, properties: Record<string, string | number | boolean> = {}) {
  void getClient().then(posthog => { posthog?.capture(event, scrubTelemetry(properties) as Record<string, unknown>) }).catch(() => {})
}
export function captureTelemetryError(error: unknown, properties: Record<string, string | number | boolean> = {}) {
  void getClient().then(posthog => { posthog?.captureException(telemetryError(error), scrubTelemetry(properties) as Record<string, unknown>) }).catch(() => {})
}
export function identifyTelemetry(user: AuthUser, role: string) {
  if (identifiedUserId === user.id) return
  const previousUserId = identifiedUserId
  identifiedUserId = user.id
  void getClient().then(posthog => {
    if (!posthog) return
    if (previousUserId) posthog.reset()
    posthog.identify(user.id, { role })
  }).catch(() => {})
}
export function resetTelemetry() {
  identifiedUserId = null
  void getClient().then(posthog => { posthog?.reset() }).catch(() => {})
}
export function startTelemetry() {
  if (!configured || listening) return
  listening = true
  void getClient()
  window.addEventListener('error', event => captureTelemetryError(event.error ?? event.message, { source: 'window_error' }))
  window.addEventListener('unhandledrejection', event => captureTelemetryError(event.reason, { source: 'unhandled_rejection' }))
}
