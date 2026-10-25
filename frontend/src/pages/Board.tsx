import { BackLink } from '@/components/BackLink'
import { ProjectorCallStage } from '@/features/board/ProjectorCallStage'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Suspense } from 'react'
import QRCode from 'qrcode'
import { Maximize2, QrCode, X } from 'lucide-react'
import { getGameStateByCode, sessions } from '@/lib/api'
import { claimLabel } from '@/lib/claims'
import type { CallRow, GameState } from '@/lib/types'
import { useGameRoom } from '@/hooks/useGameRoom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

/**
 * Projector view. Read-only, needs no token, and is driven entirely by the
 * call feed so it stays in sync without the host touching anything.
 */
function Board() {
  const [params] = useSearchParams()
  const backTo = sessions.loadHost()?.code === (params.get('code') ?? '').toUpperCase() ? '/host' : '/admin'
  const code = (params.get('code') ?? '').toUpperCase()
  const { theme } = useTheme()
  const [fallback, setFallback] = useState<GameState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(true)
  const [isQrEnlarged, setIsQrEnlarged] = useState(false)

  // Generate join QR code for this game
  useEffect(() => {
    if (!code || code.length !== 6) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('code', code)
    QRCode.toDataURL(url.toString(), {
      margin: 1,
      width: 280,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null))
  }, [code])

  // Resolve the code to a game id, then follow the same live channel as everyone else.
  useEffect(() => {
    if (code.length !== 6) {
      setLoadError('No game code in the link.')
      return
    }
    let cancelled = false
    getGameStateByCode(code)
      .then((state) => {
        if (!cancelled) setFallback(state)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Game not found')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  const gameId = fallback?.game_id ?? null
  const room = useGameRoom(gameId, null)
  const state = room.state ?? fallback

  const call = state?.calls.find(c => c.seq === state.settings.display_seq) ?? room.lastCall ?? (state?.calls.length ? state.calls[state.calls.length - 1] : null)
  const customBank = (state?.settings?.custom_bank as TechnicalItem[]) ?? null

  const called = room.calledNumbers.size > 0 ? room.calledNumbers : new Set((state?.calls ?? []).map((c) => c.number))

  // Revealed call sequence IDs
  const revealedSeqs = useMemo(
    () => new Set(state?.settings?.revealed_seqs ?? []),
    [state?.settings?.revealed_seqs],
  )

  const isCallRevealed = call ? revealedSeqs.has(call.seq) : false
  const revealedNumbers = new Set((state?.calls ?? []).filter(c => revealedSeqs.has(c.seq)).map(c => c.number))

  if (loadError) {
    return (
      <main className="flex min-h-dvh flex-col gap-4 items-center justify-center p-8 text-center">
        <BackLink to={backTo} label="Back to games" />
        <p className="text-2xl font-bold text-rose">{loadError}</p>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="flex min-h-dvh flex-col gap-4 items-center justify-center p-8">
        <BackLink to={backTo} label="Back to games" />
        <p className="text-2xl font-bold text-slate-500">Loading…</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4 sm:p-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/40 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink to={backTo} label={backTo === '/host' ? 'Back to game' : 'Back to games'} />
          <span className="font-mono text-3xl font-black tracking-[0.3em] text-cyan sm:text-4xl">
            {state.code}
          </span>
          <span className="rounded-md bg-panel px-3 py-1 text-sm font-bold uppercase tracking-wider text-slate-300">
            {state.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowQr((prev) => !prev)}
            className={`btn px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition ${
              showQr ? 'border-cyan/50 text-cyan bg-cyan/10' : 'text-slate-400 hover:text-slate-200'
            }`}
            title={showQr ? 'Hide join QR code' : 'Show join QR code'}
          >
            <QrCode size={15} />
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>
          <p className="text-sm text-slate-500 font-semibold">
            {(state.players ?? []).filter((p) => !p.is_host).length} players · {called.size}/90 called
          </p>
        </div>
      </header>

      {/* Main Projector Question Stage */}
      <ProjectorCallStage
        call={call}
        status={state.status}
        isRevealed={isCallRevealed}
        customBank={customBank}
      />

      {/* Called Board and Standings */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Called Technical Items ({called.size})
            </h2>
            <button
              type="button"
              onClick={() => setShowNumbers((prev) => !prev)}
              className="text-xs font-semibold text-cyan hover:underline"
            >
              {showNumbers ? 'Show Technical Terms' : 'Show 1-90 Grid'}
            </button>
          </div>

          {showNumbers ? (
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => (
                <div
                  key={n}
                  className={[
                    'flex aspect-square items-center justify-center rounded-lg border text-xs font-bold tabular-nums sm:text-sm',
                    revealedNumbers.has(n) ? 'border-cyan/70 bg-cyan/20 text-cyan shadow-sm' : 'border-edge/70 bg-ink/40 text-slate-600',
                  ].join(' ')}
                >
                  {n}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-[45vh] overflow-y-auto pr-1">
              {Array.from(revealedNumbers).map((n) => {
                const item = getTechnicalItem(n, customBank)
                const isLatest = call?.number === n
                return (
                  <div
                    key={n}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${
                      isLatest
                        ? 'border-cyan bg-cyan/20 text-cyan ring-2 ring-cyan animate-pop'
                        : 'border-cyan/50 bg-cyan/10 text-cyan-400'
                    }`}
                  >
                    <span className="text-[10px] opacity-60">#{n}</span>
                    <span>{item.term}</span>
                  </div>
                )
              })}
              {revealedNumbers.size === 0 && (
                <p className="text-sm text-slate-500 italic">No answers revealed yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Live Standings and Claims */}
        <div className="flex flex-col gap-4">
          {showQr && qr && (
            <div className="card relative flex flex-col items-center gap-2 p-4 text-center border-cyan/40 bg-panel/90 shadow-md">
              <button
                type="button"
                onClick={() => setShowQr(false)}
                className="absolute top-2.5 right-2.5 rounded p-1 text-slate-400 hover:text-white hover:bg-white/10 transition"
                title="Hide QR code"
                aria-label="Hide QR code"
              >
                <X size={15} />
              </button>
              <div className="flex items-center gap-1.5 text-cyan">
                <QrCode size={14} />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Scan to Join</span>
              </div>
              <button
                type="button"
                onClick={() => setIsQrEnlarged(true)}
                className="group relative rounded-xl bg-white p-2.5 shadow transition hover:ring-2 hover:ring-cyan cursor-zoom-in"
                title="Click to enlarge QR code"
              >
                <img
                  src={qr}
                  alt={`Scan QR code to join game ${state.code}`}
                  className="h-28 w-28 sm:h-32 sm:w-32"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/70 p-1 text-white opacity-0 group-hover:opacity-100 transition">
                  <Maximize2 size={12} />
                </span>
              </button>
              <p className="font-mono text-xs font-bold tracking-widest text-slate-300">
                CODE: <span className="text-cyan font-black text-sm">{state.code}</span>
              </p>
            </div>
          )}

          <div className="card p-5 space-y-4">
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
              <ol className="flex flex-col gap-1.5 max-h-[35vh] overflow-y-auto pr-1">
                {(state.players ?? [])
                  .filter((p) => !p.is_host)
                  .slice(0, 10)
                  .map((p, i) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-lg border border-edge bg-panel/60 px-3 py-2 text-sm"
                    >
                      <span className="w-5 text-xs font-bold tabular-nums text-slate-500">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                      <span className="font-bold tabular-nums text-lime">{p.score}</span>
                    </li>
                  ))}
              </ol>
            </div>

            {(state.claims ?? []).length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">Recent Claims</h2>
                <ul className="flex flex-col gap-1 max-h-[25vh] overflow-y-auto pr-1">
                  {(state.claims ?? [])
                    .slice(-5)
                    .reverse()
                    .map((c) => (
                      <li
                        key={c.id}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                          c.status === 'accepted'
                            ? 'border-lime/50 bg-lime/10 text-lime'
                            : 'border-rose/40 bg-rose/10 text-rose'
                        }`}
                      >
                        {c.name} · {claimLabel(c.claim_type)} {c.status === 'accepted' ? `+${c.points}` : '✗'}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {isQrEnlarged && qr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setIsQrEnlarged(false)}
        >
          <div
            className="card flex flex-col items-center gap-4 p-6 sm:p-8 border-cyan/50 text-center max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-cyan">Scan to Join</span>
              <button
                type="button"
                onClick={() => setIsQrEnlarged(false)}
                className="rounded p-1 text-slate-400 hover:text-white"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-2xl">
              <img
                src={qr}
                alt={`Scan QR code to join game ${state.code}`}
                className="h-64 w-64 sm:h-72 sm:w-72"
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Game Code</p>
              <p className="font-mono text-3xl font-black tracking-widest text-cyan">{state.code}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsQrEnlarged(false)}
              className="btn btn-primary w-full text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh flex-col gap-4 items-center justify-center p-8">
          <BackLink to="/admin" label="Back to games" />
          <p className="text-2xl font-bold text-slate-500">Loading…</p>
        </main>
      }
    >
      <Board />
    </Suspense>
  )
}
