'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
  const params = useSearchParams()
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
                    called.has(n) ? 'border-cyan/70 bg-cyan/20 text-cyan shadow-sm' : 'border-edge/70 bg-ink/40 text-slate-600',
                  ].join(' ')}
                >
                  {n}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-[45vh] overflow-y-auto pr-1">
              {Array.from(called).map((n) => {
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
              {called.size === 0 && (
                <p className="text-sm text-slate-500 italic">No technical items called yet.</p>
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

function ProjectorCallStage({
  call,
  status,
  isRevealed,
  customBank,
}: {
  call: CallRow | null
  status: string
  isRevealed: boolean
  customBank: TechnicalItem[] | null
}) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  if (!call) {
    return (
      <div className="card flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest bg-cyan/15 text-cyan border border-cyan/40">
          {status === 'lobby' ? 'Waiting to start' : 'Ready for Next Question'}
        </span>
        <p className="text-3xl font-black">Technical Tambola Challenge</p>
        <p className="text-base text-slate-400">Questions and code execution problems will appear here on the big screen.</p>
      </div>
    )
  }

  const item = getTechnicalItem(call.number, customBank)

  return (
    <div
      className={`card relative flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center shadow-xl transition-all ${
        isRevealed
          ? isLight
            ? 'border-emerald-300 bg-emerald-50/50'
            : 'border-cyan/50 bg-cyan/10'
          : isLight
            ? 'border-amber-300 bg-amber-50/50'
            : 'border-amber/50 bg-amber/10'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-ink px-3 py-1 font-mono text-sm font-bold text-slate-300">
          Call #{call.seq}
        </span>
        {item.category && (
          <span className="rounded-lg bg-purple-500/20 text-purple-400 px-3 py-1 text-xs font-bold">
            {item.category}
          </span>
        )}
        {isRevealed ? (
          <span className="rounded-full bg-emerald-500/20 text-emerald-600 dark:text-lime px-3 py-1 text-xs font-bold uppercase tracking-wider">
            ✓ Answer Revealed
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 text-amber-600 dark:text-amber px-3 py-1 text-xs font-bold uppercase tracking-wider animate-pulse">
            Decode on your tickets!
          </span>
        )}
      </div>

      <p className="max-w-4xl text-2xl sm:text-4xl md:text-5xl font-extrabold leading-snug tracking-tight">
        {item.clue || call.clue}
      </p>

      {item.codeSnippet && (
        <pre
          className={`p-4 rounded-xl text-left font-mono text-sm sm:text-base max-w-xl mx-auto overflow-x-auto shadow-inner ${
            isLight ? 'bg-slate-900 text-emerald-400' : 'bg-black/90 text-lime'
          }`}
        >
          {item.codeSnippet}
        </pre>
      )}

      {isRevealed ? (
        <div className="animate-pop mt-2 space-y-1">
          <p className="text-xs uppercase tracking-widest text-slate-400">Official Term</p>
          <div className="inline-block rounded-2xl bg-cyan/20 border-2 border-cyan px-8 py-3 shadow-2xl">
            <p className="text-4xl sm:text-6xl font-black text-cyan tracking-tight">{item.term}</p>
          </div>
          <p className="text-xs font-mono text-slate-400 mt-1">Item #{call.number}</p>
        </div>
      ) : (
        <p className="text-base font-bold text-amber-500 dark:text-amber-400 animate-pulse mt-2">
          ⚡ Waiting for host to reveal the answer... Tap your ticket if you know it!
        </p>
      )}
    </div>
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
