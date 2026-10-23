import { ProjectorCallStage } from '@/features/board/ProjectorCallStage'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Suspense } from 'react'
import { getGameStateByCode } from '@/lib/api'
import { claimLabel } from '@/lib/claims'
import type { CallRow, GameState } from '@/lib/types'
import { useGameRoom } from '@/hooks/useGameRoom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { ThemeToggle, useTheme } from '@/lib/theme'

/**
 * Projector view. Read-only, needs no token, and is driven entirely by the
 * call feed so it stays in sync without the host touching anything.
 */
function Board() {
  const [params] = useSearchParams()
  const code = (params.get('code') ?? '').toUpperCase()
  const { theme } = useTheme()
  const [fallback, setFallback] = useState<GameState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)

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

  const call = room.lastCall ?? (state?.calls.length ? state.calls[state.calls.length - 1] : null)
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
      <main className="flex min-h-dvh items-center justify-center p-8 text-center">
        <p className="text-2xl font-bold text-rose">{loadError}</p>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <p className="text-2xl font-bold text-slate-500">Loading…</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4 sm:p-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/40 pb-3">
        <div className="flex items-center gap-4">
          <span className="font-mono text-3xl font-black tracking-[0.3em] text-cyan sm:text-4xl">
            {state.code}
          </span>
          <span className="rounded-md bg-panel px-3 py-1 text-sm font-bold uppercase tracking-wider text-slate-300">
            {state.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
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
    </main>
  )
}

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center p-8">
          <p className="text-2xl font-bold text-slate-500">Loading…</p>
        </main>
      }
    >
      <Board />
    </Suspense>
  )
}
