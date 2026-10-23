import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginUser } from '@/lib/api'
import { request } from '@/lib/http'

type DemoAccount = { id: string; name: string; email: string; role: string }
export default function Login() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [accounts, setAccounts] = useState<DemoAccount[]>([])
  useEffect(() => {
    request<{ accounts: DemoAccount[] }>('/v1/demo/accounts')
      .then((result) => setAccounts(result.accounts))
      .catch(() => {})
  }, [])
  async function signIn(id: string, secret: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await loginUser(id, secret)
      localStorage.setItem('tt.account.id', result.user.id)
      navigate(
        result.principal.type === 'PARTICIPANT'
          ? '/account' + window.location.search
          : '/admin',
        { replace: true },
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void signIn(identifier, password)
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-4 py-8">
      <form className="card space-y-4 p-6" onSubmit={submit}>
        <h1 className="text-3xl font-black">Technical Tambola</h1>
        <p className="text-sm text-slate-400">Sign in to continue.</p>
        <label className="block text-sm">
          User ID or email
          <input
            className="field mt-1"
            autoComplete="username"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            className="field mt-1"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-rose">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {accounts.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">Testing accounts</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose an account to sign in. Password: DemoPass123!
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {accounts.map((account) => (
              <button
                key={account.id}
                className="btn flex-col text-xs"
                disabled={busy}
                onClick={() => void signIn(account.id, 'DemoPass123!')}
              >
                <span>{account.name}</span>
                <span className="text-[10px]">
                  {account.id} · {account.role.replaceAll('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
