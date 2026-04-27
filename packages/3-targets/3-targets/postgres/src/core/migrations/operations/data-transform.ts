/**
 * User-facing `dataTransform` factory for the Postgres migration authoring
 * surface. Invoked directly inside a `migration.ts` file via the
 * `PostgresMigration` instance method (`this.dataTransform(...)`), which
 * supplies the control adapter from the migration's injected stack:
 *
 * ```ts
 * import endContract from './end-contract.json' with { type: 'json' };
 *
 * class M extends Migration {
 *   override get operations() {
 *     return [
 *       this.dataTransform(endContract, 'backfill emails', {
 *         check: () => db.users.count().where(({ email }) => email.isNull()),
 *         run:   () => db.users.update({ email: '' }).where(({ email }) => email.isNull()),
 *       }),
 *     ];
 *   }
 * }
 * ```
 *
 * The factory accepts lazy closures (`() => SqlQueryPlan | Buildable`),
 * invokes each one, asserts that its `meta.storageHash` matches the
 * `contract` it was handed (→ `PN-MIG-2005` on mismatch), and lowers the
 * plan via the supplied control adapter to a serialized `{sql, params}`
 * payload for `ops.json`. The free factory remains usable standalone
 * (tests, ad-hoc tooling, non-class contexts) by passing the adapter
 * explicitly as the fourth argument.
 */

import type { Contract } from '@prisma-next/contract/types';
import { errorDataTransformContractMismatch } from '@prisma-next/errors/migration';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type {
  DataTransformOperation,
  SerializedQueryPlan,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

interface Buildable<R = unknown> {
  build(): SqlQueryPlan<R>;
}

/**
 * A single-closure producer of a SQL query plan. Shared between
 * `check` and each `run` entry.
 */
export type DataTransformClosure = () => SqlQueryPlan | Buildable;

export interface DataTransformOptions {
  /** Optional pre-flight query. `undefined` means "no check". */
  readonly check?: DataTransformClosure;
  /** One or more mutation queries to execute. */
  readonly run: DataTransformClosure | readonly DataTransformClosure[];
}

/**
 * Concrete Postgres flavor of `DataTransformOperation`, re-exported so the
 * `PostgresMigration.dataTransform` instance method can name it without
 * leaking the framework-components symbol into call sites.
 */
export type PostgresDataTransformOperation = DataTransformOperation;

export function dataTransform<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  name: string,
  options: DataTransformOptions,
  adapter: SqlControlAdapter<'postgres'>,
): DataTransformOperation {
  const runClosures: readonly DataTransformClosure[] = Array.isArray(options.run)
    ? options.run
    : [options.run as DataTransformClosure];
  return {
    id: `data_migration.${name}`,
    label: `Data transform: ${name}`,
    operationClass: 'data',
    name,
    source: 'migration.ts',
    check: options.check ? invokeAndLower(options.check, contract, adapter, name) : null,
    run: runClosures.map((closure) => invokeAndLower(closure, contract, adapter, name)),
  };
}

function invokeAndLower(
  closure: DataTransformClosure,
  contract: Contract<SqlStorage>,
  adapter: SqlControlAdapter<'postgres'>,
  name: string,
): SerializedQueryPlan {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  const lowered = adapter.lower(plan.ast, { contract });
  return { sql: lowered.sql, params: lowered.params };
}

function isBuildable(value: unknown): value is Buildable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'build' in value &&
    typeof (value as { build: unknown }).build === 'function'
  );
}

function assertContractMatches(
  plan: SqlQueryPlan,
  contract: Contract<SqlStorage>,
  name: string,
): void {
  if (plan.meta.storageHash !== contract.storage.storageHash) {
    throw errorDataTransformContractMismatch({
      dataTransformName: name,
      expected: contract.storage.storageHash,
      actual: plan.meta.storageHash,
    });
  }
}
