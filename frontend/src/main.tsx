import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { App } from './App'
import './styles/fonts.css'
import './styles/globals.css'
import { startTelemetry } from './lib/telemetry'
import { TelemetryNavigation } from './components/TelemetryNavigation'
import { Analytics } from '@vercel/analytics/react'

startTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TelemetryNavigation />
      <Analytics />
      <ThemeProvider><App /></ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
