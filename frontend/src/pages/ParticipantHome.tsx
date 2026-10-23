import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getCurrentUser,
  joinGame,
  listMyRounds,
  logoutUser,
  type ParticipantRoundInfo,
} from '@/lib/api'
import { request } from '@/lib/http'
import { ArrowRight, LogOut } from 'lucide-react'
import { GameHeader, PlaySteps } from '@/components/GameChrome'
export default function ParticipantHome() {
  const navigate = useNavigate()
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [rounds, setRounds] = useState<ParticipantRoundInfo[]>([]),
    [code, setCode] = useState(
      new URLSearchParams(window.location.search).get('code') ?? '',
    ),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([getCurrentUser(), listMyRounds()])
      .then(([account, result]) => {
        if (active) {
          setName(account.user.name)
          setEmail(account.user.email)
          setRounds(result.rounds)
        }
      })
      .catch((cause) => setMessage(cause.message))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  if (loading)
    return (
      <main className="p-8" role="status">
        Loading your account…
      </main>
    )
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-7 px-4 py-6 sm:px-6 sm:py-8">
      <GameHeader section="Player lounge">
        <button
          className="btn"
          onClick={async () => {
            await logoutUser()
            navigate('/login', { replace: true })
          }}
        >
          <LogOut size={14} aria-hidden="true" />Sign out
        </button>
      </GameHeader>
      <div className="pt-3"><p className="eyebrow text-cyan">Welcome, {name}</p><h1 className="mt-3 text-4xl font-bold sm:text-5xl">Got a game code?</h1><p className="mt-3 text-sm text-slate-400">Your ticket is one code away.</p></div>
      <form
        className="card join-panel space-y-5"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setMessage('')
          try {
            await joinGame(code, name)
            navigate('/play')
          } catch (cause) {
            setMessage(
              cause instanceof Error ? cause.message : 'Could not join game',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <h2 className="text-2xl font-bold">Join a game</h2>
        <p className="text-sm text-slate-400">
          Enter the administrator’s code. Practice with the tutorial while
          waiting for the game to start.
        </p>
        <label className="block text-sm">
          Game code
          <input
            className="field join-code mt-2"
            placeholder="______"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            minLength={6}
            maxLength={6}
          />
        </label>
        <button className="btn btn-primary w-full sm:w-auto sm:min-w-52" disabled={busy}>
          Join game<ArrowRight size={16} className="ml-auto" aria-hidden="true" />
        </button>
      </form>
      <PlaySteps />
      <details className="card p-5">
        <summary className="cursor-pointer font-bold">Account settings</summary>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget
            const values = new FormData(form)
            setBusy(true)
            try {
              await request('/v1/auth/profile', {
                method: 'PATCH',
                body: {
                  name,
                  email,
                  currentPassword: values.get('currentPassword'),
                  ...(values.get('password')
                    ? { password: values.get('password') }
                    : {}),
                },
              })
              setMessage('Profile saved')
              form.reset()
            } catch (cause) {
              setMessage(
                cause instanceof Error
                  ? cause.message
                  : 'Could not save profile',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm">
            Name
            <input
              className="field mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={24}
            />
          </label>
          <label className="block text-sm">
            Email
            <input
              className="field mt-1"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Current password
            <input
              className="field mt-1"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block text-sm">
            New password (optional)
            <input
              className="field mt-1"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
            />
          </label>
          <button className="btn" disabled={busy}>
            Save settings
          </button>
        </form>
      </details>
      {message && (
        <p role="status" className="card p-4">
          {message}
        </p>
      )}
      {rounds.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl font-bold">Assigned event rounds</h2>
          {rounds.map((round) => (
            <article
              key={round.id}
              className="mt-3 flex items-center justify-between gap-3"
            >
              <p>
                {round.name} · {round.status}
              </p>
              {round.has_ticket && (
                <Link className="btn" to={`/account/round/${round.id}`}>
                  Open ticket
                </Link>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
