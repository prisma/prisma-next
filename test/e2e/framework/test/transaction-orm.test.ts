import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Varchar } from '@prisma-next/adapter-postgres/codec-types';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { runDbInit } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

function v(s: string): Varchar<255> {
  return s as Varchar<255>;
}

async function loadContractJson(): Promise<unknown> {
  const content = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(content);
}

async function withPostgresClient(
  callback: (db: ReturnType<typeof postgres<Contract>>) => Promise<void>,
): Promise<void> {
  const contractJson = await loadContractJson();
  await withDevDatabase(async ({ connectionString }) => {
    await runDbInit({ connectionString, contractJsonPath });
    const db = postgres<Contract>({ contractJson, url: connectionString, extensions: [pgvector] });
    await db.connect();

    // Warm up the runtime so that contract verification (which acquires its
    // own connection) runs before the first transaction.  PGlite only allows
    // one concurrent connection, so verification inside a transaction would
    // deadlock.
    await db.orm.User.first();

    try {
      await callback(db);
    } finally {
      await db.runtime().close();
    }
  });
}

describe('transaction ORM integration', { timeout: 30000 }, () => {
  it('ORM create with nested relation mutation commits atomically', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        await tx.orm.Post.create({
          title: 'Atomic Post',
          published: true,
          author: (r) => r.create({ email: v('nested-author@example.com') }),
        });
      });

      const user = await db.orm.User.where((u) =>
        u.email.eq(v('nested-author@example.com')),
      ).first();
      expect(user).not.toBeNull();

      const post = await db.orm.Post.where((p) => p.title.eq('Atomic Post')).first();
      expect(post).not.toBeNull();
      expect(post!.published).toBe(true);
      expect(post!.userId).toBe(user!.id);
    });
  });

  it('ORM create with nested relation mutation rolls back everything on throw', async () => {
    await withPostgresClient(async (db) => {
      await expect(
        db.transaction(async (tx) => {
          await tx.orm.Post.create({
            title: 'Rollback Post',
            published: false,
            author: (r) => r.create({ email: v('rollback-author@example.com') }),
          });

          throw new Error('deliberate rollback');
        }),
      ).rejects.toThrow('deliberate rollback');

      const user = await db.orm.User.where((u) =>
        u.email.eq(v('rollback-author@example.com')),
      ).first();
      expect(user).toBeNull();

      const post = await db.orm.Post.where((p) => p.title.eq('Rollback Post')).first();
      expect(post).toBeNull();
    });
  });

  it('ORM write then read within the same transaction uses the transaction connection', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        const created = await tx.orm.User.create({ email: v('tx-ryow@example.com') });

        const found = await tx.orm.User.where((u) => u.email.eq(v('tx-ryow@example.com'))).first();
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.email).toBe('tx-ryow@example.com');
      });

      const user = await db.orm.User.where((u) => u.email.eq(v('tx-ryow@example.com'))).first();
      expect(user).not.toBeNull();
    });
  });

  it('multiple ORM operations in a transaction are atomic', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        const user = await tx.orm.User.create({ email: v('multi-op@example.com') });

        await tx.orm.Post.create({
          title: 'First Post',
          userId: user.id,
          published: true,
        });

        await tx.orm.Post.create({
          title: 'Second Post',
          userId: user.id,
          published: false,
        });
      });

      const user = await db.orm.User.where((u) => u.email.eq(v('multi-op@example.com'))).first();
      expect(user).not.toBeNull();

      const posts = await db.orm.Post.where((p) => p.userId.eq(user!.id))
        .orderBy((p) => p.title.asc())
        .all();
      expect(posts).toHaveLength(2);
      expect(posts[0]!.title).toBe('First Post');
      expect(posts[1]!.title).toBe('Second Post');
    });
  });

  it('multiple ORM operations roll back together on throw', async () => {
    await withPostgresClient(async (db) => {
      await expect(
        db.transaction(async (tx) => {
          const user = await tx.orm.User.create({ email: v('multi-rollback@example.com') });

          await tx.orm.Post.create({
            title: 'Doomed Post',
            userId: user.id,
            published: true,
          });

          throw new Error('rollback everything');
        }),
      ).rejects.toThrow('rollback everything');

      const user = await db.orm.User.where((u) =>
        u.email.eq(v('multi-rollback@example.com')),
      ).first();
      expect(user).toBeNull();

      const post = await db.orm.Post.where((p) => p.title.eq('Doomed Post')).first();
      expect(post).toBeNull();
    });
  });
});
