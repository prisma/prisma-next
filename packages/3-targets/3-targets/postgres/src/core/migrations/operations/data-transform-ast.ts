import type { Contract } from '@prisma-next/contract/types';
import { errorDataTransformContractMismatch } from '@prisma-next/errors/migration';
import type {
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
} from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresPlanTargetDetails } from '../planner-target-details';

interface Buildable<R = unknown> {
  build(): SqlQueryPlan<R>;
}

export type DataTransformAstClosure = () => SqlQueryPlan | Buildable;

export interface DataTransformAstOptions {
  readonly invariantId?: string;
  readonly check?: DataTransformAstClosure;
  readonly run: DataTransformAstClosure | readonly DataTransformAstClosure[];
}

const AST_BOUND_SENTINEL = '-- AST-bound: lowered at apply time --';

/**
 * Migration op factory that embeds the serialized AST in the op payload
 * rather than lowering to SQL at authoring time. The apply-time runner
 * reconstructs the AST via {@link parseAnyQueryAst}, lowers through the
 * adapter, and executes the resulting SQL.
 *
 * Sibling to {@link dataTransform}; the only difference is serialization
 * timing: `dataTransform` lowers eagerly, `dataTransformAst` defers.
 */
export function dataTransformAst<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  name: string,
  options: DataTransformAstOptions,
  _adapter: SqlControlAdapter<'postgres'>,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  const runClosures: readonly DataTransformAstClosure[] = Array.isArray(options.run)
    ? options.run
    : [options.run as DataTransformAstClosure];

  const checkAst = options.check ? invokeAndExtractAst(options.check, contract, name) : null;
  const runAsts = runClosures.map((closure) => invokeAndExtractAst(closure, contract, name));

  const precheck: readonly SqlMigrationPlanOperationStep[] = checkAst
    ? [astBoundStep(`Check ${name} has work to do`, checkAst)]
    : [];

  const execute: readonly SqlMigrationPlanOperationStep[] = runAsts.map((ast) =>
    astBoundStep(`Run ${name}`, ast),
  );

  const postcheck: readonly SqlMigrationPlanOperationStep[] = checkAst
    ? [astBoundStep(`Verify ${name} resolved all violations`, checkAst)]
    : [];

  return {
    id: `data_migration_ast.${name}`,
    label: `Data transform (AST): ${name}`,
    operationClass: 'data',
    ...ifDefined('invariantId', options.invariantId),
    target: { id: 'postgres' },
    precheck,
    execute,
    postcheck,
  };
}

function astBoundStep(description: string, ast: AnyQueryAst): SqlMigrationPlanOperationStep {
  return {
    description,
    sql: AST_BOUND_SENTINEL,
    meta: { ast: JSON.parse(JSON.stringify(ast)) as Record<string, unknown> },
  };
}

function invokeAndExtractAst(
  closure: DataTransformAstClosure,
  contract: Contract<SqlStorage>,
  name: string,
): AnyQueryAst {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  return plan.ast;
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
