'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { insforge } from '@/lib/insforge'
import { channelOf } from '@/lib/channel'
import { getGameState } from '@/lib/api'
import { hasNumber } from '@/lib/claims'
import type {
  CallRow,
  ClaimResultEvent,
  ClaimRow,
  ClaimType,
  GameState,
  NumberCalledEvent,
  PlayerJoinedEvent,
  ScoreboardEvent,
  StatusChangedEvent,
  TicketUpdatedEvent,
} from '@/lib/types'

export type Connection = 'connecting' | 'live' | 'offline'

export interface RoomHandlers {
  onCall?: (event: NumberCalledEvent) => void
  onClaim?: (event: ClaimResultEvent) => void
  onStatus?: (event: StatusChangedEvent) => void
  /** Fired when the signed-in player gets a number cut, so the UI can react. */
  onSelfCut?: (event: TicketUpdatedEvent) => void
}

export interface Room {
  state: GameState | null
  loading: boolean
  error: string | null
  connection: Connection
  /** Devices currently subscribed to the game channel. */
  connected: number
  refresh: () => Promise<void>
  calledNumbers: Set<number>
  lastCall: CallRow | null
  myRank: number | null
  wonClaims: Set<ClaimType>
  /** Claim types already taken by somebody, so the UI can grey them out. */
  takenClaims: Set<ClaimType>
}

/**
 * Subscribe to one game room.
 *
 * The channel is a pure event feed: it carries no ticket data. Anything private
 * is fetched through get_game_state with the caller's own token.
 */
export function useGameRoom(
  gameId: string | null,
  token: string | null | undefined,
  handlers: RoomHandlers = {},
): Room {
  const [state, setState] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [connected, setConnected] = useState(0)

  // Keep the latest handlers without re-subscribing on every render.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // Events are addressed by player id, not by the secret token the client
  // holds, so remember which player this device is once the state lands.
  const meIdRef = useRef<string | null>(null)
  meIdRef.current = state?.me?.player_id ?? null

  const channel = gameId ? `game:${gameId}` : null

  const load = useCallback(async () => {
    if (!gameId) return
    try {
      const next = await getGameState(gameId, token ?? null)
      setState(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the game')
    } finally {
      setLoading(false)
    }
  }, [gameId, token])

  useEffect(() => {
    if (!gameId) {
      setLoading(false)
      return
    }
    void load()
  }, [load, gameId])

  useEffect(() => {
    if (!channel) return
    let disposed = false
    const bus = insforge.realtime

    const on = (event: string, handler: (payload: never) => void) => {
      bus.on(event, handler as never)
      return () => bus.off(event, handler as never)
    }

    // Wrap a payload so handlers only see events for this game's channel.
    const guard =
      <T,>(fn: (event: T) => void) =>
      (payload: T & { meta?: { channel?: string } }) => {
        if (disposed) return
        const from = channelOf(payload)
        if (from && from !== channel) return
        fn(payload)
      }

    const offs: (() => void)[] = []

    const start = async () => {
      setConnection('connecting')
      try {
        await bus.connect()

        const res = await bus.subscribe(channel)
        if (disposed) return
        if (!res.ok) {
          setConnection('offline')
          setError(res.error?.message ?? 'Could not join the live channel')
          return
        }
        setConnected(res.presence?.members?.length ?? 0)
        setConnection('live')

        // The server commits the subscription a moment after subscribe() resolves,
        // so anything published during the handshake would be missed. Refetching
        // once the socket is live closes that window.
        void load()

        offs.push(
          on('number_called', guard<NumberCalledEvent>((event) => {
            setState((prev) => {
              if (!prev || event.seq <= prev.calls.length) return prev
              const call: CallRow = {
                seq: event.seq,
                number: event.number,
                clue: event.clue,
                called_at: event.called_at,
              }
              return { ...prev, calls: [...prev.calls, call] }
            })
            handlersRef.current.onCall?.(event)
          })),
        )

        offs.push(
          on('claim_result', guard<ClaimResultEvent>((event) => {
            setState((prev) => {
              if (!prev) return prev
              if (prev.claims.some((c) => c.id === event.id)) return prev
              const claim: ClaimRow = {
                id: event.id,
                player_id: event.player_id,
                name: event.name,
                claim_type: event.claim_type,
                status: event.status,
                points: event.points,
                reason: event.reason,
                created_at: event.created_at,
              }
              return { ...prev, claims: [...prev.claims, claim] }
            })
            handlersRef.current.onClaim?.(event)
          })),
        )

        offs.push(
          on('scoreboard', guard<ScoreboardEvent>((event) => {
            setState((prev) => {
              if (!prev) return prev
              const scores = new Map(event.players.map((p) => [p.id, p.score]))
              return {
                ...prev,
                players: prev.players.map((p) =>
                  scores.has(p.id) ? { ...p, score: scores.get(p.id) as number } : p,
                ),
              }
            })
          })),
        )

        offs.push(
          on('status_changed', guard<StatusChangedEvent>((event) => {
            setState((prev) => (prev ? { ...prev, status: event.status } : prev))
            handlersRef.current.onStatus?.(event)
          })),
        )

        offs.push(
          on('player_joined', guard<PlayerJoinedEvent>((event) => {
            setState((prev) =>
              prev
                ? {
                    ...prev,
                    players: prev.players.some((p) => p.id === event.player_id)
                      ? prev.players
                      : [
                          ...prev.players,
                          {
                            id: event.player_id,
                            name: event.name,
                            is_host: event.is_host,
                            score: 0,
                            wrong_claims: 0,
                          },
                        ],
                  }
                : prev,
            )
          })),
        )

        // A cut only ever affects one player, so only that player refetches.
        // tickets.player_id is a game_players.id, never the secret token.
        offs.push(
          on('ticket_updated', guard<TicketUpdatedEvent>((event) => {
            if (event.player_id === meIdRef.current) {
              handlersRef.current.onSelfCut?.(event)
            } else if (!meIdRef.current && token) {
              // State has not landed yet, so the cut cannot be attributed.
              void load()
            }
          })),
        )

        // The subscribe() snapshot is a point in time, so keep the device
        // counter in step with the presence deltas that follow it.
        const syncPresence = () => {
          if (!disposed) setConnected(bus.getPresenceState(channel).length)
        }
        offs.push(on('presence:join', guard(syncPresence)))
        offs.push(on('presence:leave', guard(syncPresence)))

        const markOffline = () => {
          if (!disposed) setConnection('offline')
        }
        const markLive = () => {
          if (disposed) return
          setConnection('live')
          // A reconnect hands back a fresh snapshot, so re-read the headcount.
          setConnected(bus.getPresenceState(channel).length)
        }
        bus.on('connect', markLive as never)
        bus.on('disconnect', markOffline as never)
        bus.on('connect_error', markOffline as never)
        offs.push(() => {
          bus.off('connect', markLive as never)
          bus.off('disconnect', markOffline as never)
          bus.off('connect_error', markOffline as never)
        })
      } catch (err) {
        if (!disposed) {
          setConnection('offline')
          setError(err instanceof Error ? err.message : 'Live connection failed')
        }
      }
    }

    void start()

    return () => {
      disposed = true
      for (const off of offs) off()
      try {
        bus.unsubscribe(channel)
        bus.disconnect()
      } catch {
        // Teardown is best effort.
      }
    }
  }, [channel, token, load])

  const calledNumbers = useMemo(
    () => new Set((state?.calls ?? []).map((c) => c.number)),
    [state?.calls],
  )

  const lastCall = useMemo(() => {
    const calls = state?.calls
    return calls && calls.length > 0 ? calls[calls.length - 1] : null
  }, [state?.calls])

  const wonClaims = useMemo(() => {
    const meId = state?.me?.player_id
    const won = new Set<ClaimType>()
    for (const claim of state?.claims ?? []) {
      if (claim.status === 'accepted' && claim.player_id === meId) won.add(claim.claim_type)
    }
    return won
  }, [state?.claims, state?.me?.player_id])

  const takenClaims = useMemo(() => {
    const taken = new Set<ClaimType>()
    for (const claim of state?.claims ?? []) {
      if (claim.status === 'accepted') taken.add(claim.claim_type)
    }
    return taken
  }, [state?.claims])

  const myRank = useMemo(() => {
    const players = state?.players ?? []
    const meId = state?.me?.player_id
    const index = players.findIndex((p) => p.id === meId)
    return index >= 0 ? index + 1 : null
  }, [state?.players, state?.me?.player_id])

  return {
    state,
    loading,
    error,
    connection,
    connected,
    refresh: load,
    calledNumbers,
    lastCall,
    myRank,
    wonClaims,
    takenClaims,
  }
}

/** Marked cells derived from the call history, so daubing is instant. */
export function deriveMarked(
  ticket: (number | null)[][] | null | undefined,
  called: ReadonlySet<number>,
  cut: ReadonlySet<number>,
): Set<number> {
  const marked = new Set<number>()
  if (!ticket) return marked
  for (const row of ticket) {
    for (const cell of row) {
      if (cell !== null && called.has(cell) && !cut.has(cell)) marked.add(cell)
    }
  }
  return marked
}

export function cutSet(me: GameState['me']): Set<number> {
  return new Set(me?.cut ?? [])
}
