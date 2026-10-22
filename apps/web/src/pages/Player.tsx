import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { CodeChip, ConnectionDot, StatusPill } from '@/components/Chrome'
import { ClaimButtons } from '@/components/ClaimButtons'
import { Leaderboard } from '@/components/Leaderboard'
import { Ticket } from '@/components/Ticket'
import { LobbyTutorialSimulator } from '@/components/LobbyTutorialSimulator'
import { sessions, submitClaim } from '@/lib/api'
import { usePlayerMarks } from '@/hooks/usePlayerMarks'
import { claimLabel } from '@/lib/claims'
import { play } from '@/lib/sound'
import type { ClaimType, PlayerSession } from '@/lib/types'
import { cutSet, useGameRoom } from '@/hooks/useGameRoom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { ThemeToggle, useTheme } from '@/lib/theme'

interface Toast {
  id: number
  tone: 'good' | 'bad' | 'info'
  text: string
}

export default function PlayerScreen() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const [session, setSession] = useState<PlayerSession | null>(null)
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  const [showNumbersOnly, setShowNumbersOnly] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const stored = sessions.loadPlayer()
    if (!stored) {
      navigate('/', { replace: true })
      return
    }
    setSession(stored)
    setReady(true)

  }, [navigate])

  // Track scroll position to show sticky mobile clue banner
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 280)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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

  const { marked: playerMarked, toggle: handleToggleCell, sync: syncMarks } = usePlayerMarks(
    session, me, (message) => pushToast('bad', message),
  )

  // Revealed calls from host settings
  const revealedSeqs = useMemo(
    () => new Set(state?.settings?.revealed_seqs ?? []),
    [state?.settings?.revealed_seqs],
  )

  const onClaim = useCallback(
    async (claim: ClaimType) => {
      if (!session || busy) return
      setBusy(true)
      try {
        await syncMarks()
      } catch {
        setBusy(false)
        pushToast('bad', 'Could not save your marks. Please reconnect before claiming.')
        return
      }
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
    [session, busy, room, pushToast, syncMarks],
  )

  if (!ready) return null

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">No ticket on this device</h1>
        <p className="text-sm text-slate-400">Join a game first, then come back to your ticket.</p>
        <Link to="/" className="btn btn-primary">
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
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-3 px-2.5 py-3 sm:gap-4 sm:px-6 sm:py-6">
      {/* Sticky Mobile Question Pill (Shows when user scrolls down to their ticket) */}
      {isScrolled && call && callItem && (
        <div className="fixed top-2 inset-x-2 z-40 sm:hidden">
          <div
            className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border shadow-xl backdrop-blur-md transition-all ${
              isCallRevealed
                ? 'bg-emerald-950/90 border-emerald-500/70 text-emerald-200'
                : 'bg-panel/95 border-amber-500/70 text-slate-100'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-mono font-bold text-cyan">Call #{call.seq}</span>
                <span className="truncate opacity-75">{callItem.category}</span>
              </div>
              <p className="truncate text-xs font-bold mt-0.5">
                {isCallRevealed ? `Answer: ${callItem.term}` : callItem.clue || call.clue}
              </p>
            </div>
            <span
              className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isCallRevealed
                  ? 'bg-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/20 text-amber-400 animate-pulse'
              }`}
            >
              {isCallRevealed ? 'Revealed' : 'Active'}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan">
              {me?.name ?? session.display_name}
            </p>
            <h1 className="text-lg sm:text-xl font-black">Technical Ticket</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <StatusPill status={status} />
          <ConnectionDot connection={room.connection} />
        </div>
      </header>

      {room.error && (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-3 py-2 text-xs sm:text-sm text-rose">
          {room.error}
        </p>
      )}

      {/* Mobile-optimized Game info bar */}
      <section className="card flex items-center justify-between gap-3 p-3 sm:p-4">
        <div>
          <p className="label mb-0.5 text-[10px]">Game Code</p>
          <CodeChip code={session.code} className="text-base sm:text-xl" />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNumbersOnly((prev) => !prev)}
            className="text-[11px] font-semibold underline text-slate-400 hover:text-cyan"
            title="Toggle between technical terms and 1-90 numbers"
          >
            {showNumbersOnly ? 'Show Terms' : 'Show #'}
          </button>
          <div className="text-right">
            <p className="label mb-0.5 text-[10px]">Score</p>
            <p className="text-2xl sm:text-3xl font-black tabular-nums text-lime">{me?.score ?? 0}</p>
            <p className="text-[10px] text-slate-500">
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
          className={`card relative overflow-hidden p-3.5 sm:p-5 border transition-all ${
            isCallRevealed
              ? isLight
                ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
                : 'border-cyan/50 bg-cyan/10'
              : isLight
                ? 'border-amber-300 bg-amber-50/70 shadow-sm'
                : 'border-amber/50 bg-amber/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/30 pb-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-ink/70 text-slate-300">
                Call #{call.seq}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                {callItem.category}
              </span>
            </div>

            {isCallRevealed ? (
              <span className="text-[11px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-lime">
                ✓ Answer Revealed
              </span>
            ) : (
              <span className="text-[11px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber animate-pulse">
                Solve & Tap Your Ticket!
              </span>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">
              {callItem.clue || call.clue}
            </p>

            {callItem.codeSnippet && (
              <pre
                className={`p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-xs font-mono overflow-x-auto ${
                  isLight ? 'bg-slate-900 text-emerald-400' : 'bg-black/80 text-lime'
                }`}
              >
                {callItem.codeSnippet}
              </pre>
            )}

            {isCallRevealed ? (
              <div className="mt-2.5 flex items-center gap-2 pt-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Answer:
                </span>
                <span className="text-lg sm:text-2xl font-black text-cyan">
                  {callItem.term}
                </span>
                <span className="text-xs font-mono text-slate-400">(#{call.number})</span>
              </div>
            ) : (
              <p className="text-[11px] sm:text-xs italic text-slate-500 pt-0.5">
                Decode the question and tap matching cells on your ticket!
              </p>
            )}
          </div>
        </section>
      )}

      {/* Clubbed questions queue if multiple are pending */}
      {pendingCalls.length > 1 && (
        <details className="card p-2.5 sm:p-3 text-xs">
          <summary className="font-bold text-amber cursor-pointer">
            📋 {pendingCalls.length} questions currently active in this round (Click to view all)
          </summary>
          <div className="mt-2 space-y-1.5">
            {pendingCalls.map((c) => {
              const it = getTechnicalItem(c.number, customBank)
              return (
                <div key={c.seq} className="p-2 rounded bg-ink/40 border border-edge/60">
                  <span className="font-mono font-bold text-cyan mr-1.5">#{c.seq}:</span>
                  <span>{it.clue || c.clue}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* Interactive Lobby Tutorial & Simulation */}
      {status === 'lobby' && (
        <LobbyTutorialSimulator
          ticket={me?.ticket ?? null}
          playerMarked={playerMarked}
          onToggleCell={handleToggleCell}
          customBank={customBank}
        />
      )}

      {/* The Technical Tambola Ticket - Click & Unclick Manual Selection */}
      <Ticket
        ticket={me?.ticket ?? null}
        playerMarked={playerMarked}
        cut={cut}
        latest={isCallRevealed ? call?.number ?? null : null}
        customBank={customBank}
        onToggleCell={handleToggleCell}
        showNumbersOnly={showNumbersOnly}
      />

      {/* Claim Buttons: Enabled ONLY when player manually clicked required cells! */}
      {status === 'lobby' ? (
        <div className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-3 text-center text-xs sm:text-sm text-amber flex items-center justify-center gap-2">
          <span className="animate-spin text-base">⏳</span>
          <span>Waiting for the host to start the game · Practice solving and marking clues above!</span>
        </div>
      ) : (
        <ClaimButtons
          ticket={me?.ticket ?? null}
          marked={playerMarked}
          cut={cut}
          state={state}
          won={room.wonClaims}
          taken={room.takenClaims}
          busy={busy}
          onClaim={onClaim}
        />
      )}

      {/* Standings */}
      <section className="card p-3 sm:p-4">
        <h2 className="mb-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
        <Leaderboard players={state?.players ?? []} meId={me?.player_id} limit={8} dense />
      </section>

      {/* Floating toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-3">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role="status"
            className={[
              'pointer-events-auto w-full max-w-sm animate-pop rounded-xl border px-3.5 py-2.5 text-center text-xs sm:text-sm font-semibold shadow-xl backdrop-blur',
              toast.tone === 'good'
                ? 'border-lime/70 bg-lime/20 text-lime'
                : toast.tone === 'bad'
                  ? 'border-rose/70 bg-rose/20 text-rose'
                  : 'border-edge bg-panel/95 text-slate-200',
            ].join(' ')}
          >
            {toast.text}
          </p>
        ))}
      </div>
    </main>
  )
}
