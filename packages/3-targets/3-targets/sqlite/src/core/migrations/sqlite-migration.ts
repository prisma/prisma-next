import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { errorSqliteMigrationStackMissing } from '../errors';
import { CreateTableCall } from './op-factory-call';
import type { SqlitePlanTargetDetails } from './planner-target-details';

/**
 * Target-owned base class for SQLite migrations. Fixes the `SqlMigration`
 * generic to `SqlitePlanTargetDetails` and the abstract `targetId` to the
 * SQLite literal, so both user-authored migrations and renderer-generated
 * scaffolds can extend `SqliteMigration` directly without redeclaring
 * target-local identity.
 *
 * The constructor materializes a single SQLite `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected `createTable`
 * instance method forwards to `CreateTableCall` with that stored adapter,
 * so user migrations can write `this.createTable({...})` without threading
 * the adapter through every call.
 */
export abstract class SqliteMigration extends SqlMigration<SqlitePlanTargetDetails, 'sqlite'> {
  readonly targetId = 'sqlite' as const;

  /**
   * Materialized SQLite control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); `createTable`
   * throws in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'sqlite'> | undefined;

  constructor(stack?: ControlStack<'sql', 'sqlite'>) {
    super(stack);
    this.controlAdapter = stack?.adapter
      ? blindCast<
          SqlControlAdapter<'sqlite'>,
          'The SQLite descriptor create() returns SqlControlAdapter<sqlite>; typed as wider ControlAdapterInstance at the framework boundary'        >(stack.adapter.create(stack))
      : undefined;
  }

  /**
   * Emit a `CREATE TABLE` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createTable(options: {
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): SqlMigrationPlanOperation<SqlitePlanTargetDetails> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new CreateTableCall(options.table, options.columns, options.constraints).toOp(
      this.controlAdapter,
    );
  }
}
