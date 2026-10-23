import { API_URL } from './config'

async function idempotencyIdentity(method: string, path: string, body: unknown) {
  const critical = method === 'POST' && path === '/v1/admin/participants/import'
  if (!critical) return null
  const storageKey = `tt.idempotency.${method}.${path}`
  const source = `${method}:${path}:${JSON.stringify(body ?? null)}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const signature = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  let stored: { signature: string; key: string } | null = null
  try { stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { signature: string; key: string } | null } catch { stored = null }
  const current = stored?.signature === signature ? stored : { signature, key: crypto.randomUUID() }
  try {
    localStorage.setItem(storageKey, JSON.stringify(current))
    return { storageKey, ...current, persisted: true }
  } catch {
    return { storageKey, ...current, persisted: false }
  }
}

export async function request<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    bodyFormat?: 'json' | 'text'
    token?: string | null
    headers?: Record<string, string>
    credentials?: RequestCredentials
  } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  const method = options.method ?? 'GET'
  try {
    const identity = await idempotencyIdentity(method, path, options.body)
    const response = await fetch(`${API_URL}/api${path}`, {
      method,
      credentials: options.credentials ?? 'include',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': options.bodyFormat === 'text' ? 'text/plain' : 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(identity ? { 'Idempotency-Key': identity.key } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : options.bodyFormat === 'text' ? String(options.body) : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.ok === false) {
      const message = typeof result?.error === 'string' ? result.error : result?.error?.message
      throw new Error(message ?? `Request failed (${response.status})`)
    }
    if (!result) throw new Error('The server returned an empty response')
    if (identity?.persisted) {
      try {
        const current = JSON.parse(localStorage.getItem(identity.storageKey) ?? 'null') as { signature?: string; key?: string } | null
        if (current?.signature === identity.signature && current.key === identity.key) localStorage.removeItem(identity.storageKey)
      } catch { /* A storage failure must not change the completed server action. */ }
    }
    return result as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The server took too long. Please try again.')
    throw error
  } finally { clearTimeout(timeout) }
}
