import type { Config } from 'tailwindcss';

/**
 * Colours are CSS custom properties in app/globals.css so light and dark share
 * one set of component classes.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        alarm: 'rgb(var(--alarm) / <alpha-value>)',
        glass: 'rgb(var(--glass) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        glass: 'var(--radius)',
        'glass-sm': 'var(--radius-sm)',
        'glass-lg': 'var(--radius-lg)',
      },
      maxWidth: {
        readable: '44rem',
        shell: '60rem',
      },
    },
  },
  plugins: [],
};

export default config;
