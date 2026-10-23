import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#161513',
        panel: '#211f1b',
        edge: '#454038',
        cyan: '#ff8a4c',
        lime: '#bdd59b',
        amber: '#e8b86b',
        rose: '#f18e85',
        slate: { 100: '#f2ebdf', 200: '#e3dace', 300: '#ccc1b1', 400: '#b4a897', 500: '#a29686', 600: '#7c7366', 700: '#554e44', 800: '#35302a', 900: '#211e1a' },
      },
      borderRadius: { md: '4px', lg: '5px', xl: '6px', '2xl': '8px', '3xl': '10px' },
      fontFamily: {
        sans: ['Space Grotesk Variable', 'system-ui', 'sans-serif'],
        display: ['Chakra Petch', 'sans-serif'],
        mono: ['Space Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        pop: {
          '0%': { transform: 'translateY(5px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
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
        pop: 'pop 180ms ease-out',
        flash: 'flash 900ms ease-out',
        shake: 'shake 400ms ease-in-out',
      },
    },
  },
  plugins: [],
}

export default config
