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
    readonly limit?: number;
  },
): PlanMeta {
  const annotations: {
    codecs?: Record<string, string>;
    selectAllIntent?: { table?: string };
    limit?: number;
  } = {};
  if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
    annotations.codecs = { ...metaAdditions.projectionTypes };
  }
  if (metaAdditions.selectAllIntent) {
    annotations.selectAllIntent = metaAdditions.selectAllIntent;
  }
  if (metaAdditions.limit !== undefined) {
    annotations.limit = metaAdditions.limit;
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

export function buildKyselyPlan<Row>(
  contract: SqlContract<SqlStorage>,
  query: unknown,
): SqlQueryPlan<Row> {
  runGuardrails(contract, query);
  const { ast, metaAdditions } = transformKyselyToPnAstCollectingParams(contract, query);

  const collectedParams = ast.collectParamRefs();
  const params = collectedParams.map((p) => p.value);

  return {
    ast,
    params,
    meta: buildMeta(contract, metaAdditions),
  };
}
