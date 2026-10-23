import { useEffect, useState, type FormEvent } from 'react'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { createAdminAccount, deleteAdminAccount, listAdminAccounts, regenerateAdminCredential, type AdminAccount } from '@/lib/api'

export default function AdminAccounts() {
  const { account, error } = useAdminAccount()
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  useEffect(() => {
    let active = true
    listAdminAccounts().then(result => { if (active) setAdmins(result.admins) }).catch(cause => { if (active) setAdminError(cause instanceof Error ? cause.message : 'Could not load administrators') })
    return () => { active = false }
  }, [])
  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setAdminBusy(true)
    setAdminError(null)
    try {
      await createAdminAccount({
        email: String(data.get('email') ?? ''),
        name: String(data.get('name') ?? ''),
        role: String(data.get('role')) === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
      })
      form.reset()
      const response = await listAdminAccounts()
      setAdmins(response.admins)
    } catch (cause) {
      setAdminError(cause instanceof Error ? cause.message : 'Could not create administrator')
      try { setAdmins((await listAdminAccounts()).admins) } catch { /* Keep the original delivery or create error visible. */ }
    } finally {
      setAdminBusy(false)
    }
  }

  async function removeAdmin(profileId: string) {
    if (!window.confirm('Remove this administrator account? Their active sessions will stop working.')) return
    setAdminBusy(true)
    setAdminError(null)
    try {
      await deleteAdminAccount(profileId)
      setAdmins(current => current.filter(admin => admin.id !== profileId))
    } catch (cause) {
      setAdminError(cause instanceof Error ? cause.message : 'Could not remove administrator')
    } finally {
      setAdminBusy(false)
    }
  }

  return <AdminPage account={account} error={error} title="Create admin" description="Manage administrators and send their sign-in credentials.">
      <section id="administrators" className="card p-5">
        <h2 className="text-lg font-bold">Administrator accounts</h2>
        <p className="mt-1 text-sm text-slate-400">The account stays inactive until its temporary password is delivered to the administrator by email.</p>
        {adminError && <p role="alert" className="mt-3 rounded-lg border border-rose/50 bg-rose/10 p-3 text-sm text-rose">{adminError}</p>}
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={addAdmin}>
          <label className="text-sm">Name<input className="field mt-1" name="name" required maxLength={100} /></label>
          <label className="text-sm">Email<input className="field mt-1" name="email" type="email" required maxLength={255} /></label>
          <label className="text-sm">Role<select className="field mt-1" name="role" defaultValue="ADMIN"><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option></select></label>
          <button className="btn btn-primary sm:col-span-2" type="submit" disabled={adminBusy}>{adminBusy ? 'Saving…' : 'Create administrator'}</button>
        </form>
        <div className="mt-5 divide-y divide-edge">
          {admins.map(admin => <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-semibold">{admin.name} <span className="text-xs text-slate-400">{admin.role}</span></p><p className="text-slate-400">{admin.email}</p><p className="text-[11px] text-slate-500">Credentials: {admin.credential_status?.toLowerCase() ?? 'not issued'}{admin.credential_last_sent_at ? ` · sent ${new Date(admin.credential_last_sent_at).toLocaleString()}` : ''}</p></div>
            <div className="flex flex-wrap gap-2">{admin.credential_status !== 'PENDING' && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={async () => {
              if (!window.confirm(`Generate and email a new password to ${admin.email}? Their existing sessions will end.`)) return
              setAdminBusy(true); setAdminError(null)
              try { await regenerateAdminCredential(admin.id); setAdmins((await listAdminAccounts()).admins) }
              catch (cause) { setAdminError(cause instanceof Error ? cause.message : 'Credential email failed') }
              finally { setAdminBusy(false) }
            }} disabled={adminBusy}>Regenerate credentials</button>}{admin.user_id !== account?.user.id && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => removeAdmin(admin.id)} disabled={adminBusy}>Remove</button>}</div>
          </div>)}
          {admins.length === 0 && <p className="py-3 text-sm text-slate-400">No administrator accounts yet.</p>}
        </div>
      </section>
  </AdminPage>
}
