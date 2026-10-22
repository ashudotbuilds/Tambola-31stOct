import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#05070f',
        panel: '#0d1424',
        edge: '#1e2a44',
        cyan: '#22d3ee',
        lime: '#a3e635',
        amber: '#fbbf24',
        rose: '#fb7185',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        flash: {
          '0%': { backgroundColor: 'rgba(163,230,53,0.45)' },
          '100%': { backgroundColor: 'rgba(163,230,53,0)' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        pop: 'pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        flash: 'flash 900ms ease-out',
        shake: 'shake 400ms ease-in-out',
      },
    },
  },
  plugins: [],
}

export default config
