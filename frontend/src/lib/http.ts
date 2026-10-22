import { API_URL } from './config'

export async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${API_URL}/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.ok === false) throw new Error(result?.error ?? `Request failed (${response.status})`)
    if (!result) throw new Error('The server returned an empty response')
    return result as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The server took too long. Please try again.')
    throw error
  } finally { clearTimeout(timeout) }
}
