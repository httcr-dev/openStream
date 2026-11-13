import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenStream',
  description: 'Catálogo unificado e reprodução a partir de fontes autorizadas.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: extensões como o Dark Reader alteram atributos do <html>
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <header className="topbar">
          <Link href="/" className="logo">
            Open<span>Stream</span>
          </Link>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
