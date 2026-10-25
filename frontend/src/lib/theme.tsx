import type { ReactNode } from 'react'

// One theme; preferences saved by older releases are ignored.
export function ThemeProvider({ children }: { children: ReactNode }) { return children }
export function useTheme(): { theme: 'dark' | 'light' } { return { theme: 'dark' } }
