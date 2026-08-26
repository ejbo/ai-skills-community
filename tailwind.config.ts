import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        admin: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.8125rem', { lineHeight: '1.55' }],
        base: ['0.9375rem', { lineHeight: '1.55' }],
        lg: ['1.0625rem', { lineHeight: '1.5' }],
        xl: ['1.1875rem', { lineHeight: '1.4' }],
        '2xl': ['1.375rem', { lineHeight: '1.3' }],
        '3xl': ['1.75rem', { lineHeight: '1.25' }],
        '4xl': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        '5xl': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
      colors: {
        /**
         * Kept only so a stray `accent-*` class in future code still resolves
         * to SOMETHING sane. Nothing in app/ or components/ uses this ramp any
         * more: chrome is ink (zinc + the per-theme `--accent` token in
         * globals.css) and colour is reserved for content. Reach for zinc, or
         * for the content palettes (source/ok/warn/danger) and the per-domain
         * category maps (discussion/events badges.tsx).
         */
        accent: {
          50: '#EEF0FF',
          100: '#DCDFFF',
          200: '#B8BDFF',
          300: '#9499FF',
          400: '#8A86FF',
          500: '#5E5AFF',
          600: '#4A46DB',
          700: '#3833A8',
          800: '#2B287F',
          900: '#1E1C57',
        },
        // Legacy skill-source hexes. SourceBadge now uses the blue/emerald/
        // violet ramps directly so it can carry a dark-mode variant.
        source: {
          internal: '#4A6FA5',
          external: '#3FA577',
          curated: '#8A6FD9',
        },
        ok: '#2F8F65',
        warn: '#C58A2E',
        danger: '#C44A4A',
        info: '#4A7DC4',
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      animation: {
        shimmer: 'shimmer 1.4s linear infinite',
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 220ms ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [typography],
};

export default config;
