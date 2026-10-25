import { useState } from 'react'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { request } from '@/lib/http'

type ProvisionedAccounts = { ok: true; count: number; loginIdPrefix: string; firstLoginId: string; lastLoginId: string; password: string }

export default function LoadTestSetup() {
  const { account, error } = useAdminAccount()
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function provision() {
    setBusy(true); setFailure(null); setMessage(null); setPassword(null); setCopied(false)
    try {
      const result = await request<ProvisionedAccounts>('/v1/super-admin/load-test/accounts', { method: 'POST', body: {} })
      setPassword(result.password)
      setMessage(`${result.count} dedicated participant accounts are ready. Save the password now; it will not be shown again.`)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not create the load-test accounts')
    } finally { setBusy(false) }
  }

  async function disable() {
    if (!window.confirm('Suspend the 100 load-test accounts and revoke their active sessions?')) return
    setBusy(true); setFailure(null); setMessage(null); setPassword(null)
    try {
      const result = await request<{ disabled: number }>('/v1/super-admin/load-test/accounts', { method: 'DELETE' })
      setMessage(`${result.disabled} load-test accounts suspended; active sessions revoked.`)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not disable the load-test accounts')
    } finally { setBusy(false) }
  }

  async function copyPassword() {
    if (!password) return
    try { await navigator.clipboard.writeText(password); setCopied(true) }
    catch { setFailure('Clipboard access failed. Select and copy the password manually.') }
  }

  return <AdminPage account={account} error={error} title="Load test setup" description="Prepare isolated participant accounts for the authenticated k6 game test.">
    <section className="card space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-bold">100 load-test accounts</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">Creates or resets <code>tt-load-user0001</code> through <code>tt-load-user0100</code>. The k6 scenario uses your Super Admin account as the host and up to 99 of these participants, matching the game's 100-seat limit.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void provision()}>{busy ? 'Working…' : 'Create / reset accounts'}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void disable()}>Disable accounts</button>
      </div>
      {message && <p role="status" className="rounded border border-cyan/40 bg-cyan/5 p-3 text-sm">{message}</p>}
      {failure && <p role="alert" className="rounded border border-rose/40 p-3 text-sm text-rose">{failure}</p>}
      {password && <div className="rounded border border-edge p-4">
        <label className="text-xs text-slate-400" htmlFor="load-test-password">One-time shared test password</label>
        <div className="mt-2 flex flex-wrap items-center gap-3"><input id="load-test-password" className="field min-w-64 flex-1 font-mono" readOnly value={password} onFocus={event => event.currentTarget.select()} /><button className="btn" type="button" onClick={() => void copyPassword()}>{copied ? 'Copied' : 'Copy password'}</button></div>
        <p className="mt-2 text-xs text-slate-500">Resetting the accounts rotates this password and revokes their current sessions.</p>
      </div>}
    </section>
    <section className="card space-y-4 p-5 sm:p-6">
      <div><h2 className="text-xl font-bold">Run k6 from PowerShell</h2><p className="mt-2 text-sm text-slate-400">Create these accounts above first. Then set the backend URL, Super Admin credentials, and the generated account password in your terminal.</p></div>
      <pre className="overflow-x-auto rounded border border-edge bg-black/20 p-4 text-xs leading-relaxed text-slate-200"><code>{`$env:BASE_URL = 'https://YOUR-BACKEND-ORIGIN'
$env:FRONTEND_ORIGIN = 'https://YOUR-FRONTEND-ORIGIN'
$env:ADMIN_LOGIN = 'your-super-admin-email'
$env:ADMIN_PASSWORD = Read-Host 'Super Admin password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:LOAD_TEST_PASSWORD = Read-Host 'Generated load-test password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:MAX_VUS = '10'
k6 run .\\loadtest\\k6\\game-read.js`}</code></pre>
      <p className="text-sm text-slate-400">Run maximums 10, 15, 20, 50, then 100. Setup signs in each account slowly to stay within the API login limit, so a 100-user run takes about seven minutes to prepare before its load ramp.</p>
      <p className="text-sm text-slate-400">The script removes its temporary game afterward. Disable the accounts here when testing is finished. This exercises authenticated HTTP polling; it does not simulate Socket.IO connections or real browser rendering.</p>
    </section>
  </AdminPage>
}
