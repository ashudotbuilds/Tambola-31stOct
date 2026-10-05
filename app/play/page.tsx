'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CodeChip, ConnectionDot, StatusPill } from '@/components/Chrome'
import { ClaimButtons } from '@/components/ClaimButtons'
import { Leaderboard } from '@/components/Leaderboard'
import { NumberBoard } from '@/components/NumberBoard'
import { Ticket } from '@/components/Ticket'
import { sessions, submitClaim } from '@/lib/api'
import { claimLabel } from '@/lib/claims'
import { play } from '@/lib/sound'
import type { ClaimType, PlayerSession } from '@/lib/types'
import { cutSet, deriveMarked, useGameRoom } from '@/hooks/useGameRoom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { ThemeToggle, useTheme } from '@/lib/theme'

interface Toast {
  id: number
  tone: 'good' | 'bad' | 'info'
  text: string
}

export default function PlayerScreen() {
  const router = useRouter()
  const { theme } = useTheme()
  const [session, setSession] = useState<PlayerSession | null>(null)
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  const [playerMarked, setPlayerMarked] = useState<Set<number>>(new Set())
  const [showNumbersOnly, setShowNumbersOnly] = useState(false)

  useEffect(() => {
    const stored = sessions.loadPlayer()
    if (!stored) {
      router.replace('/')
      return
    }
    setSession(stored)
    setReady(true)

    // Load persisted local player marks
    try {
      const saved = localStorage.getItem(`tt.marked.${stored.game_id}.${stored.player_id}`)
      if (saved) {
        setPlayerMarked(new Set(JSON.parse(saved)))
      }
    } catch {
      // ignore
    }
  }, [router])

  const pushToast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-2), { id, tone, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200)
  }, [])

  const refreshRef = useRef<() => Promise<void>>(async () => {})

  const room = useGameRoom(session?.game_id ?? null, session?.player_token ?? null, {
    onSelfCut: () => {
      void refreshRef.current()
      pushToast('bad', 'A number on your ticket was cut')
    },
  })
  refreshRef.current = room.refresh

  const state = room.state
  const me = state?.me ?? null
  const cut = useMemo(() => cutSet(me), [me])
  const customBank = (state?.settings?.custom_bank as TechnicalItem[]) ?? null

  // Server-confirmed marks
  const serverMarked = useMemo(
    () => deriveMarked(me?.ticket, room.calledNumbers, cut),
    [me?.ticket, room.calledNumbers, cut],
  )

  // Revealed calls from host settings
  const revealedSeqs = useMemo(
    () => new Set(state?.settings?.revealed_seqs ?? []),
    [state?.settings?.revealed_seqs],
  )

  const revealedNumbers = useMemo(() => {
    const set = new Set<number>()
    for (const call of state?.calls ?? []) {
      if (revealedSeqs.has(call.seq)) {
        set.add(call.number)
      }
    }
    return set
  }, [state?.calls, revealedSeqs])

  // Automatically keep playerMarked up-to-date with serverMarked
  useEffect(() => {
    if (serverMarked.size === 0) return
    setPlayerMarked((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const n of serverMarked) {
        if (!next.has(n)) {
          next.add(n)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [serverMarked])

  // Save playerMarked to localStorage
  const handleToggleCell = useCallback(
    (cell: number) => {
      if (!session) return
      setPlayerMarked((prev) => {
        const next = new Set(prev)
        if (next.has(cell)) {
          next.delete(cell)
        } else {
          next.add(cell)
          play('call')
        }
        try {
          localStorage.setItem(
            `tt.marked.${session.game_id}.${session.player_id}`,
            JSON.stringify(Array.from(next)),
          )
        } catch {
          // ignore
        }
        return next
      })
    },
    [session],
  )

  const onClaim = useCallback(
    async (claim: ClaimType) => {
      if (!session || busy) return
      setBusy(true)
      const result = await submitClaim(session.game_id, session.player_token, claim)
      setBusy(false)

      if (result.accepted) {
        play('accept')
        pushToast('good', `${claimLabel(claim)} accepted  +${result.points}`)
        void room.refresh()
      } else if (result.penalty) {
        play('reject')
        const cutInfo = result.cut ? ` · ${result.cut} was cut` : ''
        pushToast('bad', `${claimLabel(claim)} rejected  −${result.penalty}${cutInfo}`)
        void room.refresh()
      } else if (result.reason) {
        play('reject')
        pushToast('info', result.reason)
      }
    },
    [session, busy, room, pushToast],
  )

  if (!ready) return null

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">No ticket on this device</h1>
        <p className="text-sm text-slate-400">Join a game first, then come back to your ticket.</p>
        <Link href="/" className="btn btn-primary">
          Join a game
        </Link>
      </main>
    )
  }

  const status = state?.status ?? 'lobby'
  const call = room.lastCall
  const callItem = call ? getTechnicalItem(call.number, customBank) : null
  const isCallRevealed = call ? revealedSeqs.has(call.seq) : false

  // All pending unrevealed calls for this round
  const pendingCalls = (state?.calls ?? []).filter((c) => !revealedSeqs.has(c.seq))

  const isLight = theme === 'light'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan">
              {me?.name ?? session.display_name}
            </p>
            <h1 className="text-xl font-black">Your Technical Ticket</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <StatusPill status={status} />
          <ConnectionDot connection={room.connection} />
        </div>
      </header>

      {room.error && (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-sm text-rose">
          {room.error}
        </p>
      )}

      {/* Game info bar */}
      <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="label mb-1">Game Code</p>
          <CodeChip code={session.code} className="text-lg sm:text-xl" />
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowNumbersOnly((prev) => !prev)}
            className="text-[11px] font-semibold underline text-slate-400 hover:text-cyan"
            title="Toggle between technical terms and 1-90 numbers"
          >
            {showNumbersOnly ? 'Show Technical Terms' : 'Show Numbers'}
          </button>
          <div className="text-right">
            <p className="label mb-1">Score</p>
            <p className="text-3xl font-black tabular-nums text-lime">{me?.score ?? 0}</p>
            <p className="text-[11px] text-slate-500">
              {room.myRank
                ? `rank ${room.myRank} of ${(state?.players ?? []).filter((p) => !p.is_host).length}`
                : '—'}
              {me && me.wrong_claims > 0 ? ` · ${me.wrong_claims} cut` : ''}
            </p>
          </div>
        </div>
      </section>

      {/* Active Question / Clue Stage */}
      {call && callItem && (
        <section
          className={`card relative overflow-hidden p-4 sm:p-5 border transition-all ${
            isCallRevealed
              ? isLight
                ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
                : 'border-cyan/50 bg-cyan/10'
              : isLight
                ? 'border-amber-300 bg-amber-50/70 shadow-sm'
                : 'border-amber/50 bg-amber/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/30 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-ink/70 text-slate-300">
                Call #{call.seq}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                {callItem.category}
              </span>
            </div>

            {isCallRevealed ? (
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-lime">
                ✓ Answer Revealed
              </span>
            ) : (
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber animate-pulse">
                Solve & Tap Your Ticket!
              </span>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {callItem.clue || call.clue}
            </p>

            {callItem.codeSnippet && (
              <pre
                className={`p-2.5 rounded-lg text-xs font-mono overflow-x-auto ${
                  isLight ? 'bg-slate-900 text-emerald-400' : 'bg-black/80 text-lime'
                }`}
              >
                {callItem.codeSnippet}
              </pre>
            )}

            {isCallRevealed ? (
              <div className="mt-3 flex items-center gap-3 pt-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Answer:
                </span>
                <span className="text-xl sm:text-2xl font-black text-cyan">
                  {callItem.term}
                </span>
                <span className="text-xs font-mono text-slate-400">(#{call.number})</span>
              </div>
            ) : (
              <p className="text-xs italic text-slate-500 pt-1">
                The host has not revealed the answer yet. If you know it, find and tap it on your ticket!
              </p>
            )}
          </div>
        </section>
      )}

      {/* Clubbed questions queue if multiple are pending */}
      {pendingCalls.length > 1 && (
        <details className="card p-3 text-xs">
          <summary className="font-bold text-amber cursor-pointer">
            📋 {pendingCalls.length} questions currently active in this round (Click to view all)
          </summary>
          <div className="mt-2.5 space-y-2">
            {pendingCalls.map((c) => {
              const it = getTechnicalItem(c.number, customBank)
              return (
                <div key={c.seq} className="p-2 rounded bg-ink/40 border border-edge/60">
                  <span className="font-mono font-bold text-cyan mr-2">#{c.seq}:</span>
                  <span>{it.clue || c.clue}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* The Technical Tambola Ticket */}
      <Ticket
        ticket={me?.ticket ?? null}
        marked={serverMarked}
        cut={cut}
        playerMarked={playerMarked}
        revealedNumbers={revealedNumbers}
        latest={call?.number ?? null}
        customBank={customBank}
        onToggleCell={handleToggleCell}
        showNumbersOnly={showNumbersOnly}
      />

      {/* Claim Buttons */}
      {status === 'lobby' ? (
        <p className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-3 text-center text-sm text-amber">
          Waiting for the host to start the game.
        </p>
      ) : (
        <ClaimButtons
          ticket={me?.ticket ?? null}
          marked={serverMarked}
          cut={cut}
          state={state}
          won={room.wonClaims}
          taken={room.takenClaims}
          busy={busy}
          onClaim={onClaim}
        />
      )}

      {/* Called Numbers Board */}
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider text-slate-300">
          All 90 Technical Items Board
        </summary>
        <div className="mt-3">
          <NumberBoard called={room.calledNumbers} latest={call?.number ?? null} compact />
        </div>
      </details>

      {/* Standings */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
        <Leaderboard players={state?.players ?? []} meId={me?.player_id} limit={8} dense />
      </section>

      {/* Floating toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role="status"
            className={[
              'pointer-events-auto w-full max-w-sm animate-pop rounded-xl border px-4 py-3 text-center text-sm font-semibold shadow-lg backdrop-blur',
              toast.tone === 'good'
                ? 'border-lime/70 bg-lime/20 text-lime'
                : toast.tone === 'bad'
                  ? 'border-rose/70 bg-rose/20 text-rose'
                  : 'border-edge bg-panel/90 text-slate-200',
            ].join(' ')}
          >
            {toast.text}
          </p>
        ))}
      </div>
    </main>
  )
}
