import React, { createContext, useContext, useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const THEME_STORAGE_KEY = 'tt.theme'

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
      if (stored === 'dark' || stored === 'light') {
        setThemeState(stored)
      } else {
        setThemeState('dark')
      }
    } catch {
      setThemeState('dark')
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    try {
      if (theme === 'light') {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      } else {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#161513' : '#f1ebdf')
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme, mounted])

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  const setTheme = (t: Theme) => {
    setThemeState(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`btn min-h-11 px-3 text-xs ${className}`}
      title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
      aria-label="Toggle theme"
    >
      {theme === 'light' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
      <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  )
}
