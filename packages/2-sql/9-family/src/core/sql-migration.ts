import { deriveProvidedInvariants } from '@prisma-next/migration-tools/invariants';
import { Migration } from '@prisma-next/migration-tools/migration';
import type { SqlMigrationPlanOperation, SqlPlanTargetDetails } from './migrations/types';

/**
 * Family-owned base class for SQL migrations.
 *
 * Generic in `TDetails` (family plan target details, e.g. Postgres vs SQLite)
 * and in `TTargetId` (the literal target identifier, e.g. `'postgres'`).
 *
 * Adapters (Postgres, SQLite, …) extend this with a concrete `TDetails` and
 * a fixed `TTargetId` literal, so the public `Migration<TOp>` base sees the
 * fully concrete operation shape. Target-free code in SQL family / tooling
 * parameterises over `TDetails` (and usually `TTargetId = string`).
 *
 * Keeps target-free contract/runtime features in the family layer while
 * letting adapters own target shape.
 */
export abstract class SqlMigration<
  TDetails extends SqlPlanTargetDetails,
  TTargetId extends string = string,
> extends Migration<SqlMigrationPlanOperation<TDetails>, 'sql', TTargetId> {
  /**
   * Sorted, deduplicated invariant ids declared by this migration's
   * data-transform ops. Derived from `this.operations` so the field remains
   * consistent with the operation list — planner-built plans (`db init`,
   * `db update`) yield `[]` because they emit no data-transform ops.
   *
   * Required by `SqlMigrationPlan.providedInvariants` (tightened from
   * optional at the SQL-family layer); the framework-level
   * `MigrationPlan.providedInvariants?` stays optional.
   */
  get providedInvariants(): readonly string[] {
    const ops = this.operations.filter(
      (op): op is SqlMigrationPlanOperation<TDetails> => !(op instanceof Promise),
    );
    return deriveProvidedInvariants(ops);
  }
}
