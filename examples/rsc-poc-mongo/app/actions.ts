'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDb } from '../src/lib/db';

/**
 * Server Action #1 — create a search event.
 *
 * The ticket's scope is read-focused, but we agreed one smoke-level
 * Server Action belongs in the PoC to prove mutations-alongside-
 * concurrent-reads don't explode on either family. This is the Mongo
 * analogue of the Postgres app's `createPostAction`.
 *
 * Path exercised:
 *
 * - Resolves the process-scoped Mongo runtime singleton (same one the
 *   page's five Server Components share).
 * - Issues `db.orm.events.variant('SearchEvent').create(...)`, which
 *   the Mongo ORM translates into an `insertOne` wire command,
 *   auto-injecting the `type` discriminator ('search') based on the
 *   variant.
 * - On success, calls `revalidatePath('/')` so the subsequent render
 *   picks up the new row in `<SearchEvents />` and
 *   `<EventTypeStats />`.
 *
 * Intentionally NOT exercised: the k6 stress scripts don't invoke this
 * action. Server Actions in Next.js are serialized per request, and we
 * care about read-side concurrency here. The action is reachable from
 * the `<CreateEventForm />` client component on `/` for manual smoke
 * testing.
 *
 * No pre-conditions: the action inserts a `SearchEvent` with a
 * synthetic `userId` and `sessionId`, so it works even on an empty
 * database. Unlike the Postgres action (which needs at least one User
 * to satisfy a foreign key), MongoDB has no referential constraints
 * to trip over here.
 */

export interface CreateEventState {
  readonly status: 'idle' | 'ok' | 'error';
  readonly message?: string;
}

export async function createEventAction(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const query = formData.get('query');
  if (typeof query !== 'string' || query.trim().length === 0) {
    return { status: 'error', message: 'Search query is required.' };
  }

  const db = await getDb();

  try {
    await db.orm.events.variant('SearchEvent').create({
      userId: `rsc-poc-${randomUUID().slice(0, 8)}`,
      sessionId: `rsc-poc-session-${randomUUID().slice(0, 8)}`,
      timestamp: new Date(),
      query: query.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', message };
  }

  revalidatePath('/');
  return { status: 'ok', message: `Created search event for "${query.trim()}".` };
}
