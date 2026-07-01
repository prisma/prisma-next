import type { Contract } from '@prisma-next/contract/types';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import { errorPostgresMigrationStackMissing } from '../errors';
import {
  AddCheckConstraintCall,
  type AddCheckConstraintPayload,
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  type AlterColumnTypeOptions,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import { type DataTransformOptions, dataTransform } from './operations/data-transform';
import { installExtension } from './operations/dependencies';
import type { CreateIndexExtras } from './operations/indexes';
import type { ForeignKeySpec } from './operations/shared';
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
 * emits `extends Migration` against a facade re-export of this class
 * from `@prisma-next/postgres/migration`, keeping the authoring surface
 * target-scoped rather than family-scoped.
 *
 * The constructor materializes a single Postgres `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected `dataTransform`
 * instance method forwards to the free `dataTransform` factory with that
 * stored adapter, so user migrations can write `this.dataTransform(...)`
 * without threading the adapter through every call.
 *
 * Every method requires an explicit `schema`. Postgres migrations name their
 * schema deliberately — there is no default and no `search_path`-relative
 * option. A migration that left the schema unspecified would resolve against
 * whatever `search_path` the connection happened to carry, and that ambiguity
 * is an antipattern in a migration. (The unbound/unspecified namespace concept
 * remains for SQLite, which has no schemas, and for Mongo's connection `db`.)
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
  ): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return dataTransform(contract, name, options, this.controlAdapter);
  }

  /**
   * Emit a `CREATE TABLE` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createTable(options: {
    readonly schema: string;
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new CreateTableCall(
      options.schema,
      options.table,
      options.columns,
      options.constraints,
    ).toOp(this.controlAdapter);
  }

  /**
   * Emit a `CREATE SCHEMA` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createSchema(options: {
    readonly schema: string;
    readonly ifNotExists?: boolean;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new CreateSchemaCall(options.schema).toOp(this.controlAdapter);
  }

  protected addColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AddColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapter,
    );
  }

  protected addPrimaryKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AddPrimaryKeyCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapter);
  }

  protected addUnique(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AddUniqueCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapter);
  }

  protected addForeignKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly foreignKey: ForeignKeySpec;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AddForeignKeyCall(options.schema, options.table, options.foreignKey).toOp(
      this.controlAdapter,
    );
  }

  protected addCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly payload: AddCheckConstraintPayload;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AddCheckConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      options.payload,
    ).toOp(this.controlAdapter);
  }

  protected dropCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropCheckConstraintCall(options.schema, options.table, options.constraint).toOp(
      this.controlAdapter,
    );
  }

  protected dropConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly kind?: 'foreignKey' | 'unique' | 'primaryKey';
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      options.kind ?? 'unique',
    ).toOp(this.controlAdapter);
  }

  protected dropTable(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropTableCall(options.schema, options.table).toOp(this.controlAdapter);
  }

  protected dropColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapter,
    );
  }

  protected alterColumnType(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly options: AlterColumnTypeOptions;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new AlterColumnTypeCall(
      options.schema,
      options.table,
      options.column,
      options.options,
    ).toOp(this.controlAdapter);
  }

  protected setNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new SetNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapter,
    );
  }

  protected dropNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapter,
    );
  }

  protected setDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly defaultSql: string;
    readonly operationClass?: 'additive' | 'widening';
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new SetDefaultCall(
      options.schema,
      options.table,
      options.column,
      options.defaultSql,
      options.operationClass,
    ).toOp(this.controlAdapter);
  }

  protected dropDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropDefaultCall(options.schema, options.table, options.column).toOp(
      this.controlAdapter,
    );
  }

  protected createIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
    readonly columns: readonly string[];
    readonly extras?: CreateIndexExtras;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new CreateIndexCall(
      options.schema,
      options.table,
      options.index,
      options.columns,
      options.extras,
    ).toOp(this.controlAdapter);
  }

  protected dropIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return new DropIndexCall(options.schema, options.table, options.index).toOp(
      this.controlAdapter,
    );
  }

  protected installExtension(options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    return installExtension(options, this.controlAdapter);
  }
}
