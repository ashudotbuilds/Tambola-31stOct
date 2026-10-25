import { PostHog } from 'posthog-node'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { scrubTelemetry, telemetryError } from './shared/telemetryPrivacy'

export interface RequestTelemetry {
  request_id: string
  method: string
  route: string
  status_code: number
  duration_ms: number
  user_id?: string
  role?: string
  game_id?: string
  claim?: string
  accepted?: boolean
  points?: number
}
export interface ServerTelemetry {
  request: (record: RequestTelemetry) => void
  exception: (error: unknown, properties: { request_id: string; user_id?: string }) => void
  shutdown: () => Promise<void>
}

/** Optional, bounded background queues. Telemetry never participates in a game transaction. */
export function createTelemetry(config: { projectKey?: string; host: string; environment: string }): ServerTelemetry | undefined {
  if (!config.projectKey) return undefined
  const client = new PostHog(config.projectKey, {
    host: config.host, flushAt: 20, flushInterval: 5000, maxQueueSize: 1000,
    requestTimeout: 3000, fetchRetryCount: 1, disableGeoip: true, enableExceptionAutocapture: false,
    before_send: event => ({ ...event, properties: scrubTelemetry(event.properties) as typeof event.properties }),
  })
  client.on('error', () => { /* Export failures must not become application failures. */ })
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ 'service.name': 'tambola-api', 'deployment.environment.name': config.environment }),
    processors: [new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ url: `${config.host}/i/v1/logs`, headers: { Authorization: `Bearer ${config.projectKey}` }, timeoutMillis: 3000 }),
      maxQueueSize: 1000, maxExportBatchSize: 100, scheduledDelayMillis: 5000, exportTimeoutMillis: 3000,
    })],
  })
  const logger = provider.getLogger('tambola-api')
  return {
    request(record) {
      try {
        const attributes = scrubTelemetry(record) as Record<string, string | number | boolean>
        const severityText = record.status_code >= 500 ? 'ERROR' : record.status_code >= 400 ? 'WARN' : 'INFO'
        logger.emit({ severityText, severityNumber: record.status_code >= 500 ? 17 : record.status_code >= 400 ? 13 : 9,
          body: 'HTTP request completed', attributes: { ...attributes, ...(record.user_id ? { posthogDistinctId: record.user_id } : {}) } })
        if (record.method !== 'GET' && record.status_code < 400 && record.route.startsWith('/api/games') && !record.route.endsWith('/marks')) {
          client.capture({ distinctId: record.user_id ?? 'anonymous-server', event: 'game_action_completed',
            properties: { ...attributes, environment: config.environment, $process_person_profile: false } })
        }
      } catch { /* Gameplay continues if telemetry fails. */ }
    },
    exception(error, properties) {
      try { client.captureException(telemetryError(error), properties.user_id ?? 'anonymous-server', {
        ...properties, environment: config.environment, $process_person_profile: false,
      }) } catch { /* Gameplay continues if telemetry fails. */ }
    },
    async shutdown() { await Promise.allSettled([client.shutdown(3000), provider.shutdown()]) },
  }
}
