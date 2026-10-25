import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackTelemetry } from '@/lib/telemetry'

export function TelemetryNavigation() {
  const { pathname } = useLocation()
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    trackTelemetry('$pageview', { $pathname: pathname })
  }, [pathname])
  return null
}
