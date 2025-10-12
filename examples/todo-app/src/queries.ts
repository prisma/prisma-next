import { sql, t } from '@prisma/sql';
import { db } from './db';

export async function getActiveUsers() {
  const query = sql()
    .from('user')
    .where(t.user.active.eq(true))
    .select({ id: 'id', email: 'email' });

  return await db.execute(query.build());
}

export async function getUserById(id: number) {
  const query = sql()
    .from('user')
    .where(t.user.id.eq(id))
    .select({ id: 'id', email: 'email', active: 'active', createdAt: 'createdAt' });

  const results = await db.execute(query.build());
  return results[0] || null;
}

export async function getUsersByEmail(email: string) {
  const query = sql()
    .from('user')
    .where(t.user.email.eq(email))
    .select({ id: 'id', email: 'email', active: 'active' });

  return await db.execute(query.build());
}
