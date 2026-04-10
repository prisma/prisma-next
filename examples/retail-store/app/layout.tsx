import type { ReactNode } from 'react';
import { Navbar } from '../src/components/navbar';
import './globals.css';

export const metadata = {
  title: 'Retail Store — Prisma Next MongoDB Demo',
  description: 'E-commerce example app powered by Prisma Next with MongoDB',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
