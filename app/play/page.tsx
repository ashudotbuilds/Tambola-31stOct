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

interface Toast {
  id: number
  tone: 'good' | 'bad' | 'info'
  text: string
}

export default function PlayerScreen() {
  const router = useRouter()
  const [session, setSession] = useState<PlayerSession | null>(null)
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const stored = sessions.loadPlayer()
    if (!stored) {
      router.replace('/')
      return
    }
    setSession(stored)
    setReady(true)
  }, [router])

  const pushToast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-2), { id, tone, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200)
  }, [])

  // Held in a ref so the realtime handler can refetch without the handler
  // having to close over the room it is passed into.
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
  const marked = useMemo(
    () => deriveMarked(me?.ticket, room.calledNumbers, cut),
    [me?.ticket, room.calledNumbers, cut],
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan">
              {me?.name ?? session.display_name}
            </p>
            <h1 className="text-xl font-black">Your ticket</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <ConnectionDot connection={room.connection} />
        </div>
      </header>

      {room.error ? (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-sm text-rose">{room.error}</p>
      ) : null}

      <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="label mb-1">Game</p>
          <CodeChip code={session.code} className="text-lg sm:text-xl" />
        </div>
        <div className="text-right">
          <p className="label mb-1">Score</p>
          <p className="text-3xl font-black tabular-nums text-lime">{me?.score ?? 0}</p>
          <p className="text-[11px] text-slate-500">
            {room.myRank ? `rank ${room.myRank} of ${(state?.players ?? []).filter((p) => !p.is_host).length}` : '—'}
            {me && me.wrong_claims > 0 ? ` · ${me.wrong_claims} cut` : ''}
          </p>
        </div>
      </section>

      {call ? (
        <section className="card flex items-center gap-4 p-4">
          <div className="flex h-16 w-16 shrink-0 animate-pop items-center justify-center rounded-xl border border-cyan/70 bg-cyan/15 text-3xl font-black tabular-nums text-cyan">
            {call.number}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Latest call · #{call.seq}
            </p>
            <p className="truncate text-sm font-semibold sm:text-base">{call.clue}</p>
          </div>
        </section>
      ) : null}

      <Ticket ticket={me?.ticket ?? null} marked={marked} cut={cut} latest={call?.number ?? null} />

      {status === 'lobby' ? (
        <p className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-3 text-center text-sm text-amber">
          Waiting for the host to start the game.
        </p>
      ) : (
        <ClaimButtons
          ticket={me?.ticket ?? null}
          marked={marked}
          cut={cut}
          state={state}
          won={room.wonClaims}
          taken={room.takenClaims}
          busy={busy}
          onClaim={onClaim}
        />
      )}

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider text-slate-300">
          All 90 numbers
        </summary>
        <div className="mt-3">
          <NumberBoard called={room.calledNumbers} latest={call?.number ?? null} compact />
        </div>
      </details>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2>
        <Leaderboard players={state?.players ?? []} meId={me?.player_id} limit={8} dense />
      </section>

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
