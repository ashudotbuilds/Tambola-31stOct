/** Strip common credentials and email addresses before third-party telemetry. */
export function redactTelemetryText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bph[cx]_[a-zA-Z0-9_-]+\b/g, '[redacted]')
    .replace(/\b[a-fA-F0-9]{64}\b/g, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]')
    .replace(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g, '[email redacted]')
    .slice(0, 4000)
}

export function scrubTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined
  if (typeof value === 'string') return redactTelemetryText(value)
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scrubTelemetry(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).filter(([key]) =>
      !/password|authorization|cookie|token|secret|ticket|marked|custom_bank|codesnippet|pre_context|post_context|context_line|^vars$|^clue$|^email$|^name$/i.test(key)
    ).map(([key, item]) => {
      if (['$current_url', '$referrer', '$initial_current_url', '$initial_referrer'].includes(key) && typeof item === 'string') {
        try { const url = new URL(item); item = `${url.origin}${url.pathname}` } catch { item = undefined }
      }
      return [key, scrubTelemetry(item, depth + 1)]
    }))
  }
  return undefined
}

export function telemetryError(error: unknown): Error {
  const safe = new Error(redactTelemetryText(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unexpected application error'))
  if (error instanceof Error) {
    safe.name = redactTelemetryText(error.name)
    if (error.stack) safe.stack = redactTelemetryText(error.stack)
  }
  return safe
}
