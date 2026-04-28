import type { Contract, ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { AnnotationValue, OperationKind } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst, ParamRef } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';

function resolveProjectionCodecs(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
): Record<string, string> | undefined {
  const codecs: Record<string, string> = {};

  if (ast.kind === 'select') {
    for (const item of ast.projection) {
      if (item.expr.kind === 'column-ref') {
        const table = contract.storage.tables[item.expr.table];
        const col = table?.columns[item.expr.column];
        if (col?.codecId) {
          codecs[item.alias] = col.codecId;
        }
      }
    }
  } else if (ast.returning) {
    const tableName = ast.table.name;
    const table = contract.storage.tables[tableName];
    if (!table) return undefined;

    for (const colRef of ast.returning) {
      const col = table.columns[colRef.column];
      if (col?.codecId) {
        codecs[colRef.column] = col.codecId;
      }
    }
  }

  return Object.keys(codecs).length > 0 ? codecs : undefined;
}

export function deriveParamsFromAst(ast: { collectParamRefs(): ParamRef[] }): {
  params: unknown[];
  paramDescriptors: ParamDescriptor[];
} {
  const collectedParams = [...new Set(ast.collectParamRefs())];
  return {
    params: collectedParams.map((p) => p.value),
    paramDescriptors: collectedParams.map((p) => ({
      ...ifDefined('name', p.name),
      ...ifDefined('codecId', p.codecId),
      source: 'dsl' as const,
    })),
  };
}

export function resolveTableColumns(contract: Contract<SqlStorage>, tableName: string): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

export function buildOrmPlanMeta(
  contract: Contract<SqlStorage>,
  paramDescriptors: readonly ParamDescriptor[] = [],
): PlanMeta {
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storage.storageHash,
    ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
    lane: 'orm-client',
    paramDescriptors: [...paramDescriptors],
  };
}

export function buildOrmQueryPlan<Row>(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
  params: readonly unknown[],
  paramDescriptors: readonly ParamDescriptor[] = [],
  userAnnotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): SqlQueryPlan<Row> {
  const projectionTypes = resolveProjectionCodecs(contract, ast);
  const codecAnnotations = projectionTypes
    ? { codecs: Object.freeze({ ...projectionTypes }) }
    : undefined;
  const limitAnnotation =
    ast.kind === 'select' && ast.limit !== undefined ? { limit: ast.limit } : undefined;
  const userAnnotationEntries: Record<string, AnnotationValue<unknown, OperationKind>> = {};
  if (userAnnotations !== undefined) {
    for (const [namespace, value] of userAnnotations) {
      userAnnotationEntries[namespace] = value;
    }
  }
  const hasUserAnnotations = Object.keys(userAnnotationEntries).length > 0;
  // Reserved framework namespaces (`codecs`, `limit`) win over user
  // annotations if a user handle ever names one of them — see the
  // reserved-namespace policy on `defineAnnotation`.
  const annotations =
    codecAnnotations || limitAnnotation || hasUserAnnotations
      ? Object.freeze({
          ...userAnnotationEntries,
          ...codecAnnotations,
          ...limitAnnotation,
        })
      : undefined;

  return Object.freeze({
    ast,
    params: [...params],
    meta: {
      ...buildOrmPlanMeta(contract, paramDescriptors),
      ...ifDefined('projectionTypes', projectionTypes),
      ...ifDefined('annotations', annotations),
    },
  });
}

/**
 * Merges user annotations into an existing `SqlQueryPlan`'s
 * `meta.annotations` and returns a new frozen plan.
 *
 * Used by the ORM dispatch path to attach terminal-call annotations to
 * plans produced by mutation compile functions (which don't take user
 * annotations as parameters). Reads compile through `compileSelect`-
 * family functions that pass `state.userAnnotations` directly to
 * `buildOrmQueryPlan`; this helper is the alternate path for write
 * terminals where user annotations arrive at the call site, not via
 * state.
 *
 * Returns the input plan unchanged when `userAnnotations` is undefined
 * or empty. Reserved framework namespaces (`codecs`, `limit`) on the
 * input plan win over user annotations under the same key — see the
 * reserved-namespace policy on `defineAnnotation`.
 */
export function mergeUserAnnotations<Row>(
  plan: SqlQueryPlan<Row>,
  userAnnotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
): SqlQueryPlan<Row> {
  if (userAnnotations === undefined || userAnnotations.size === 0) {
    return plan;
  }
  const userEntries: Record<string, AnnotationValue<unknown, OperationKind>> = {};
  for (const [namespace, value] of userAnnotations) {
    userEntries[namespace] = value;
  }
  // User annotations go first so framework-reserved keys on the existing
  // plan (codecs, limit) override any user-supplied collision.
  const mergedAnnotations = Object.freeze({
    ...userEntries,
    ...(plan.meta.annotations ?? {}),
  });
  return Object.freeze({
    ...plan,
    meta: Object.freeze({
      ...plan.meta,
      annotations: mergedAnnotations,
    }),
  });
}
