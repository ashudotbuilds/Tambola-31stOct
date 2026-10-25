import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { App } from './App'
import './styles/fonts.css'
import './styles/globals.css'
import { startTelemetry } from './lib/telemetry'
import { TelemetryNavigation } from './components/TelemetryNavigation'

startTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TelemetryNavigation />
      <ThemeProvider><App /></ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
