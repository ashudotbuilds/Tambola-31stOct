const value = import.meta.env.VITE_API_URL?.trim()
export const API_URL = (value || (import.meta.env.DEV ? 'http://localhost:3001' : '')).replace(/\/+$/, '')
export function isConfigured(): boolean {
  try { return ['http:', 'https:'].includes(new URL(API_URL).protocol) } catch { return false }
}
