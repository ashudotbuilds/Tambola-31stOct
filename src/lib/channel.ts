/**
 * Which realtime channel a payload belongs to.
 *
 * The realtime layer namespaces database broadcasts as `realtime:<channel>`
 * while presence deltas keep the bare channel name. Both arrive on the same
 * subscription, so callers must compare on the bare form — a literal comparison
 * against the subscribed channel silently discards every broadcast, which is
 * exactly the bug that shipped once and is covered by scripts/claims-parity.ts.
 *
 * Pure on purpose: no React, no SDK, so the test harness can import it directly.
 */
export function channelOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const meta = (payload as { meta?: { channel?: unknown } }).meta
  const channel = typeof meta?.channel === 'string' ? meta.channel : null
  if (!channel) return null
  return channel.startsWith('realtime:') ? channel.slice('realtime:'.length) : channel
}
