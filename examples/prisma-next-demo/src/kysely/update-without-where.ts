import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';

/**
 * Guardrail-proving query: UPDATE without WHERE.
 * Intentionally fails when the AST-first lint plugin blocks execution.
 * Used to validate that LINT.UPDATE_WITHOUT_WHERE is enforced.
 */
export async function updateWithoutWhere(runtime: Runtime) {
  const query = kysely.updateTable('user').set({ email: 'unsafe@example.com' });

  await runtime.execute(kysely.build(query)).toArray();
}
