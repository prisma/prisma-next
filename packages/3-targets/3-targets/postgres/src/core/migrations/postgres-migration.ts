import type { Contract } from '@prisma-next/contract/types';
import { errorPostgresMigrationStackMissing } from '@prisma-next/errors/migration';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type DataTransformOptions,
  dataTransform,
  type PostgresDataTransformOperation,
} from './operations/data-transform';
import type { PostgresPlanTargetDetails } from './planner-target-details';

/**
 * Target-owned base class for Postgres migrations.
 *
 * Fixes the `SqlMigration` generic to `PostgresPlanTargetDetails` and the
 * abstract `targetId` to the Postgres target-id string literal, so both
 * user-authored migrations and renderer-generated scaffolds (the output of
 * `renderCallsToTypeScript`) can extend `PostgresMigration` directly without
 * redeclaring target-local identity.
 *
 * Mirrors `MongoMigration` in `@prisma-next/family-mongo`: the renderer
 * emits `extends Migration` against a target-specific re-export of this
 * class from `@prisma-next/target-postgres/migration`, keeping the
 * authoring surface target-scoped rather than family-scoped.
 *
 * The constructor materializes a single Postgres `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected `dataTransform`
 * instance method forwards to the free `dataTransform` factory with that
 * stored adapter, so user migrations can write `this.dataTransform(...)`
 * without threading the adapter through every call.
 */
export abstract class PostgresMigration extends SqlMigration<
  PostgresPlanTargetDetails,
  'postgres'
> {
  readonly targetId = 'postgres' as const;

  /**
   * Materialized Postgres control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); `dataTransform`
   * throws in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'postgres'> | undefined;

  constructor(stack?: ControlStack<'sql', 'postgres'>) {
    super(stack);
    // The descriptor `create()` is typed as the wider `ControlAdapterInstance`;
    // the Postgres descriptor concretely returns a `SqlControlAdapter<'postgres'>`,
    // so the cast holds for any Postgres-target stack assembled at runtime.
    this.controlAdapter = stack?.adapter
      ? (stack.adapter.create(stack) as SqlControlAdapter<'postgres'>)
      : undefined;
  }

  /**
   * Instance-method wrapper around the free `dataTransform` factory that
   * supplies the stored control adapter. Authors call this from inside
   * `get operations()`; the adapter argument is hidden from the call site.
   */
  protected dataTransform<TContract extends Contract<SqlStorage>>(
    contract: TContract,
    name: string,
    options: DataTransformOptions,
  ): PostgresDataTransformOperation {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return dataTransform(contract, name, options, this.controlAdapter);
  }
}
