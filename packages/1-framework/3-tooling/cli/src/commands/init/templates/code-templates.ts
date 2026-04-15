export type TargetId = 'postgres' | 'mongo';

export function targetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
}

export function targetLabel(target: TargetId): string {
  return target === 'postgres' ? 'PostgreSQL' : 'MongoDB';
}

export function starterSchema(target: TargetId): string {
  if (target === 'mongo') {
    return `model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  name  String?
  posts Post[]
  @@map("users")
}

model Post {
  id       ObjectId @id @map("_id")
  title    String
  content  String?
  author   User     @relation(fields: [authorId], references: [id])
  authorId ObjectId
  @@map("posts")
}
`;
  }

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
  const pkg = targetPackageName(target);
  return `import 'dotenv/config';
import { defineConfig } from '${pkg}/config';

export default defineConfig({
  contract: '${contractPath}',
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
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

  return `import mongo from '@prisma-next/mongo/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = mongo<Contract>({ contractJson });
`;
}
