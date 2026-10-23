const value = import.meta.env.VITE_API_URL?.trim()
export const API_URL = (import.meta.env.DEV ? value || 'http://localhost:3001' : window.location.origin).replace(/\/+$/, '')
// HTTP polling carries the same live Socket.IO events through the deployment
// proxy without requiring a WebSocket upgrade at the frontend host.
export const SOCKET_OPTIONS = import.meta.env.DEV ? {} : { transports: ['polling'], upgrade: false }
export function isConfigured(): boolean {
  try { return ['http:', 'https:'].includes(new URL(API_URL).protocol) } catch { return false }
}
