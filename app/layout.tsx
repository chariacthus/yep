import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Exposure Scanner',
  description:
    'Find out where your own personal information is publicly exposed, understand what it means, and do something about it.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
              <Link href="/" className="text-sm font-semibold tracking-tight">
                Exposure Scanner
              </Link>
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/about/sources" className="hover:text-ink">
                  What we check
                </Link>
                <Link href="/about/privacy" className="hover:text-ink">
                  Privacy
                </Link>
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="border-t border-line">
            <div className="mx-auto max-w-5xl px-4 py-6 text-xs leading-relaxed text-faint">
              <p>
                This tool checks exposure of your own information only. It never collects, stores or
                displays passwords. It is not a background-check service and must not be used for
                employment, tenancy or credit screening.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
