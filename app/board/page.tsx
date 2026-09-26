'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { getGameStateByCode } from '@/lib/api'
import { claimLabel } from '@/lib/claims'
import type { CallRow, GameState } from '@/lib/types'
import { cutSet, useGameRoom } from '@/hooks/useGameRoom'

/**
 * Projector view. Read-only, needs no token, and is driven entirely by the
 * call feed so it stays in sync without the host touching anything.
 */
function Board() {
  const params = useSearchParams()
  const code = (params.get('code') ?? '').toUpperCase()
  const [fallback, setFallback] = useState<GameState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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
  const cut = useMemo(() => cutSet(state?.me ?? null), [state?.me])
  void cut

  const called = room.calledNumbers.size > 0 ? room.calledNumbers : new Set((state?.calls ?? []).map((c) => c.number))

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
    <main className="flex min-h-dvh flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="font-mono text-3xl font-black tracking-[0.3em] text-cyan sm:text-4xl">
            {state.code}
          </span>
          <span className="rounded-md bg-panel px-3 py-1 text-sm font-bold uppercase tracking-wider text-slate-300">
            {state.status}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {(state.players ?? []).filter((p) => !p.is_host).length} players · {called.size}/90 called
        </p>
      </header>

      <CallStage call={call} status={state.status} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Called</h2>
          <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
            {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => (
              <div
                key={n}
                className={[
                  'flex aspect-square items-center justify-center rounded border text-xs font-bold tabular-nums sm:text-sm',
                  called.has(n) ? 'border-cyan/70 bg-cyan/20 text-cyan' : 'border-edge/70 bg-ink/50 text-slate-700',
                ].join(' ')}
              >
                {n}
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
          <ol className="flex flex-col gap-1.5">
            {(state.players ?? [])
              .filter((p) => !p.is_host)
              .slice(0, 10)
              .map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-panel/60 px-3 py-2"
                >
                  <span className="w-5 text-xs font-bold tabular-nums text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="font-bold tabular-nums text-lime">{p.score}</span>
                </li>
              ))}
          </ol>

          {(state.claims ?? []).length > 0 ? (
            <>
              <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wider text-slate-300">Claims</h2>
              <ul className="flex flex-col gap-1">
                {(state.claims ?? [])
                  .slice(-6)
                  .reverse()
                  .map((c) => (
                    <li
                      key={c.id}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        c.status === 'accepted'
                          ? 'border-lime/50 bg-lime/10 text-lime'
                          : 'border-rose/40 bg-rose/10 text-rose'
                      }`}
                    >
                      {c.name} · {claimLabel(c.claim_type)} {c.status === 'accepted' ? `+${c.points}` : '✗'}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}

function CallStage({ call, status }: { call: CallRow | null; status: string }) {
  if (!call) {
    return (
      <div className="card flex min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
          {status === 'lobby' ? 'Waiting to start' : 'No calls yet'}
        </p>
        <p className="text-lg text-slate-400">The clue will appear here.</p>
      </div>
    )
  }

  return (
    <div className="card flex min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Call #{call.seq}</p>
      <p className="max-w-4xl text-3xl font-black leading-tight sm:text-5xl">{call.clue}</p>
      <p className="animate-pop text-7xl font-black tabular-nums text-cyan sm:text-9xl">{call.number}</p>
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
