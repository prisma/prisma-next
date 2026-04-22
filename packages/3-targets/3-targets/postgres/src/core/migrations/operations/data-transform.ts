/**
 * User-facing `dataTransform` factory for the Postgres migration authoring
 * surface. Invoked directly inside a `migration.ts` file:
 *
 * ```ts
 * import endContract from './end-contract.json' with { type: 'json' };
 * import { dataTransform } from '@prisma-next/target-postgres/migration';
 *
 * dataTransform(endContract, 'backfill emails', {
 *   check: () => db.users.count().where(({ email }) => email.isNull()),
 *   run:   () => db.users.update({ email: '' }).where(({ email }) => email.isNull()),
 * });
 * ```
 *
 * The factory accepts lazy closures (`() => SqlQueryPlan | Buildable`),
 * invokes each one, asserts that its `meta.storageHash` matches the
 * `contract` it was handed (→ `PN-MIG-2005` on mismatch), and lowers the
 * plan via the Postgres adapter to a serialized `{sql, params}` payload
 * for `ops.json`.
 */

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from '@prisma-next/contract/types';
import { errorDataTransformContractMismatch } from '@prisma-next/errors/migration';
import type {
  DataTransformOperation,
  SerializedQueryPlan,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { lowerSqlPlan } from '@prisma-next/sql-runtime';

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

/** Single shared adapter for apply/CLI; sufficient for single-threaded migration execution. */
let adapterSingleton: ReturnType<typeof createPostgresAdapter> | null = null;
function getAdapter(): ReturnType<typeof createPostgresAdapter> {
  if (adapterSingleton === null) {
    adapterSingleton = createPostgresAdapter();
  }
  return adapterSingleton;
}

export function dataTransform<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  name: string,
  options: DataTransformOptions,
): DataTransformOperation {
  const adapter = getAdapter();
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
  adapter: ReturnType<typeof createPostgresAdapter>,
  name: string,
): SerializedQueryPlan {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  const lowered = lowerSqlPlan(adapter, contract, plan);
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
