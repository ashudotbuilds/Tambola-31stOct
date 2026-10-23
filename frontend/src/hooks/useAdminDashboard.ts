import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { getAdminDashboard, listAccountGames, type AdminDashboard } from '@/lib/api'
import { API_URL, SOCKET_OPTIONS } from '@/lib/config'

export function useAdminDashboard(enabled: boolean) {
  const [games, setGames] = useState<Awaited<ReturnType<typeof listAccountGames>>['games']>([])
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    if (!enabled) return
    let active = true
    let running = false
    let pending = false
    async function load() {
      if (running) { pending = true; return }
      running = true
      do {
        pending = false
        try {
          const [catalogue, summary] = await Promise.all([listAccountGames(), getAdminDashboard()])
          if (active) { setGames(catalogue.games); setDashboard(summary); setError(null) }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'Could not refresh dashboard')
        } finally { if (active) setLoading(false) }
      } while (active && pending)
      running = false
    }
    const update = () => { if (active) void load() }
    refreshRef.current = update
    const socket = io(API_URL, { ...SOCKET_OPTIONS, withCredentials: true, auth: { channel: 'admin-dashboard' } })
    socket.on('room_ready', update)
    socket.on('dashboard_changed', update)
    const visible = () => { if (document.visibilityState === 'visible') update() }
    const timer = window.setInterval(visible, 15000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', visible)
    update()
    return () => {
      active = false
      refreshRef.current = () => {}
      socket.disconnect()
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [enabled])
  return { games, dashboard, error, loading, refresh }
}
