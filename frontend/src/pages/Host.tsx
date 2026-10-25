import { BackLink } from '@/components/BackLink'
import { Results } from '@/features/host/Results'
import { BookOpen, Check, Copy, MonitorUp, QrCode, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { ClueStage, type CluePhase } from '@/components/ClueStage'
import { CodeChip, GameFooter, StatusPill } from '@/components/Chrome'
import { ClaimFeed } from '@/components/ClaimFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { NumberBoard } from '@/components/NumberBoard'
import { QuestionBankModal } from '@/components/QuestionBankModal'
import {
  drawNumber,
  displayQuestion,
  revealCalls,
  sessions,
  setGameStatus,
  startGame,
  updateGameBank,
} from '@/lib/api'
import { play, primeAudio, setMuted, speak, stopSpeaking } from '@/lib/sound'
import type { HostSession } from '@/lib/types'
import { claimLabel } from '@/lib/claims'
import { useGameRoom } from '@/hooks/useGameRoom'
import {
  getActiveBank,
  getTechnicalItem,
  saveLocalCustomBank,
  type TechnicalItem,
} from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

export default function HostScreen() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const [session, setSession] = useState<HostSession | null>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<CluePhase>('idle')
  const [busy, setBusy] = useState(false)
  const [reviewSeq, setReviewSeq] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [speakClues, setSpeakClues] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [isBankModalOpen, setIsBankModalOpen] = useState(false)
  const [customBank, setCustomBank] = useState<TechnicalItem[]>(() => getActiveBank())

  useEffect(() => {
    const stored = sessions.loadHost()
    if (!stored) {
      navigate('/', { replace: true })
      return
    }
    setSession(stored)
    setReady(true)
  }, [navigate])

  const gameId = session?.game_id ?? null

  const room = useGameRoom(gameId, session?.player_token ?? null, {
    onCall: (event) => {
      setReviewSeq(null)
      if (speakClues) speak(event.clue)
    },
    onClaim: (event) => {
      if (event.status === 'rejected') {
        setMessage(`Incorrect claim: ${event.name} · ${claimLabel(event.claim_type)}. Warning issued; no points deducted or cells cut.`)
        play('reject')
      }
    },
    onStatus: (event) => {
      if (event.status === 'finished') {
        stopSpeaking()
        play('win')
      }
    },
  })

  const state = room.state
  useEffect(() => {
    const bank = state?.settings?.custom_bank
    if (Array.isArray(bank) && bank.length === 90) setCustomBank(bank as TechnicalItem[])
  }, [state?.settings?.custom_bank])
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

  const displayedCall = state?.calls.find(c => c.seq === state.settings.display_seq) ?? room.lastCall
  const activeCall = (reviewSeq === null ? null : state?.calls.find(c => c.seq === reviewSeq)) ?? displayedCall
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

  const showQuestion = async (seq: number | null) => {
    if (!session || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await displayQuestion(session.game_id, session.host_token, seq)
      setReviewSeq(null)
      await room.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not show question')
    } finally {
      setBusy(false)
    }
  }

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
      if (session) {
        await updateGameBank(session.game_id, session.host_token, newBank)
        void room.refresh()
      }
      setCustomBank(newBank)
      saveLocalCustomBank(newBank)
    },
    [session, room],
  )

  // Spacebar calls the next question
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isBankModalOpen || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable=true]')) return
      if (event.code === 'Space') {
        event.preventDefault()
        void call()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [call, isBankModalOpen])

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
        <Link to="/admin" className="btn btn-primary">
          Create a game
        </Link>
      </main>
    )
  }

  const canCall = status === 'playing' || status === 'closing'
  const callBlocked = !canCall || busy || (state?.calls.length ?? 0) >= 90

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackLink to="/admin" label="Back to games" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan">Host console</p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-xl font-black sm:text-2xl">Technical Tambola</h1>
              <button
                type="button"
                onClick={onCopyLink}
                title="Click to copy join link"
                className="group inline-flex items-center gap-1.5 rounded-lg border border-cyan/40 bg-cyan/10 px-2.5 py-1 text-xs font-bold text-cyan transition hover:border-cyan hover:bg-cyan/20 active:scale-95"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Code:</span>
                <span className="font-mono text-sm sm:text-base font-black tracking-widest text-cyan">{session.code}</span>
                {copied ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-lime">
                    <Check size={13} />
                    <span>Copied!</span>
                  </span>
                ) : (
                  <Copy size={13} className="text-slate-400 group-hover:text-cyan transition-colors" />
                )}
              </button>
              {qr && (
                <button
                  type="button"
                  onClick={() => setShowQrModal(true)}
                  title="Show QR Code"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/40 bg-cyan/10 px-2.5 py-1 text-xs font-bold text-cyan transition hover:border-cyan hover:bg-cyan/20 active:scale-95"
                >
                  <QrCode size={13} />
                  <span>QR</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <StatusPill status={status} />


          <Link className="btn text-xs" to={`/admin/audit?game=${session.game_id}`} state={{ backTo: '/host' }}>Game audit</Link>
          <button
            type="button"
            onClick={() => setIsBankModalOpen(true)}
            className="btn px-3 py-2 text-xs font-bold text-cyan"
            title="View or edit the 90 technical questions"
          >
            <BookOpen size={15} aria-hidden="true" />Question Bank
          </button>

          <button type="button" onClick={toggleMute} className="btn px-3 py-2 text-xs">
            {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}{muted ? 'Muted' : 'Sound'}
          </button>

          <Link
            to={`/board?code=${session.code}`}
            target="_blank"
            className="btn px-3 py-2 text-xs"
          >
            <MonitorUp size={15} aria-hidden="true" />Projector view
          </Link>
        </div>
      </header>

      {room.error && (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-sm text-rose">
          {room.error}
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber">
          {message}
        </p>
      )}

      {status === 'lobby' ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card flex flex-col items-center gap-5 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Share this code</p>
            <CodeChip code={session.code} />
            {qr && (
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
            <Leaderboard players={nonHosts} dense className="max-h-[50vh] overflow-y-auto" />
          </div>
        </section>
      ) : (
        <>
          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              {reviewSeq !== null && <p className="text-sm text-amber">Reviewing an earlier question. Players and projector stay on the live question.</p>}
              {reviewSeq === null && state?.settings.display_seq != null && <p role="status" className="text-sm text-cyan">Showing question #{state.settings.display_seq} to all players and the projector.</p>}
              {/* Main Clue Stage with Question & Answer preview */}
              <ClueStage
                call={activeCall}
                speakClues={false}
                isHost={true}
                isRevealed={isActiveCallRevealed}
                customBank={customBank}
                pendingClubbedCount={pendingCalls.length}
                onRevealNow={
                  activeCall ? () => handleRevealSingle(activeCall.seq) : undefined
                }
              />

              {/* Host Main Action Controls */}
              <div className="card flex flex-wrap items-center gap-3 p-4">
                <button type="button" className="btn text-xs" disabled={busy || !activeCall || activeCall.seq <= 1}
                  onClick={() => { if (activeCall) setReviewSeq(activeCall.seq - 1) }}>Previous Question</button>
                {(reviewSeq !== null || state?.settings.display_seq != null) && <button type="button" className="btn text-xs" disabled={busy} onClick={() => void showQuestion(null)}>Back to live</button>}
                <button
                  type="button"
                  className="btn btn-primary w-full flex-none text-sm font-bold sm:w-auto sm:flex-1 sm:text-base"
                  disabled={reviewSeq === null ? callBlocked : busy}
                  onClick={() => {
                    if (reviewSeq !== null) setReviewSeq(reviewSeq + 1 >= (room.lastCall?.seq ?? 0) ? null : reviewSeq + 1)
                    else void call()
                  }}
                >
                  {reviewSeq !== null ? 'Next Question' : status === 'finished'
                    ? 'Game over'
                    : status === 'paused'
                      ? 'Paused'
                      : <>Call Next Question <span className="font-mono text-xs opacity-70">{state?.calls.length ?? 0}/90</span><kbd className="hidden rounded border border-current/30 px-1 text-[9px] sm:inline">Space</kbd></>}
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
                      const isShowing = displayedCall?.seq === c.seq
                      return (
                        <div
                          key={c.seq}
                          className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border text-xs ${
                            isShowing
                              ? 'border-lime bg-lime/15 text-slate-100 ring-1 ring-inset ring-lime/60'
                              : isRev
                              ? 'border-edge/60 bg-ink/30 text-slate-400'
                              : 'border-amber/50 bg-amber/10 text-amber-200'
                          }`}
                        >
                          <button type="button" disabled={busy} onClick={() => void showQuestion(c.seq)}
                            aria-label={`Show question ${c.seq} to players`}
                            aria-pressed={isShowing}
                            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded text-left enabled:hover:text-cyan focus-visible:outline focus-visible:outline-cyan">
                            <span className="font-mono font-bold text-slate-400">#{c.seq}</span>
                            <span className="font-bold text-cyan">{it.term}</span>
                            <span className="truncate text-slate-400 max-w-sm sm:max-w-md">
                              {it.clue || c.clue}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-1 text-[10px] ${isShowing ? 'bg-lime text-ink font-bold' : 'text-cyan'}`}>{isShowing ? 'Showing' : 'Show'}</span>
                          </button>

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
                <Leaderboard players={nonHosts} limit={12} dense className="max-h-[38vh] overflow-y-auto" />
              </div>
            </aside>
          </section>

          {status === 'finished' ? <Results players={nonHosts} state={state} customBank={customBank} /> : null}
        </>
      )}

      <GameFooter connection={room.connection} />

      {/* Question Bank Modal */}
      <QuestionBankModal
        isOpen={isBankModalOpen}
        onClose={() => setIsBankModalOpen(false)}
        currentBank={customBank}
        onSaveBank={handleSaveBank}
      />

      {/* Host QR Code Modal */}
      {showQrModal && qr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="card flex flex-col items-center gap-4 p-6 sm:p-8 border-cyan/50 text-center max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-cyan">Join Game QR</span>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="rounded p-1 text-slate-400 hover:text-white"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-2xl">
              <img
                src={qr}
                alt={`Scan QR code to join game ${session.code}`}
                className="h-56 w-56 sm:h-64 sm:w-64"
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Game Code</p>
              <p className="font-mono text-3xl font-black tracking-widest text-cyan">{session.code}</p>
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={onCopyLink}
                className="btn text-xs flex-1"
              >
                {copied ? 'Link copied!' : 'Copy join link'}
              </button>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="btn btn-primary text-xs flex-1"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
