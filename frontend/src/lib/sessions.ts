import type { HostSession, PlayerSession } from './types'

// Fresh infrastructure uses a fresh namespace; old tokens cannot resume.
const HOST_KEY = 'tt.v2.host'
const PLAYER_KEY = 'tt.v2.player'
function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
export const sessions = {
  loadHost: () => read<HostSession>(HOST_KEY),
  loadPlayer: () => read<PlayerSession>(PLAYER_KEY),
  saveHost: (session: HostSession) => localStorage.setItem(HOST_KEY, JSON.stringify(session)),
  savePlayer: (session: PlayerSession) => localStorage.setItem(PLAYER_KEY, JSON.stringify(session)),
  clearHost: () => localStorage.removeItem(HOST_KEY),
  clearPlayer: () => localStorage.removeItem(PLAYER_KEY),
}
