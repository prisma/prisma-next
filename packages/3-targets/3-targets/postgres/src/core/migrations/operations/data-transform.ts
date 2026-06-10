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
 *         check: () => db.users.select('id').where(({ email }) => email.isNull()).limit(1),
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
 * payload.
 *
 * The factory then lowers the data transform to the unified migration-op
 * shape `{ precheck, execute, postcheck }`. The user's `check` plan is
 * wrapped twice with opposite truth values:
 *
 * - precheck `SELECT EXISTS (<check>) AS ok` asserts there is work to do
 *   (precheck is short-circuited by the runner's pre-satisfied-skip path
 *   when nothing remains to backfill).
 * - postcheck `SELECT NOT EXISTS (<check>) AS ok` asserts the work is
 *   complete after the run steps execute.
 *
 * The `check` plan is therefore expected to be a **rowset query whose
 * presence of any row signals "work remains"** — typically `select('id')
 * .where(<violation predicate>).limit(1)`. Scalar/aggregate shapes
 * (`count(*)`, `bool_and(...)`) do not work under this contract: they
 * always return exactly one row, so `EXISTS` is always true and
 * `NOT EXISTS` is always false. (This is the same row-presence contract
 * the pre-unification runner relied on; the wrapping is just lifting it
 * into SQL.)
 *
 * Each `run` plan becomes an execute step. Because the `Step.params`
 * field threads through `driver.query(sql, params)`, the user's bound
 * values flow through the driver's parameter binder rather than being
 * inlined into the SQL text.
 *
 * The free factory remains usable standalone (tests, ad-hoc tooling,
 * non-class contexts) by passing the adapter explicitly as the fourth
 * argument.
 */

import type { Contract } from '@prisma-next/contract/types';
import { errorDataTransformContractMismatch } from '@prisma-next/errors/migration';
import type {
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
} from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlExecuteRequest } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresPlanTargetDetails } from '../planner-target-details';

interface Buildable<R = unknown> {
  build(): SqlQueryPlan<R>;
}

/**
 * A single-closure producer of a SQL query plan. Shared between
 * `check` and each `run` entry.
 */
export type DataTransformClosure = () => SqlQueryPlan | Buildable;

export interface DataTransformOptions {
  /**
   * Optional opt-in routing identity. Presence opts the transform into
   * invariant-aware routing; absence means it is path-dependent and
   * not referenceable from refs.
   */
  readonly invariantId?: string;
  /**
   * Optional pre-flight query. `undefined` means "no check". When
   * supplied, the closure must return a **rowset query** whose
   * presence of any row signals "violations remain". Conventional
   * shape: `db.<table>.select('id').where(<violation>).limit(1)`.
   * Scalar/aggregate shapes do not satisfy this contract.
   */
  readonly check?: DataTransformClosure;
  /** One or more mutation queries to execute. */
  readonly run: DataTransformClosure | readonly DataTransformClosure[];
}

export function dataTransform<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  name: string,
  options: DataTransformOptions,
  adapter: SqlControlAdapter<'postgres'>,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  const runClosures: readonly DataTransformClosure[] = Array.isArray(options.run)
    ? options.run
    : [options.run as DataTransformClosure];

  const checkPlan = options.check ? invokeAndLower(options.check, contract, adapter, name) : null;
  const runPlans = runClosures.map((closure) => invokeAndLower(closure, contract, adapter, name));

  const precheck: readonly SqlMigrationPlanOperationStep[] = checkPlan
    ? [
        {
          description: `Check ${name} has work to do`,
          sql: `SELECT EXISTS (${checkPlan.sql}) AS ok`,
          params: checkPlan.params ?? [],
        },
      ]
    : [];

  const execute: readonly SqlMigrationPlanOperationStep[] = runPlans.map((plan) => ({
    description: `Run ${name}`,
    sql: plan.sql,
    params: plan.params ?? [],
  }));

  const postcheck: readonly SqlMigrationPlanOperationStep[] = checkPlan
    ? [
        {
          description: `Verify ${name} resolved all violations`,
          sql: `SELECT NOT EXISTS (${checkPlan.sql}) AS ok`,
          params: checkPlan.params ?? [],
        },
      ]
    : [];

  return {
    id: `data_migration.${name}`,
    label: `Data transform: ${name}`,
    operationClass: 'data',
    ...ifDefined('invariantId', options.invariantId),
    target: { id: 'postgres' },
    precheck,
    execute,
    postcheck,
  };
}

function invokeAndLower(
  closure: DataTransformClosure,
  contract: Contract<SqlStorage>,
  adapter: SqlControlAdapter<'postgres'>,
  name: string,
): SqlExecuteRequest {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  const lowered = adapter.lower(plan.ast, { contract });
  const params = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new Error(
      `data-transform: bind-site slot '${slot.name}' is not allowed in migration plans`,
    );
  });
  return { sql: lowered.sql, params };
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
