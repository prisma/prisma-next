import type { Contract } from '@prisma-next/contract/types';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { ControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import * as contractFreeDdl from '../../contract-free/ddl';
import { errorPostgresMigrationStackMissing } from '../errors';
import { type DataTransformOptions, dataTransform } from './operations/data-transform';
import { buildCreateSchemaOp } from './operations/dependencies';
import { buildCreateTableOp } from './operations/tables';
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
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
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
    readonly schema?: string;
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    const node = contractFreeDdl.createTable(options);
    return buildCreateTableOp(node, this.controlAdapter);
  }

  /**
   * Emit a `CREATE SCHEMA` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createSchema(options: {
    readonly schema: string;
    readonly ifNotExists?: boolean;
  }): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing();
    }
    const node = contractFreeDdl.createSchema({
      ...options,
      ifNotExists: options.ifNotExists ?? true,
    });
    return buildCreateSchemaOp(node, this.controlAdapter);
  }
}
