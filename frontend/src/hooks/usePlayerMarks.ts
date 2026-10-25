import { useCallback, useEffect, useRef, useState } from 'react'
import { setPlayerMarks } from '@/lib/api'
import { MarkSaver, type MarkSaveStatus } from '@/lib/markSaver'
import { play } from '@/lib/sound'
import type { GameState, PlayerSession } from '@/lib/types'

/** Manual marks stay instant. Only unsaved snapshots are stored on this device. */
export function usePlayerMarks(session: PlayerSession | null, me: GameState['me'], connection: string, enabled: boolean) {
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [saveStatus, setSaveStatus] = useState<MarkSaveStatus>('saved')
  const latest = useRef(new Set<number>())
  const saver = useRef<MarkSaver | null>(null)
  const draftKey = session && me ? `tt.pending-marks:${session.game_id}:${me.player_id}` : null
  const initial = useRef(me)
  initial.current = me

  useEffect(() => {
    if (!session || !draftKey || !initial.current) return
    let active = true
    const player = initial.current
    const allowed = new Set(player.ticket.flat().filter((n): n is number => n !== null && !player.cut.includes(n)))
    let draft: number[] | null = null
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null')
      if (Array.isArray(stored) && stored.every(n => Number.isInteger(n))) draft = stored.filter(n => allowed.has(n))
    } catch { /* Storage can be unavailable; in-memory recovery still works. */ }
    latest.current = new Set((draft ?? player.marked).filter(n => allowed.has(n)))
    setMarked(new Set(latest.current)); setSaveStatus('saved')
    const writer = new MarkSaver({
      send: values => setPlayerMarks(session.game_id, session.player_token, values),
      online: () => navigator.onLine,
      status: value => { if (active) setSaveStatus(value) },
      saved: values => {
        try { if (localStorage.getItem(draftKey) === JSON.stringify(values)) localStorage.removeItem(draftKey) } catch { /* Optional local recovery. */ }
      },
    })
    saver.current = writer
    if (draft) writer.update([...latest.current])
    const retry = () => { void writer.flush().catch(() => {}) }
    const visible = () => { if (document.visibilityState === 'visible') retry() }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false; writer.dispose(); if (saver.current === writer) saver.current = null
      window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', visible)
    }
  }, [session, draftKey])

  useEffect(() => { if (connection === 'live') void saver.current?.flush().catch(() => {}) }, [connection])

  const persist = useCallback((next: Set<number>) => {
    latest.current = next; setMarked(new Set(next))
    try { if (draftKey) localStorage.setItem(draftKey, JSON.stringify([...next])) } catch { /* Continue saving to the API. */ }
    saver.current?.update([...next])
  }, [draftKey])

  useEffect(() => {
    if (!me || !enabled || !me.cut.some(n => latest.current.has(n))) return
    persist(new Set([...latest.current].filter(n => !me.cut.includes(n))))
  }, [me, enabled, persist])

  const toggle = useCallback((cell: number) => {
    if (!session || !me || !enabled || me.cut.includes(cell)) return
    const next = new Set(latest.current)
    if (next.has(cell)) { next.delete(cell); play('reject') }
    else { next.add(cell); play('call') }
    persist(next)
  }, [session, me, enabled, persist])

  const sync = useCallback(async () => { await saver.current?.flush() }, [])
  return { marked, toggle, sync, saveStatus }
}
