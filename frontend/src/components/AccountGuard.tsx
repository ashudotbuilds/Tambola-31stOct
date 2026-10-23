import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getCurrentUser } from '@/lib/api'

export default function AccountGuard({
  children,
  role,
}: {
  children: ReactNode
  role?: 'admin' | 'member' | 'super-admin'
}) {
  const [state, setState] = useState<string | null>(null)
  const location = useLocation()
  useEffect(() => {
    let active = true
    getCurrentUser()
      .then((result) => {
        if (active) setState(result.principal.type)
      })
      .catch(() => {
        if (active) setState('anonymous')
      })
    return () => {
      active = false
    }
  }, [location.pathname])
  if (!state)
    return (
      <main className="p-8" role="status">
        Checking your account…
      </main>
    )
  if (state === 'anonymous') return <Navigate to="/login" replace />
  if (role === 'admin' && state === 'PARTICIPANT')
    return <Navigate to="/account" replace />
  if (role === 'super-admin' && state !== 'SUPER_ADMIN')
    return <Navigate to={state === 'PARTICIPANT' ? '/account' : '/admin'} replace />
  if (role === 'member' && state !== 'PARTICIPANT')
    return <Navigate to="/admin" replace />
  return children
}
