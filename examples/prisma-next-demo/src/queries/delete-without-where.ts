import { db } from '../prisma/db';

/**
 * Guardrail-proving query: DELETE without WHERE.
 * Intentionally fails when the AST-first lint plugin blocks execution.
 * Used to validate that LINT.DELETE_WITHOUT_WHERE is enforced.
 */
export async function deleteWithoutWhere() {
  await db.sql.user.delete().first();
}
