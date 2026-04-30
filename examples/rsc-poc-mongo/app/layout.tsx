import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'RSC Concurrency PoC — Mongo',
  description:
    'Next.js 16 App Router PoC for Prisma Next runtime behavior under RSC concurrent rendering (Mongo family).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
