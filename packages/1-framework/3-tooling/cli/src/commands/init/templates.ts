export type TargetId = 'postgres' | 'mongo';

export function starterSchema(): string {
  return `model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
`;
}

export function configFile(target: TargetId, contractPath: string): string {
  const pkg = target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
  return `import { defineConfig } from '${pkg}/config';

export default defineConfig({
  contract: '${contractPath}',
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
`;
}

export function dbFile(target: TargetId): string {
  if (target === 'postgres') {
    return `import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
`;
  }

  return `import { createMongoRuntime } from '@prisma-next/mongo/runtime';

export { createMongoRuntime };
`;
}

export function targetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
}
