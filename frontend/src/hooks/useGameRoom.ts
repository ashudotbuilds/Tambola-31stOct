import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_URL, SOCKET_OPTIONS } from '@/lib/config'
import { getGameState, getGameUpdates } from '@/lib/api'
import type { CallRow, ClaimResultEvent, ClaimType, GameState, NumberCalledEvent, StatusChangedEvent, TicketUpdatedEvent } from '@/lib/types'

export type Connection = 'connecting' | 'live' | 'offline'
export interface RoomHandlers {
  onCall?: (event: NumberCalledEvent) => void
  onClaim?: (event: ClaimResultEvent) => void
  onStatus?: (event: StatusChangedEvent) => void
  onSelfCut?: (event: TicketUpdatedEvent) => void
}
export interface Room {
  state: GameState | null
  loading: boolean
  error: string | null
  connection: Connection
  connected: number
  refresh: () => Promise<void>
  calledNumbers: Set<number>
  lastCall: CallRow | null
  myRank: number | null
  wonClaims: Set<ClaimType>
  takenClaims: Set<ClaimType>
}

/** One request at a time; updates omit the static bank/ticket and old calls. */
export function useGameRoom(gameId: string | null, token: string | null | undefined, handlers: RoomHandlers = {}): Room {
  const [state, setState] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [connected, setConnected] = useState(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const loader = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(() => loader.current(), [])

  useEffect(() => {
    let active = true, deleted = false, live = false, pending = false, fullPending = false, roomSeen = false
    let current: GameState | null = null
    let flight: Promise<void> | null = null
    setState(null); setError(null); setLoading(Boolean(gameId)); setConnected(0); setConnection('connecting')
    if (!gameId) { loader.current = async () => {}; return }
    const notify = (next: GameState) => {
      const before = current
      current = next; setState(next); setError(null)
      if (!before) return
      for (const call of next.calls.filter(c => !before.calls.some(old => old.seq === c.seq))) handlersRef.current.onCall?.({ game_id: gameId, ...call })
      for (const claim of next.claims.filter(c => !before.claims.some(old => old.id === c.id))) handlersRef.current.onClaim?.({ game_id: gameId, ...claim })
      if (before.status !== next.status) handlersRef.current.onStatus?.({ game_id: gameId, status: next.status })
      if (next.me?.cut.some(n => !before.me?.cut.includes(n))) handlersRef.current.onSelfCut?.({ game_id: gameId, player_id: next.me.player_id })
    }
    const load = (full = false): Promise<void> => {
      if (!active || deleted || !navigator.onLine) return Promise.resolve()
      pending = true; fullPending ||= full
      if (flight) return flight
      flight = (async () => {
        while (active && !deleted && pending) {
          pending = false
          const initial = current
          const useFull = fullPending || !initial
          fullPending = false
          try {
            let next: GameState
            if (useFull || !initial) next = await getGameState(gameId, token)
            else {
              const update = await getGameUpdates(gameId, initial.calls.at(-1)?.seq ?? 0, token)
              next = { ...update, settings: { ...update.settings, custom_bank: initial.settings.custom_bank },
                calls: [...initial.calls, ...update.calls],
                me: update.me && initial.me ? { ...update.me, ticket: initial.me.ticket } : null }
            }
            if (active && !deleted) notify(next)
          } catch (cause) {
            fullPending ||= useFull
            if (active && !deleted) setError(cause instanceof Error ? cause.message : 'Could not load the game')
          } finally { if (active) setLoading(false) }
        }
      })().finally(() => { flight = null })
      return flight
    }
    loader.current = () => load()
    void load(true)
    const socket = io(API_URL, { ...SOCKET_OPTIONS, withCredentials: true, auth: { gameId, ...(token ? { token } : {}) } })
    socket.on('connect', () => setConnection('connecting'))
    socket.on('room_ready', () => { live = true; setConnection('live'); void load(roomSeen); roomSeen = true })
    socket.on('disconnect', () => { live = false; setConnection('offline') })
    socket.on('connect_error', () => { live = false; setConnection('offline') })
    socket.on('presence', (count: number) => setConnected(count))
    socket.on('game_changed', (event?: { full?: boolean }) => { void load(event?.full) })
    socket.on('game_deleted', () => {
      deleted = true
      setState(value => value ? { ...value, status: 'finished' } : value)
      setError('This game was deleted by its administrator.')
    })
    // Safety reconciliation once a minute while live; 15 seconds when degraded.
    let elapsed = 0
    const timer = setInterval(() => {
      elapsed += 5_000
      if (document.visibilityState !== 'visible' || current?.status === 'finished') return
      if (elapsed >= (live ? 60_000 : 15_000)) { elapsed = 0; void load(!live) }
    }, 5_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    const onOnline = () => { socket.connect(); void load() }
    const onOffline = () => { live = false; setConnection('offline') }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      active = false; clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      socket.removeAllListeners(); socket.disconnect()
    }
  }, [gameId, token])

  return useMemo(() => {
    const meId = state?.me?.player_id
    const accepted = (state?.claims ?? []).filter(c => c.status === 'accepted')
    const index = state?.players.filter(p => !p.is_host).findIndex(p => p.id === meId) ?? -1
    return { state, loading, error, connection, connected, refresh,
      calledNumbers: new Set((state?.calls ?? []).map(c => c.number)), lastCall: state?.calls.at(-1) ?? null,
      myRank: index >= 0 ? index + 1 : null,
      wonClaims: new Set(accepted.filter(c => c.player_id === meId).map(c => c.claim_type)),
      takenClaims: new Set(accepted.map(c => c.claim_type)) }
  }, [state, loading, error, connection, connected, refresh])
}
export function cutSet(me: GameState['me']): Set<number> { return new Set(me?.cut ?? []) }
