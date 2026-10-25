import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { CodeChip, GameFooter, StatusPill } from '@/components/Chrome'
import { BackLink } from '@/components/BackLink'
import { ClaimButtons } from '@/components/ClaimButtons'
import { Ticket } from '@/components/Ticket'
import { LobbyTutorialSimulator } from '@/components/LobbyTutorialSimulator'
import { sessions, submitClaim } from '@/lib/api'
import { usePlayerMarks } from '@/hooks/usePlayerMarks'
import { claimLabel } from '@/lib/claims'
import { play } from '@/lib/sound'
import type { ClaimType, PlayerSession } from '@/lib/types'
import { cutSet, useGameRoom } from '@/hooks/useGameRoom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

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
  const [isScrolled, setIsScrolled] = useState(false)
  const [showBatch, setShowBatch] = useState(false)

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

  const { marked: playerMarked, toggle: handleToggleCell, sync: syncMarks, saveStatus } = usePlayerMarks(
    session, me, room.connection, state?.status === 'playing' || state?.status === 'closing',
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
      try {
        const result = await submitClaim(session.game_id, session.player_token, claim)
        if (result.accepted) {
          play('accept')
          pushToast('good', `${claimLabel(claim)} accepted  +${result.points}`)
        } else {
          play('reject')
          pushToast('info', result.reason ?? 'Claim was not accepted. Check your pattern.')
        }
        void room.refresh()
      } catch (error) {
        pushToast('bad', error instanceof Error ? error.message : 'Could not submit claim. Please try again.')
      } finally {
        setBusy(false)
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
        <Link to="/account" className="btn btn-primary">
          Join a game
        </Link>
      </main>
    )
  }

  const status = state?.status ?? 'lobby'
  const call = state?.calls.find(c => c.seq === state.settings.display_seq) ?? room.lastCall
  const callItem = call ? getTechnicalItem(call.number, customBank) : null
  const isCallRevealed = call ? revealedSeqs.has(call.seq) : false

  // Only the current batch is displayed; past calls still validate claims.
  const batchCalls = (state?.calls ?? []).filter(c => c.seq >= (state?.settings.question_batch_start ?? 1))

  const isLight = theme === 'light'

  return (
    <main className="player-shell mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-2 px-2 py-2 sm:gap-4 sm:px-6 sm:py-6">
      {/* Sticky Mobile Question Pill (Shows when user scrolls down to their ticket) */}
      {isScrolled && call && callItem && (
        <div className="fixed top-2 inset-x-2 z-40 sm:hidden">
          <div
            className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border shadow-xl backdrop-blur-md transition-colors ${
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
            <h1 className="text-base sm:text-xl font-black">Technical Tambola</h1>
          </div>
        </div>
        <div className="player-status flex flex-wrap items-center gap-2">

          <StatusPill status={status} />

        </div>
      </header>

      {room.error && (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-3 py-2 text-xs sm:text-sm text-rose">
          {room.error}
        </p>
      )}

      {/* Mobile-optimized Game info bar */}
      <section className="card flex items-center justify-between gap-2 p-2 sm:p-4">
        <div className="flex items-center gap-2">
          <BackLink to="/account" label="Back to player lounge" />
          <div><p className="label mb-0.5 text-[10px]">Game Code</p>
          <CodeChip code={session.code} className="text-base sm:text-xl" /></div>
        </div>
        <div className="text-right">
          <p className="label mb-0.5 text-[10px]">Score</p>
          <p className="text-xl sm:text-3xl font-black tabular-nums text-lime">{me?.score ?? 0}</p>
        </div>
      </section>

      <div aria-label={`${state?.calls.length ?? 0} of 90 questions called`} className="game-progress"><span style={{ width: `${((state?.calls.length ?? 0) / 90) * 100}%` }} /></div>

      {state?.settings.display_seq != null && <p role="status" className="text-sm font-semibold text-amber">The host is showing an earlier question · #{state.settings.display_seq}</p>}
      {/* Active Question / Clue Stage */}
      {call && callItem && (
        <section
          className={`player-clue card relative overflow-hidden p-2.5 sm:p-5 border transition-colors ${
            isCallRevealed
              ? isLight
                ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
                : 'border-cyan/50 bg-cyan/10'
              : isLight
                ? 'border-amber-300 bg-amber-50/70 shadow-sm'
                : 'border-amber/50 bg-amber/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-edge/30 pb-1.5 mb-1.5 sm:pb-2 sm:mb-2.5">
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
                Solve & mark
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
                Solve the clue and mark your answer.
              </p>
            )}
          </div>
        </section>
      )}

      {batchCalls.length > 0 && (
        <section className="player-batch card p-2.5 sm:p-4" aria-label="Current question batch">
          <h2 className="hidden sm:block text-sm font-bold text-amber">Current batch · {batchCalls.length} question{batchCalls.length === 1 ? '' : 's'}</h2>
          <button type="button" className="flex min-h-9 w-full items-center justify-between gap-2 text-left text-xs font-bold text-amber sm:hidden" aria-expanded={showBatch} aria-controls="player-batch-list" onClick={() => setShowBatch(open => !open)}>
            <span>Current batch · {batchCalls.length} questions</span><span>{showBatch ? 'Hide −' : 'View +'}</span>
          </button>
          <div id="player-batch-list" className={showBatch ? '' : 'hidden sm:block'}>
          <p className="mt-1 text-xs text-slate-400">Answers appear when revealed. Once this batch is revealed, the next question starts a fresh batch.</p>
          <ol className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {batchCalls.map(previous => {
              const item = getTechnicalItem(previous.number, customBank)
              return <li key={previous.seq} className="rounded border border-edge p-3 text-sm">
                <p className="font-mono text-xs text-cyan">Call #{previous.seq}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{previous.clue}</p>
                {item.codeSnippet && <pre className="mt-2 overflow-x-auto bg-ink p-2 text-xs text-lime">{item.codeSnippet}</pre>}
                {revealedSeqs.has(previous.seq) && <p className="mt-2 font-bold text-cyan">Answer: {item.term}</p>}
              </li>
            })}
          </ol>
          </div>
        </section>
      )}

      {/* Interactive Lobby Tutorial & Simulation */}
      {status === 'lobby' && me?.ticket && (
        <LobbyTutorialSimulator
          ticket={me?.ticket ?? null}
          customBank={customBank}
        />
      )}

      {/* The Technical Tambola Ticket - Click & Unclick Manual Selection */}
      {status !== 'lobby' && <Ticket
        ticket={me?.ticket ?? null}
        playerMarked={playerMarked}
        cut={cut}
        customBank={customBank}
        onToggleCell={status === 'playing' || status === 'closing' ? handleToggleCell : undefined}
      />}

      {status !== 'lobby' && <p role="status" aria-label="Ticket save status" className={`px-1 text-[10px] sm:text-xs ${saveStatus === 'saved' ? 'text-slate-400' : 'text-amber'}`}>
        {{ saved: 'Ticket saved', saving: 'Saving ticket…', offline: 'Offline · marks saved on this device; will sync when connected', retrying: 'Ticket save pending · retrying automatically' }[saveStatus]}
      </p>}
      {/* Players decide when to claim; no automatic pattern hints. */}
      {status === 'lobby' ? (
        <div className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-3 text-center text-xs sm:text-sm text-amber flex items-center justify-center gap-2">
          <span className="animate-spin text-base">⏳</span>
          <span>Waiting for the host to start the game · Practice solving and marking clues above!</span>
        </div>
      ) : (
        <ClaimButtons
          state={state}
          won={room.wonClaims}
          taken={room.takenClaims}
          busy={busy}
          onClaim={onClaim}
        />
      )}

      <GameFooter connection={room.connection} />

      {/* Floating toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 px-3">
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
