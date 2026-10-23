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
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">Welcome, {name}</h1>
        <button
          className="btn"
          onClick={async () => {
            await logoutUser()
            navigate('/login', { replace: true })
          }}
        >
          Sign out
        </button>
      </header>
      <form
        className="card space-y-3 p-5"
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
        <h2 className="text-xl font-bold">Join a game</h2>
        <p className="text-sm text-slate-400">
          Enter the administrator’s code. Practice with the tutorial while
          waiting for the game to start.
        </p>
        <label className="block text-sm">
          Game code
          <input
            className="field mt-1 uppercase"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            minLength={6}
            maxLength={6}
          />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          Join game
        </button>
      </form>
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
