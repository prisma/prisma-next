import { sql } from '@prisma/sql';
import { t } from './schema';
import { db } from './db';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { parseIR } from '@prisma/relational-ir';
import { createRuntime, lint } from '@prisma/runtime';

// Create a runtime with lint plugin for enhanced query execution
const runtime = createRuntime({
  ir: parseIR(contract),
  driver: db,
  plugins: [
    lint({
      rules: {
        'no-select-star': 'error',
        'mutation-requires-where': 'error',
        'no-missing-limit': 'warn',
        'no-unindexed-column-in-where': 'warn',
      },
    }),
  ],
});

export async function getActiveUsers() {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.active.eq(true))
    .select({ id: t.user.id, email: t.user.email });

  // Use runtime.execute() instead of db.execute() to get lint checking
  return await runtime.execute(query.build());
}

export async function getUserById(id: number) {
  const query = sql(parseIR(contract)).from(t.user).where(t.user.id.eq(id)).select({
    id: t.user.id,
    email: t.user.email,
    active: t.user.active,
    createdAt: t.user.createdAt,
  });

  const results = await runtime.execute(query.build());
  return results[0] || null;
}

export async function getUsersByEmail(email: string) {
  const query = sql(parseIR(contract))
    .from(t.user)
    .where(t.user.email.eq(email))
    .select({ id: t.user.id, email: t.user.email, active: t.user.active });

  return await runtime.execute(query.build());
}

// Example of a query that would trigger lint warnings
export async function getAllUsers() {
  const query = sql(parseIR(contract)).from(t.user).select({ id: t.user.id, email: t.user.email });
  // This will trigger 'no-missing-limit' warning since there's no WHERE or LIMIT

  return await runtime.execute(query.build());
}
