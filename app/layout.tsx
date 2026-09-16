import type { Metadata } from 'next';
import Link from 'next/link';
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';

/**
 * Three families, each with one job: a serif for display, a grotesque for
 * reading, a monospace for anything the eye should parse as data.
 *
 * next/font self-hosts these at build time, so no request ever leaves the
 * browser for a font CDN — which is both faster and the reason the CSP can keep
 * `connect-src 'self'` with no font origin punched through it.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
});

const sans = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-archivo',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Exposure Scanner',
  description:
    'Find out where your own personal information is publicly exposed, understand what it means, and do something about it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <div className="mx-auto flex min-h-screen max-w-dossier flex-col px-5 sm:px-8">
          <header className="flex items-baseline justify-between gap-4 py-6">
            <Link href="/" className="tag-accent hover:opacity-80">
              Exposure Scanner
            </Link>
            <nav className="flex items-center gap-5">
              <Link href="/about/sources" className="tag hover:text-ink">
                What we check
              </Link>
              <Link href="/about/privacy" className="tag hover:text-ink">
                Privacy
              </Link>
            </nav>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="rule mt-16 py-6">
            <p className="max-w-readable font-mono text-[0.6875rem] leading-relaxed text-faint">
              For checking your own exposure. Never collects, stores or displays passwords. Not a
              background-check service — not for employment, tenancy or credit screening.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
