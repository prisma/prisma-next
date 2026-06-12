import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { errorSqliteMigrationStackMissing } from '../errors';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RecreateTableCall,
} from './op-factory-call';
import type { SqliteColumnSpec, SqliteIndexSpec, SqliteTableSpec } from './operations/shared';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

/**
 * Target-owned base class for SQLite migrations. Fixes the `SqlMigration`
 * generic to `SqlitePlanTargetDetails` and the abstract `targetId` to the
 * SQLite literal, so both user-authored migrations and renderer-generated
 * scaffolds can extend `SqliteMigration` directly without redeclaring
 * target-local identity.
 *
 * The constructor materializes a single SQLite `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected instance methods
 * forward to the corresponding `*Call` with that stored adapter, so user
 * migrations can write `this.createTable({...})` without threading the adapter
 * through every call.
 */
export abstract class SqliteMigration extends SqlMigration<SqlitePlanTargetDetails, 'sqlite'> {
  readonly targetId = 'sqlite' as const;

  /**
   * Materialized SQLite control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); the operation methods
   * throw in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'sqlite'> | undefined;

  constructor(stack?: ControlStack<'sql', 'sqlite'>) {
    super(stack);
    this.controlAdapter = stack?.adapter
      ? blindCast<
          SqlControlAdapter<'sqlite'>,
          'The SQLite descriptor create() returns SqlControlAdapter<sqlite>; typed as wider ControlAdapterInstance at the framework boundary'
        >(stack.adapter.create(stack))
      : undefined;
  }

  protected createTable(options: {
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new CreateTableCall(options.table, options.columns, options.constraints).toOp(
      this.controlAdapter,
    );
  }

  protected dropTable(options: { readonly table: string }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new DropTableCall(options.table).toOp(this.controlAdapter);
  }

  protected addColumn(options: {
    readonly table: string;
    readonly column: SqliteColumnSpec;
  }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new AddColumnCall(options.table, options.column).toOp(this.controlAdapter);
  }

  protected dropColumn(options: { readonly table: string; readonly column: string }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new DropColumnCall(options.table, options.column).toOp(this.controlAdapter);
  }

  protected createIndex(options: {
    readonly table: string;
    readonly index: string;
    readonly columns: readonly string[];
  }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new CreateIndexCall(options.table, options.index, options.columns).toOp(
      this.controlAdapter,
    );
  }

  protected dropIndex(options: { readonly table: string; readonly index: string }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new DropIndexCall(options.table, options.index).toOp(this.controlAdapter);
  }

  protected recreateTable(options: {
    readonly tableName: string;
    readonly contractTable: SqliteTableSpec;
    readonly schemaColumnNames: readonly string[];
    readonly indexes: readonly SqliteIndexSpec[];
    readonly summary: string;
    readonly postchecks: readonly { readonly description: string; readonly sql: string }[];
    readonly operationClass: MigrationOperationClass;
  }): Promise<Op> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing();
    }
    return new RecreateTableCall(options).toOp(this.controlAdapter);
  }
}
