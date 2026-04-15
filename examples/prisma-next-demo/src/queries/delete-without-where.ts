import { db } from '../prisma/db';

/**
 * Guardrail-proving query: DELETE without WHERE.
 * Intentionally fails when the AST-first lint middleware blocks execution.
 * Used to validate that LINT.DELETE_WITHOUT_WHERE is enforced.
 */
export async function deleteWithoutWhere() {
  const plan = db.sql.user.delete().build();
  await db.runtime().execute(plan);
}
