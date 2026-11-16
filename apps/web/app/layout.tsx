import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenStream',
  description: 'Catálogo unificado, descoberta de addons e reprodução de mídia.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: extensões como o Dark Reader alteram atributos do <html>
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Link href="/" className="logo">
              Open<span>Stream</span>
            </Link>
            <Link href="/addons" className="muted">Addons</Link>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
