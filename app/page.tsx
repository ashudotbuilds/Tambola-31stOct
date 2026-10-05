'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createGame, joinGame, sessions } from '@/lib/api'
import { isConfigured } from '@/lib/insforge'
import { primeAudio } from '@/lib/sound'

import { ThemeToggle } from '@/lib/theme'

export default function Landing() {
  const router = useRouter()
  const [hostName, setHostName] = useState('')
  const [code, setCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [busy, setBusy] = useState<'host' | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resume, setResume] = useState<{ host: string | null; player: string | null }>({
    host: null,
    player: null,
  })

  useEffect(() => {
    setResume({
      host: sessions.loadHost()?.code ?? null,
      player: sessions.loadPlayer()?.code ?? null,
    })
    // A QR scan lands here with ?code=ABC123.
    const fromLink = new URLSearchParams(window.location.search).get('code')
    if (fromLink) setCode(fromLink.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  }, [])

  const configured = isConfigured()

  async function handleCreate() {
    if (!hostName.trim()) {
      setError('Enter a name to be called out as the host.')
      return
    }
    setBusy('host')
    setError(null)
    try {
      primeAudio()
      await createGame(hostName)
      router.push('/host')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the game')
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin() {
    if (code.trim().length !== 6) {
      setError('The game code is 6 characters.')
      return
    }
    if (!playerName.trim()) {
      setError('Enter a name for your ticket.')
      return
    }
    setBusy('join')
    setError(null)
    try {
      primeAudio()
      await joinGame(code, playerName)
      router.push('/play')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the game')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:py-14">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-cyan">ACM Engineering Day</p>
        <h1 className="mt-3 text-4xl font-black leading-none sm:text-6xl">
          Technical <span className="text-cyan">Tambola</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-slate-400 sm:text-base">
          Multiplayer technical tambola with terms, code execution outputs, and computer science clues instead of raw numbers.
        </p>
      </header>

      {!configured ? (
        <div className="card border-rose/60 bg-rose/10 p-4 text-sm text-rose">
          Missing <code className="font-mono">NEXT_PUBLIC_INSFORGE_URL</code> or{' '}
          <code className="font-mono">NEXT_PUBLIC_INSFORGE_ANON_KEY</code> in <code className="font-mono">.env.local</code>.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold">Host a game</h2>
            <p className="mt-1 text-sm text-slate-400">
              You get a 6-character code and a QR code. Players join from their phones.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="host-name">
              Host name
            </label>
            <input
              id="host-name"
              className="field"
              value={hostName}
              maxLength={24}
              placeholder="e.g. MC Aditya"
              onChange={(e) => setHostName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy !== null || !configured}
            onClick={handleCreate}
          >
            {busy === 'host' ? 'Creating…' : 'Create game'}
          </button>
          {resume.host ? (
            <Link href="/host" className="btn w-full text-xs">
              Resume hosting {resume.host}
            </Link>
          ) : null}
        </section>

        <section className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold">Join a game</h2>
            <p className="mt-1 text-sm text-slate-400">
              Enter the code on the projector screen. No account needed.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="code">
              Game code
            </label>
            <input
              id="code"
              className="field font-mono text-2xl font-bold uppercase tracking-[0.3em]"
              value={code}
              maxLength={6}
              placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div>
            <label className="label" htmlFor="player-name">
              Your name
            </label>
            <input
              id="player-name"
              className="field"
              value={playerName}
              maxLength={24}
              placeholder="e.g. Aditya"
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>
          <button
            type="button"
            className="btn w-full"
            disabled={busy !== null || !configured}
            onClick={handleJoin}
          >
            {busy === 'join' ? 'Joining…' : 'Join game'}
          </button>
          {resume.player ? (
            <Link href="/play" className="btn w-full text-xs">
              Back to my ticket {resume.player}
            </Link>
          ) : null}
        </section>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-3 text-sm text-rose">
          {error}
        </p>
      ) : null}

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">How a round works</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {[
            {
              t: '1. Call a clue',
              d: 'The host presses call. Everyone sees a tech riddle — "404 — Not Found" — and a countdown.',
            },
            {
              t: '2. Decode and daub',
              d: 'The number is revealed and stamped on your ticket automatically. Only your eyes were the test.',
            },
            {
              t: '3. Shout your claim',
              d: 'Lines, corners and the full house pay points. A wrong claim costs 10 and cuts one of your numbers.',
            },
          ].map((step) => (
            <div key={step.t}>
              <p className="font-bold text-cyan">{step.t}</p>
              <p className="mt-1 text-sm text-slate-400">{step.d}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
