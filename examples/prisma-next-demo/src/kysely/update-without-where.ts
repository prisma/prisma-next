import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type { Runtime } from '@prisma-next/sql-runtime';
import { Kysely } from 'kysely';
import { executionContext } from '../prisma/context';

/**
 * Guardrail-proving query: UPDATE without WHERE.
 * Intentionally fails when the AST-first lint plugin blocks execution.
 * Used to validate that LINT.UPDATE_WITHOUT_WHERE is enforced.
 */
export async function updateWithoutWhere(runtime: Runtime) {
  const contract = executionContext.contract;
  const kysely = new Kysely<KyselifyContract<typeof contract>>({
    dialect: new KyselyPrismaDialect({ runtime, contract }),
  });

  await kysely.updateTable('user').set({ email: 'unsafe@example.com' }).execute();
}
