'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { ClueStage, type CluePhase } from '@/components/ClueStage'
import { CodeChip, ConnectionDot, StatusPill } from '@/components/Chrome'
import { ClaimFeed } from '@/components/ClaimFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { NumberBoard } from '@/components/NumberBoard'
import { QuestionBankModal } from '@/components/QuestionBankModal'
import {
  drawNumber,
  revealCalls,
  sessions,
  setGameStatus,
  startGame,
  updateGameBank,
} from '@/lib/api'
import { play, primeAudio, setMuted, speak, stopSpeaking } from '@/lib/sound'
import type { HostSession } from '@/lib/types'
import { useGameRoom } from '@/hooks/useGameRoom'
import {
  getActiveBank,
  getTechnicalItem,
  saveLocalCustomBank,
  type TechnicalItem,
} from '@/lib/technicalBank'
import { ThemeToggle, useTheme } from '@/lib/theme'

export default function HostScreen() {
  const router = useRouter()
  const { theme } = useTheme()
  const [session, setSession] = useState<HostSession | null>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<CluePhase>('idle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [speakClues, setSpeakClues] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isBankModalOpen, setIsBankModalOpen] = useState(false)
  const [customBank, setCustomBank] = useState<TechnicalItem[]>(() => getActiveBank())

  useEffect(() => {
    const stored = sessions.loadHost()
    if (!stored) {
      router.replace('/')
      return
    }
    setSession(stored)
    setReady(true)
  }, [router])

  const gameId = session?.game_id ?? null

  const room = useGameRoom(gameId, session?.player_token ?? null, {
    onCall: (event) => {
      if (speakClues) speak(event.clue)
    },
    onStatus: (event) => {
      if (event.status === 'finished') {
        stopSpeaking()
        play('win')
      }
    },
  })

  const state = room.state
  const status = state?.status ?? 'lobby'
  const players = useMemo(() => state?.players ?? [], [state?.players])
  const nonHosts = players.filter((p) => !p.is_host)

  // Revealed call sequences
  const revealedSeqs = useMemo(
    () => new Set(state?.settings?.revealed_seqs ?? []),
    [state?.settings?.revealed_seqs],
  )

  // Unrevealed calls
  const pendingCalls = useMemo(
    () => (state?.calls ?? []).filter((c) => !revealedSeqs.has(c.seq)),
    [state?.calls, revealedSeqs],
  )

  const activeCall = room.lastCall
  const isActiveCallRevealed = activeCall ? revealedSeqs.has(activeCall.seq) : false

  // QR code for projector and players
  useEffect(() => {
    if (!session) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('code', session.code)
    QRCode.toDataURL(url.toString(), {
      margin: 1,
      width: 360,
      color: theme === 'light' ? { dark: '#0f172a', light: '#f8fafc' } : { dark: '#e2e8f0', light: '#0d1424' },
    })
      .then(setQr)
      .catch(() => setQr(null))
  }, [session, theme])

  // Call the next question/number
  const call = useCallback(async () => {
    if (!session || busy) return
    setBusy(true)
    setMessage(null)
    primeAudio()
    try {
      await drawNumber(session.game_id, session.host_token)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not call a question')
    } finally {
      setBusy(false)
    }
  }, [session, busy])

  // Reveal a specific call by sequence number
  const handleRevealSingle = useCallback(
    async (seq: number) => {
      if (!session || busy) return
      setBusy(true)
      const nextSeqs = Array.from(new Set([...Array.from(revealedSeqs), seq]))
      try {
        await revealCalls(session.game_id, session.host_token, nextSeqs)
        play('reveal')
        stopSpeaking()
        void room.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Could not reveal answer')
      } finally {
        setBusy(false)
      }
    },
    [session, busy, revealedSeqs, room],
  )

  // Reveal all currently pending calls at once (clubbing batch reveal)
  const handleRevealAllPending = useCallback(async () => {
    if (!session || busy || !state) return
    setBusy(true)
    const allSeqs = (state.calls ?? []).map((c) => c.seq)
    try {
      await revealCalls(session.game_id, session.host_token, allSeqs)
      play('reveal')
      stopSpeaking()
      void room.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reveal answers')
    } finally {
      setBusy(false)
    }
  }, [session, busy, state, room])

  // Save updated custom bank to localStorage and game
  const handleSaveBank = useCallback(
    async (newBank: TechnicalItem[]) => {
      setCustomBank(newBank)
      saveLocalCustomBank(newBank)
      if (session) {
        try {
          await updateGameBank(session.game_id, session.host_token, newBank)
          void room.refresh()
        } catch {
          // best-effort
        }
      }
    },
    [session, room],
  )

  // Spacebar calls the next question
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.code === 'Space') {
        event.preventDefault()
        void call()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [call])

  async function onStart() {
    if (!session) return
    setBusy(true)
    setMessage(null)
    try {
      await startGame(session.game_id, session.host_token)
      play('call')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not start the game')
    } finally {
      setBusy(false)
    }
  }

  async function onTogglePause() {
    if (!session) return
    const next = status === 'paused' ? 'playing' : 'paused'
    setBusy(true)
    try {
      await setGameStatus(session.game_id, session.host_token, next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change the game state')
    } finally {
      setBusy(false)
    }
  }

  async function onEnd() {
    if (!session) return
    if (!confirm('Are you sure you want to end this game?')) return
    setBusy(true)
    try {
      await setGameStatus(session.game_id, session.host_token, 'finished')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not end the game')
    } finally {
      setBusy(false)
    }
  }

  async function onCopyLink() {
    if (!session) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('code', session.code)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  if (!ready) return null

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">No game on this device</h1>
        <p className="text-sm text-slate-400">Create a game first, then come back to the host screen.</p>
        <Link href="/" className="btn btn-primary">
          Create a game
        </Link>
      </main>
    )
  }

  const canCall = status === 'playing' || status === 'closing'
  const callBlocked = !canCall || busy

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-black tracking-tight text-slate-500 hover:text-cyan">
            ←
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan">Host console</p>
            <h1 className="text-xl font-black sm:text-2xl">Technical Tambola</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <StatusPill status={status} />
          <ConnectionDot connection={room.connection} />

          <button
            type="button"
            onClick={() => setIsBankModalOpen(true)}
            className="btn px-3 py-2 text-xs font-bold text-cyan"
            title="View or edit the 90 technical questions"
          >
            ⚡ Question Bank
          </button>

          <button type="button" onClick={toggleMute} className="btn px-3 py-2 text-xs">
            {muted ? '🔇 Muted' : '🔊 Sound'}
          </button>

          <Link
            href={`/board?code=${session.code}`}
            target="_blank"
            className="btn px-3 py-2 text-xs"
          >
            Projector view ↗
          </Link>
        </div>
      </header>

      {room.error && (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-sm text-rose">
          {room.error}
        </p>
      )}
      {message && (
        <p className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber">
          {message}
        </p>
      )}

      {status === 'lobby' ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card flex flex-col items-center gap-5 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Share this code</p>
            <CodeChip code={session.code} />
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code to join this game" className="h-48 w-48 rounded-lg shadow-md" />
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onCopyLink} className="btn text-xs">
                {copied ? 'Link copied' : 'Copy join link'}
              </button>
              <button
                type="button"
                onClick={() => setIsBankModalOpen(true)}
                className="btn text-xs text-cyan"
              >
                Customize Questions Bank
              </button>
            </div>
            <p className="text-sm text-slate-400">
              {nonHosts.length} player{nonHosts.length === 1 ? '' : 's'} ready · {room.connected} device
              {room.connected === 1 ? '' : 's'} connected
            </p>
            <button
              type="button"
              className="btn btn-primary w-full max-w-xs text-base"
              disabled={busy || nonHosts.length === 0}
              onClick={onStart}
            >
              {nonHosts.length === 0 ? 'Waiting for players…' : `Start game with ${nonHosts.length}`}
            </button>
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">In the lobby</h2>
            <Leaderboard players={players} dense className="max-h-[50vh] overflow-y-auto" />
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="flex flex-col gap-4">
              {/* Main Clue Stage with Question & Answer preview */}
              <ClueStage
                call={room.lastCall}
                speakClues={speakClues}
                isHost={true}
                isRevealed={isActiveCallRevealed}
                customBank={customBank}
                pendingClubbedCount={pendingCalls.length}
                onRevealNow={
                  activeCall ? () => handleRevealSingle(activeCall.seq) : undefined
                }
                onNextQuestion={call}
              />

              {/* Host Main Action Controls */}
              <div className="card flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  className="btn btn-primary flex-1 text-base sm:text-lg font-bold"
                  disabled={callBlocked}
                  onClick={call}
                >
                  {status === 'finished'
                    ? 'Game over'
                    : status === 'paused'
                      ? 'Paused'
                      : `Call Next Question (${state?.calls.length ?? 0}/90) [Space]`}
                </button>

                {pendingCalls.length > 0 && (
                  <button
                    type="button"
                    className="btn text-xs font-bold text-amber border-amber/60 hover:bg-amber/10"
                    disabled={busy}
                    onClick={handleRevealAllPending}
                    title="Reveal answers for all currently active questions"
                  >
                    Reveal All ({pendingCalls.length}) Pending
                  </button>
                )}

                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={speakClues}
                    onChange={(e) => setSpeakClues(e.target.checked)}
                    className="h-4 w-4 accent-cyan"
                  />
                  Read aloud
                </label>

                {status === 'playing' || status === 'closing' || status === 'paused' ? (
                  <>
                    <button type="button" className="btn text-xs" disabled={busy} onClick={onTogglePause}>
                      {status === 'paused' ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" className="btn btn-danger text-xs" disabled={busy} onClick={onEnd}>
                      End
                    </button>
                  </>
                ) : null}
              </div>

              {/* Questions Log & Individual Reveal Control */}
              {(state?.calls ?? []).length > 0 && (
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                      Questions in this Game ({(state?.calls ?? []).length})
                    </h2>
                    <span className="text-xs text-slate-500">
                      {pendingCalls.length} pending reveal · {revealedSeqs.size} revealed
                    </span>
                  </div>

                  <div className="max-h-[30vh] overflow-y-auto space-y-2 pr-1">
                    {[...(state?.calls ?? [])].reverse().map((c) => {
                      const it = getTechnicalItem(c.number, customBank)
                      const isRev = revealedSeqs.has(c.seq)
                      return (
                        <div
                          key={c.seq}
                          className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border text-xs ${
                            isRev
                              ? 'border-edge/60 bg-ink/30 text-slate-400'
                              : 'border-amber/50 bg-amber/10 text-amber-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-bold text-slate-400">#{c.seq}</span>
                            <span className="font-bold text-cyan">{it.term}</span>
                            <span className="truncate text-slate-400 max-w-sm sm:max-w-md">
                              {it.clue || c.clue}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isRev ? (
                              <span className="text-[11px] font-bold text-emerald-500">✓ Revealed</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRevealSingle(c.seq)}
                                className="btn text-[10px] py-1 px-2.5 font-bold border-amber/60 text-amber"
                              >
                                Reveal Answer
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Called Technical Board */}
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">
                  Called Items Board
                </h2>
                <NumberBoard called={room.calledNumbers} latest={room.lastCall?.number ?? null} />
              </div>
            </div>

            {/* Sidebar with Claims & Standings */}
            <aside className="flex flex-col gap-4">
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Claims</h2>
                <ClaimFeed claims={state?.claims ?? []} limit={14} className="max-h-[38vh] overflow-y-auto" />
              </div>
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
                <Leaderboard players={players} limit={12} dense className="max-h-[38vh] overflow-y-auto" />
              </div>
            </aside>
          </section>

          {status === 'finished' ? <Results players={players} state={state} customBank={customBank} /> : null}
        </>
      )}

      {/* Question Bank Modal */}
      <QuestionBankModal
        isOpen={isBankModalOpen}
        onClose={() => setIsBankModalOpen(false)}
        currentBank={customBank}
        onSaveBank={handleSaveBank}
      />
    </main>
  )
}

function Results({
  players,
  state,
  customBank,
}: {
  players: { id: string; name: string; score: number; is_host: boolean; wrong_claims: number }[]
  state: { calls: { seq: number; number: number; clue: string }[] } | null
  customBank: TechnicalItem[] | null
}) {
  const podium = players.filter((p) => !p.is_host).slice(0, 3)
  const medals = ['🥇', '🥈', '🥉']

  return (
    <section className="card p-5 sm:p-6 mt-4">
      <h2 className="text-lg font-bold">Final standings</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {podium.map((p, i) => (
          <div
            key={p.id}
            className={`rounded-xl border p-4 text-center ${
              i === 0 ? 'border-amber/70 bg-amber/10' : 'border-edge bg-panel/60'
            }`}
          >
            <p className="text-3xl">{medals[i]}</p>
            <p className="mt-1 font-bold">{p.name}</p>
            <p className="text-2xl font-black tabular-nums text-lime">{p.score}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-300">Every call</h3>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {(state?.calls ?? []).map((c) => {
          const it = getTechnicalItem(c.number, customBank)
          return (
            <li key={c.seq} className="flex items-baseline gap-2 rounded-md border border-edge bg-panel/50 px-2 py-1">
              <span className="text-[10px] tabular-nums text-slate-500">#{c.seq}</span>
              <span className="font-bold text-cyan">{it.term}</span>
              <span className="truncate text-xs text-slate-400">{it.clue || c.clue}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex gap-2">
        <Link href="/" className="btn text-xs">
          New game
        </Link>
      </div>
    </section>
  )
}
