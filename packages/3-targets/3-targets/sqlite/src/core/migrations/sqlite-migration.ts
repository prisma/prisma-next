import type { Contract } from '@prisma-next/contract/types';
import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { errorSqliteMigrationStackMissing } from '../errors';
import { SqliteContractView } from '../sqlite-contract-view';
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
 *
 * Binds the framework base's `Start` / `End` contract generics so a subclass
 * that assigns its `start-contract.json` / `end-contract.json` imports gets
 * fully-typed view accessors: `this.endContract` is a `SqliteContractView<End>`
 * (sole namespace unwrapped to the root — `this.endContract.table.<name>`),
 * built lazily from the JSON fields and memoized. Mirrors `MongoMigration`'s
 * view getters; the framework base derives `describe()` from the same JSON.
 */
export abstract class SqliteMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<SqlitePlanTargetDetails, 'sqlite', Start, End> {
  readonly targetId = 'sqlite' as const;

  /**
   * Materialized SQLite control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); the operation methods
   * throw in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'sqlite'> | undefined;

  #endContract?: SqliteContractView<End>;
  #startContract?: SqliteContractView<Start> | null;

  constructor(stack?: ControlStack<'sql', 'sqlite'>) {
    super(stack);
    this.controlAdapter = stack?.adapter
      ? blindCast<
          SqlControlAdapter<'sqlite'>,
          'The SQLite descriptor create() returns SqlControlAdapter<sqlite>; typed as wider ControlAdapterInstance at the framework boundary'
        >(stack.adapter.create(stack))
      : undefined;
  }

  /**
   * The typed SQLite view over this migration's end-state contract — sole
   * namespace unwrapped to the root, so `this.endContract.table.<name>` etc.
   * Lazily built from `endContractJson` and memoized. Throws if no
   * `endContractJson` was provided.
   */
  get endContract(): SqliteContractView<End> {
    if (this.#endContract === undefined) {
      if (this.endContractJson === undefined) {
        throw new Error(
          'SqliteMigration.endContract: no endContractJson provided — set endContractJson to read the end-state contract view.',
        );
      }
      this.#endContract = SqliteContractView.fromJson<End>(this.endContractJson);
    }
    return this.#endContract;
  }

  /**
   * The typed SQLite view over this migration's start-state contract, or `null`
   * for a baseline migration (no `startContractJson`). Lazily built and memoized.
   */
  get startContract(): SqliteContractView<Start> | null {
    if (this.#startContract === undefined) {
      this.#startContract =
        this.startContractJson === undefined
          ? null
          : SqliteContractView.fromJson<Start>(this.startContractJson);
    }
    return this.#startContract;
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
