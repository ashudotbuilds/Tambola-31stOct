import { useCallback, useEffect, useRef, useState } from 'react'
import { setPlayerMarks } from '@/lib/api'
import { play } from '@/lib/sound'
import type { GameState, PlayerSession } from '@/lib/types'

/** Instant manual selection; ordered saves are handled by the API client. */
export function usePlayerMarks(session: PlayerSession | null, me: GameState['me'], onError: (message: string) => void) {
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const latest = useRef(new Set<number>())
  const restored = useRef<string | null>(null)
  const errorRef = useRef(onError)
  errorRef.current = onError
  useEffect(() => {
    if (!me) return
    if (restored.current !== me.player_id) {
      restored.current = me.player_id
      latest.current = new Set(me.marked.filter(n => !me.cut.includes(n)))
      setMarked(latest.current)
    } else if (me.cut.some(n => latest.current.has(n))) {
      latest.current = new Set([...latest.current].filter(n => !me.cut.includes(n)))
      setMarked(latest.current)
    }
  }, [me])

  const toggle = useCallback((cell: number) => {
    if (!session || !me || me.cut.includes(cell)) return
    const next = new Set(latest.current)
    if (next.has(cell)) { next.delete(cell); play('reject') }
    else { next.add(cell); play('call') }
    latest.current = next
    setMarked(next)
    void setPlayerMarks(session.game_id, session.player_token, [...next])
      .catch(() => errorRef.current('Your marks could not be saved. Check your connection and tap again.'))
  }, [session, me])

  const sync = useCallback(async () => {
    if (session) await setPlayerMarks(session.game_id, session.player_token, [...latest.current])
  }, [session])
  return { marked, toggle, sync }
}
