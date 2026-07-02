import type { SupabaseInternalDb } from '@prisma-next/extension-supabase/runtime';

export async function readSessionAal(db: SupabaseInternalDb, sessionId: string) {
  const rows = await db
    .execute(
      db.sql.auth.sessions
        .select('id', 'aal')
        .where((f, fns) => fns.eq(f.id, sessionId))
        .build(),
    )
    .toArray();
  return rows[0];
}

export function findSessionsByAal(db: SupabaseInternalDb, aal: 'aal1' | 'aal2' | 'aal3') {
  return db
    .execute(
      db.sql.auth.sessions
        .select('id', 'aal')
        .where((f, fns) => fns.eq(f.aal, aal))
        .build(),
    )
    .toArray();
}
