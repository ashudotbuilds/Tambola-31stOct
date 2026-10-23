import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginUser } from '@/lib/api'
import { request } from '@/lib/http'
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { TicketPreview, PlaySteps } from '@/components/GameChrome'
import { ThemeToggle } from '@/lib/theme'

type DemoAccount = { id: string; name: string; email: string; role: string }
export default function Login() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
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
          : result.principal.type === 'SUPER_ADMIN' ? '/super-admin' : '/admin',
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
    <main className="login-shell">
      <header className="flex items-center justify-between gap-3 border-b border-edge py-5"><span className="eyebrow">Clues. Tickets. Full house.</span><ThemeToggle /></header>
      <div className="login-layout">
      <section className="min-w-0">
        <p className="eyebrow mb-5 text-cyan">A classic game. A technical twist.</p>
        <h1 className="login-title">Technical<br /><span className="text-cyan">Tambola</span></h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-slate-300">Crack the clue. Find the term. Race to a full house.<br className="hidden sm:block" /> Your next move is on the ticket.</p>
        <div className="hidden sm:block"><TicketPreview /></div>
      </section>
      <div className="min-w-0 space-y-7 lg:pt-2">
      <form className="login-form space-y-5" onSubmit={submit}>
        <div className="mb-6"><p className="eyebrow text-cyan">Ready when you are</p><h2 className="mt-2 text-3xl font-bold">Take your seat.</h2><p className="mt-2 text-sm text-slate-400">Sign in with your account.</p></div>
        <label className="block text-sm">
          User ID or email
          <input
            className="field mt-1"
            autoComplete="username"
            placeholder="Your ID or email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </label>
        <div className="relative">
        <label className="block text-sm">Password
          <input
            className="field mt-1 pr-14"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label><button className="absolute bottom-0 right-0 flex h-12 w-12 items-center justify-center text-slate-400 hover:text-cyan" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
        {error && (
          <p role="alert" className="text-rose">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? <><LoaderCircle size={16} className="animate-spin" />Signing in…</> : <>Sign in<ArrowRight size={16} className="ml-auto" /></>}
        </button>
        <p className="text-xs leading-relaxed text-slate-500">Use the credentials provided by your administrator.</p>
      </form>
      <PlaySteps />
      </div>
      </div>
      {accounts.length > 0 && (
        <section className="mb-10 border-t border-edge pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-lg font-bold">Testing accounts</h2><span className="eyebrow">Testing access</span></div>
          <p className="mt-1 text-sm text-slate-400">
            Choose an account to sign in. Password: DemoPass123!
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {accounts.map((account) => (
              <button
                key={account.id}
                className="btn min-w-0 items-start flex-col px-3 py-3 text-left text-xs"
                disabled={busy}
                onClick={() => void signIn(account.id, 'DemoPass123!')}
              >
                <span>{account.name}</span>
                <span className="text-[9px] text-slate-400">
                  {account.id} · {account.role.replaceAll('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <footer className="login-footer"><span>Technical Tambola</span><span>Play together. Think for yourself.</span></footer>
    </main>
  )
}
