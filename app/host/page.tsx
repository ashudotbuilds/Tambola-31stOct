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
import { drawNumber, sessions, setGameStatus, startGame } from '@/lib/api'
import { play, primeAudio, setMuted, speak, stopSpeaking } from '@/lib/sound'
import type { HostSession } from '@/lib/types'
import { useGameRoom } from '@/hooks/useGameRoom'

export default function HostScreen() {
  const router = useRouter()
  const [session, setSession] = useState<HostSession | null>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<CluePhase>('idle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [speakClues, setSpeakClues] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
  const revealSeconds = state?.settings?.reveal_seconds ?? 3
  const pauseSeconds = state?.settings?.pause_after_calls ?? 4

  // QR code for the projector and for players to scan.
  useEffect(() => {
    if (!session) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('code', session.code)
    QRCode.toDataURL(url.toString(), { margin: 1, width: 360, color: { dark: '#e2e8f0', light: '#0d1424' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [session])

  const call = useCallback(async () => {
    if (!session || busy || phase !== 'idle') return
    setBusy(true)
    setMessage(null)
    primeAudio()
    try {
      await drawNumber(session.game_id, session.host_token)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not call a number')
    } finally {
      setBusy(false)
    }
  }, [session, busy, phase])

  // Space bar calls the next number, so the host never has to look at the mouse.
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
  const callBlocked = !canCall || phase !== 'idle' || busy

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-black tracking-tight text-slate-500 hover:text-cyan">
            ←
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan">Host screen</p>
            <h1 className="text-xl font-black sm:text-2xl">Technical Tambola</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <ConnectionDot connection={room.connection} />
          <button type="button" onClick={toggleMute} className="btn px-3 py-2 text-xs">
            {muted ? '🔇 Muted' : '🔊 Sound'}
          </button>
          <Link
            href={`/board?code=${session.code}`}
            target="_blank"
            className="btn px-3 py-2 text-xs"
          >
            Projector view
          </Link>
        </div>
      </header>

      {room.error ? (
        <p className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-sm text-rose">{room.error}</p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber">{message}</p>
      ) : null}

      {status === 'lobby' ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card flex flex-col items-center gap-5 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Share this code</p>
            <CodeChip code={session.code} />
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code to join this game" className="h-48 w-48 rounded-lg" />
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onCopyLink} className="btn text-xs">
                {copied ? 'Link copied' : 'Copy join link'}
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
              <ClueStage
                call={room.lastCall}
                revealSeconds={revealSeconds}
                pauseSeconds={pauseSeconds}
                speakClues={speakClues}
                onPhaseChange={setPhase}
              />

              <div className="card flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  className="btn btn-primary flex-1 text-lg"
                  disabled={callBlocked}
                  onClick={call}
                >
                  {status === 'finished'
                    ? 'Game over'
                    : status === 'paused'
                      ? 'Paused'
                      : phase !== 'idle'
                        ? 'Call in progress…'
                        : `Call number (${state?.calls.length ?? 0}/90)`}
                </button>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={speakClues}
                    onChange={(e) => setSpeakClues(e.target.checked)}
                    className="h-4 w-4 accent-cyan"
                  />
                  Read clues aloud
                </label>
                {status === 'playing' || status === 'closing' ? (
                  <>
                    <button type="button" className="btn" disabled={busy} onClick={onTogglePause}>
                      Pause
                    </button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={onEnd}>
                      End
                    </button>
                  </>
                ) : null}
              </div>

              <div className="card p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">
                  Called numbers
                </h2>
                <NumberBoard called={room.calledNumbers} latest={room.lastCall?.number ?? null} />
              </div>
            </div>

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

          {status === 'finished' ? <Results players={players} state={state} /> : null}
        </>
      )}
    </main>
  )
}

function Results({
  players,
  state,
}: {
  players: { id: string; name: string; score: number; is_host: boolean; wrong_claims: number }[]
  state: { calls: { seq: number; number: number; clue: string }[] } | null
}) {
  const podium = players.filter((p) => !p.is_host).slice(0, 3)
  const medals = ['🥇', '🥈', '🥉']

  return (
    <section className="card p-5 sm:p-6">
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
        {(state?.calls ?? []).map((c) => (
          <li key={c.seq} className="flex items-baseline gap-2 rounded-md border border-edge bg-panel/50 px-2 py-1">
            <span className="text-[10px] tabular-nums text-slate-500">#{c.seq}</span>
            <span className="font-bold tabular-nums text-cyan">{c.number}</span>
            <span className="truncate text-xs text-slate-400">{c.clue}</span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex gap-2">
        <Link href="/" className="btn text-xs">
          New game
        </Link>
      </div>
    </section>
  )
}
