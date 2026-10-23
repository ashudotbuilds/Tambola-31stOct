import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '@/lib/config'
import { getGameState } from '@/lib/api'
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

/** Public invalidations trigger a private state fetch. No tickets are broadcast. */
export function useGameRoom(gameId: string | null, token: string | null | undefined, handlers: RoomHandlers = {}): Room {
  const [state, setState] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [connected, setConnected] = useState(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const previous = useRef<GameState | null>(null)
  const requestId = useRef(0)
  const active = useRef(true)
  const load = useCallback(async () => {
    if (!gameId) return
    const id = ++requestId.current
    try {
      const next = await getGameState(gameId, token)
      if (!active.current || id !== requestId.current) return
      const before = previous.current
      previous.current = next
      setState(next)
      setError(null)
      if (before) {
        for (const call of next.calls.filter(c => !before.calls.some(old => old.seq === c.seq))) handlersRef.current.onCall?.({ game_id: gameId, ...call })
        for (const claim of next.claims.filter(c => !before.claims.some(old => old.id === c.id))) handlersRef.current.onClaim?.({ game_id: gameId, ...claim })
        if (before.status !== next.status) handlersRef.current.onStatus?.({ game_id: gameId, status: next.status })
        if (next.me && next.me.cut.some(n => !before.me?.cut.includes(n))) handlersRef.current.onSelfCut?.({ game_id: gameId, player_id: next.me.player_id })
      }
    } catch (err) {
      if (active.current && id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load the game')
    } finally {
      if (active.current && id === requestId.current) setLoading(false)
    }
  }, [gameId, token])

  useEffect(() => {
    active.current = true
    previous.current = null
    setState(null)
    setError(null)
    setLoading(Boolean(gameId))
    setConnected(0)
    if (!gameId) return
    void load()
    const socket = io(API_URL, { withCredentials: true, auth: { gameId, ...(token ? { token } : {}) } })
    socket.on('connect', () => setConnection('connecting'))
    socket.on('room_ready', () => { setConnection('live'); void load() })
    socket.on('disconnect', () => setConnection('offline'))
    socket.on('connect_error', () => setConnection('offline'))
    socket.on('presence', (count: number) => setConnected(count))
    socket.on('game_changed', () => { void load() })
    const timer = setInterval(() => { void load() }, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active.current = false
      requestId.current++
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [gameId, token, load])

  return useMemo(() => {
    const meId = state?.me?.player_id
    const accepted = (state?.claims ?? []).filter(c => c.status === 'accepted')
    const index = state?.players.filter(p => !p.is_host).findIndex(p => p.id === meId) ?? -1
    return { state, loading, error, connection, connected, refresh: load,
      calledNumbers: new Set((state?.calls ?? []).map(c => c.number)), lastCall: state?.calls.at(-1) ?? null,
      myRank: index >= 0 ? index + 1 : null,
      wonClaims: new Set(accepted.filter(c => c.player_id === meId).map(c => c.claim_type)),
      takenClaims: new Set(accepted.map(c => c.claim_type)) }
  }, [state, loading, error, connection, connected, load])
}
export function cutSet(me: GameState['me']): Set<number> { return new Set(me?.cut ?? []) }
