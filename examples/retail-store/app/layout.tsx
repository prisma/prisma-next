import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Retail Store — Prisma Next MongoDB Demo',
  description: 'E-commerce example app powered by Prisma Next with MongoDB',
};

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} style={{ color: '#fff', fontWeight: 500, padding: '0.5rem 1rem' }}>
      {children}
    </a>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            background: '#111',
            padding: '0.75rem 2rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginRight: '2rem' }}>
            Retail Store
          </span>
          <NavLink href="/">Products</NavLink>
          <NavLink href="/cart">Cart</NavLink>
          <NavLink href="/orders">Orders</NavLink>
        </nav>
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>{children}</main>
      </body>
    </html>
  );
}
