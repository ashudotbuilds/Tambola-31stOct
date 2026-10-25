import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCurrentUser,
  joinGame,
  logoutUser,
  sessions,
} from '@/lib/api'
import { request } from '@/lib/http'
import { ArrowRight, LogOut } from 'lucide-react'
import { BackLink } from '@/components/BackLink'
import { GameHeader, PlaySteps } from '@/components/GameChrome'
export default function ParticipantHome() {
  const navigate = useNavigate()
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [code, setCode] = useState(
      new URLSearchParams(window.location.search).get('code') ?? '',
    ),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [joinError, setJoinError] = useState<string | null>(null),
    [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    getCurrentUser()
      .then((account) => {
        if (active) {
          setName(account.user.name)
          setEmail(account.user.email)
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
        {sessions.loadPlayer() && <BackLink to="/play" label="Back to my ticket" text="My ticket" />}
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
          setJoinError(null)
          setMessage('')
          try {
            await joinGame(code, name)
            navigate('/play')
          } catch (cause) {
            const rawMsg = cause instanceof Error ? cause.message : 'Could not join game'
            const friendlyMsg =
              rawMsg.includes('404') || rawMsg.toLowerCase().includes('not found')
                ? 'This game code does not exist or has been ended by the host.'
                : rawMsg
            setJoinError(friendlyMsg)
          } finally {
            setBusy(false)
          }
        }}
      >
        <h2 className="text-2xl font-bold">Join a game</h2>
        <p className="text-sm text-slate-400">
          Enter the host’s code. Practice with the tutorial while
          waiting for the game to start.
        </p>
        {joinError && (
          <div role="alert" className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-3 text-sm font-semibold text-rose flex items-start gap-2">
            <span className="text-base leading-none">⚠️</span>
            <span>{joinError}</span>
          </div>
        )}
        <label className="block text-sm">
          Game code
          <input
            className="field join-code mt-2"
            placeholder="______"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase())
              if (joinError) setJoinError(null)
            }}
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
    </main>
  )
}
