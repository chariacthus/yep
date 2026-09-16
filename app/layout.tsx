import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Inter is the fallback, not the first choice: the stack in globals.css starts
 * with -apple-system, so Apple devices render real SF Pro and everything else
 * gets the closest free equivalent. next/font self-hosts it, so no request ever
 * leaves the browser for a font CDN and the CSP keeps `connect-src 'self'`.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Exposure Scanner',
  description:
    'Find out where your own personal information is publicly exposed, understand what it means, and do something about it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">
        {/* The ground the glass blurs. Fixed, so it stays put as the page scrolls. */}
        <div className="field-bg" aria-hidden />

        <div className="mx-auto flex min-h-screen max-w-shell flex-col px-4 sm:px-6">
          <header className="sticky top-3 z-50 py-3">
            <div className="glass flex items-center justify-between gap-4 rounded-full px-5 py-2.5">
              <Link href="/" className="text-[0.9375rem] font-semibold tracking-tight">
                Exposure Scanner
              </Link>
              <nav className="flex items-center gap-1">
                <Link
                  href="/about/sources"
                  className="rounded-full px-3 py-1.5 text-[0.8125rem] text-muted transition-colors hover:bg-glass/10 hover:text-ink"
                >
                  What we check
                </Link>
                <Link
                  href="/about/privacy"
                  className="rounded-full px-3 py-1.5 text-[0.8125rem] text-muted transition-colors hover:bg-glass/10 hover:text-ink"
                >
                  Privacy
                </Link>
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="py-10">
            <p className="max-w-readable text-[0.75rem] leading-relaxed text-faint">
              For checking your own exposure. Never collects, stores or displays passwords. Not a
              background-check service — not for employment, tenancy or credit screening.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
