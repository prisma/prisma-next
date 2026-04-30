'use server';

import { randomUUID } from 'node:crypto';
import type { Char } from '@prisma-next/adapter-postgres/codec-types';
import { revalidatePath } from 'next/cache';
import { getDb } from '../src/lib/db';

/**
 * Server Action #1 — create a post.
 *
 * The ticket's scope is read-focused, but we agreed one smoke-level Server
 * Action belongs in the PoC to prove mutations-alongside-concurrent-reads
 * don't explode. This is that smoke action.
 *
 * Path exercised:
 *
 * - Resolves the process-scoped runtime singleton (same one the page's five
 *   Server Components share).
 * - Goes through `acquireRuntimeScope()` → `runtime.connection()` → a
 *   transaction-wrapped write via `withMutationScope()` in
 *   `sql-orm-client`. The transaction's lifetime pins one pool connection
 *   for the duration of the insert.
 * - On success, calls `revalidatePath('/')` so the subsequent render picks
 *   up the new row.
 *
 * Intentionally NOT exercised: the k6 stress scripts don't invoke this
 * action. Server Actions in Next.js are serialized per request, and we
 * care about read-side concurrency here. The action is reachable from the
 * `<CreatePostForm />` client component on `/` for manual smoke testing.
 *
 * Pre-conditions: at least one user must exist (the seed creates two).
 * With no users, the action returns an error state rather than throwing —
 * the form surfaces it to the user.
 */

export interface CreatePostState {
  readonly status: 'idle' | 'ok' | 'error';
  readonly message?: string;
}

export async function createPostAction(
  _prev: CreatePostState,
  formData: FormData,
): Promise<CreatePostState> {
  const title = formData.get('title');
  if (typeof title !== 'string' || title.trim().length === 0) {
    return { status: 'error', message: 'Title is required.' };
  }

  const db = getDb();

  const user = await db.orm.User.select('id')
    .orderBy((u) => u.createdAt.asc())
    .take(1)
    .all();
  const author = user[0];
  if (!author) {
    return {
      status: 'error',
      message: 'No users in the database — run `pnpm seed` first.',
    };
  }

  try {
    await db.orm.Post.create({
      // `Char<36>` is a nominal branded type in the generated contract; the
      // runtime value is a plain UUID string. Matches the cast pattern used
      // in `prisma-next-demo/src/orm-client/create-user.ts`.
      id: randomUUID() as Char<36>,
      title: title.trim(),
      userId: author.id,
      createdAt: new Date().toISOString(),
      embedding: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', message };
  }

  revalidatePath('/');
  return { status: 'ok', message: `Created post "${title.trim()}".` };
}
