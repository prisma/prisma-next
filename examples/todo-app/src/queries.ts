import { sql } from '@prisma/sql';
import { t } from './schema';
import { db } from './db';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { parseIR } from '@prisma/relational-ir';

export async function getActiveUsers() {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.active.eq(true))
    .select({ id: t.user.id, email: t.user.email });

  return await db.execute(query.build());
}

export async function getUserById(id: number) {
  const query = sql(parseIR(contract)).from(t.user).where(t.user.id.eq(id)).select({
    id: t.user.id,
    email: t.user.email,
    active: t.user.active,
    createdAt: t.user.createdAt,
  });

  const results = await db.execute(query.build());
  return results[0] || null;
}

export async function getUsersByEmail(email: string) {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.email.eq(email))
    .select({ id: t.user.id, email: t.user.email, active: t.user.active });

  return await db.execute(query.build());
}
