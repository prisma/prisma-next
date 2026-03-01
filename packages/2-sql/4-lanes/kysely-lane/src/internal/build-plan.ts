import type { ParamDescriptor, PlanMeta, PlanRefs } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import { runGuardrails } from '../transform/guardrails';
import { transformKyselyToPnAstCollectingParams } from '../transform/transform';

function buildMeta(
  contract: SqlContract<SqlStorage>,
  metaAdditions: {
    readonly refs: PlanRefs;
    readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
    readonly projection?: PlanMeta['projection'];
    readonly projectionTypes?: PlanMeta['projectionTypes'];
    readonly selectAllIntent?: { table?: string };
  },
): PlanMeta {
  const annotations: { codecs?: Record<string, string>; selectAllIntent?: { table?: string } } = {};
  if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
    annotations.codecs = { ...metaAdditions.projectionTypes };
  }
  if (metaAdditions.selectAllIntent) {
    annotations.selectAllIntent = metaAdditions.selectAllIntent;
  }

  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storageHash,
    ...ifDefined('profileHash', contract.profileHash),
    lane: 'kysely' as const,
    paramDescriptors: metaAdditions.paramDescriptors,
    refs: metaAdditions.refs,
    ...ifDefined('projection', metaAdditions.projection),
    ...ifDefined(
      'projectionTypes',
      metaAdditions.projectionTypes !== undefined &&
        Object.keys(metaAdditions.projectionTypes).length > 0
        ? metaAdditions.projectionTypes
        : undefined,
    ),
    ...ifDefined('annotations', Object.keys(annotations).length > 0 ? annotations : undefined),
  };
}

/**
 * Internal helper for turning a Kysely operation node into a PN SqlQueryPlan without compiling SQL.
 * Not exported from the package public surface.
 */
export function buildKyselyPlan<Row>(
  contract: SqlContract<SqlStorage>,
  query: unknown,
): SqlQueryPlan<Row> {
  runGuardrails(contract, query);
  const { ast, params, metaAdditions } = transformKyselyToPnAstCollectingParams(contract, query);

  const paramDescriptors = metaAdditions.paramDescriptors;
  const planParams = params.slice(0, paramDescriptors.length);

  return {
    ast,
    params: planParams,
    meta: buildMeta(contract, metaAdditions),
  };
}
