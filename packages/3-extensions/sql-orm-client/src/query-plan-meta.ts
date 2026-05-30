import type { Contract, PlanMeta } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { AnnotationValue, OperationKind } from '@prisma-next/framework-components/runtime';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { type AnyQueryAst, collectOrderedParamRefs } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';

export function deriveParamsFromAst(ast: AnyQueryAst): {
  params: unknown[];
} {
  return {
    params: collectOrderedParamRefs(ast).map((p) => (p.kind === 'param-ref' ? p.value : undefined)),
  };
}

export function resolveTableColumns(contract: Contract<SqlStorage>, tableName: string): string[] {
  const table = getStorageNamespace(
    contract.storage as Record<string, unknown>,
    UNBOUND_NAMESPACE_ID,
  )?.tables[tableName] as StorageTable | undefined;
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

export function buildOrmPlanMeta(
  contract: Contract<SqlStorage>,
  annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): PlanMeta {
  const annotationRecord =
    annotations !== undefined && annotations.size > 0
      ? Object.freeze(Object.fromEntries(annotations))
      : undefined;
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storage.storageHash,
    ...ifDefined('profileHash', contract.profileHash),
    ...ifDefined('annotations', annotationRecord),
    lane: 'orm-client',
  };
}

export function buildOrmQueryPlan<Row>(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
  params: readonly unknown[],
  annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): SqlQueryPlan<Row> {
  return Object.freeze({
    ast,
    params: [...params],
    meta: buildOrmPlanMeta(contract, annotations),
  });
}

/**
 * Merges annotations into an existing `SqlQueryPlan`'s
 * `meta.annotations` and returns a new frozen plan.
 *
 * Used by the ORM dispatch path to attach terminal-call annotations to
 * plans produced by mutation compile functions (which don't take
 * annotations as parameters). Reads compile through `compileSelect`-
 * family functions that pass `state.annotations` directly to
 * `buildOrmQueryPlan`; this helper is the alternate path for write
 * terminals where annotations arrive at the call site, not via state.
 *
 * Returns the input plan unchanged when `annotations` is undefined
 * or empty. Reserved framework namespaces (`codecs`, `limit`) on the
 * input plan win over caller-supplied entries under the same key —
 * see the reserved-namespace policy on `defineAnnotation`.
 */
export function mergeAnnotations<Row>(
  plan: SqlQueryPlan<Row>,
  annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
): SqlQueryPlan<Row> {
  if (annotations === undefined || annotations.size === 0) {
    return plan;
  }
  const callerEntries: Record<string, AnnotationValue<unknown, OperationKind>> = {};
  for (const [namespace, value] of annotations) {
    callerEntries[namespace] = value;
  }
  // Caller-supplied annotations go first so framework-reserved keys on
  // the existing plan (codecs, limit) override any collision under the
  // same namespace.
  const mergedAnnotations = Object.freeze({
    ...callerEntries,
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
