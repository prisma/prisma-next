import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CompiledQuery } from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './transform/errors';
import { runGuardrails } from './transform/guardrails';
import { transformKyselyToPnAst } from './transform/transform';

const TRANSFORMABLE_KINDS = new Set([
  'SelectQueryNode',
  'InsertQueryNode',
  'UpdateQueryNode',
  'DeleteQueryNode',
]);

export const REDACTED_SQL = '/* redacted by @prisma-next/sql-kysely-lane */';

export interface BuildKyselyPlanOptions {
  readonly lane?: string;
}

export function buildKyselyPlan<Row>(
  contract: SqlContract<SqlStorage>,
  compiledQuery: CompiledQuery<Row>,
  options: BuildKyselyPlanOptions = {},
): SqlQueryPlan<Row> {
  const query = (compiledQuery as { query?: unknown }).query;
  const kind = (query as { kind?: string })?.kind;
  if (!query || typeof query !== 'object' || !kind || !TRANSFORMABLE_KINDS.has(kind)) {
    throw new KyselyTransformError(
      `Unsupported query kind: ${kind ?? 'unknown'}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: String(kind ?? 'unknown') },
    );
  }

  runGuardrails(contract, query);
  const { ast, metaAdditions } = transformKyselyToPnAst(contract, query, compiledQuery.parameters);

  const annotations: { redactedSql?: string; codecs?: Record<string, string> } = {
    redactedSql: REDACTED_SQL,
  };
  if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
    annotations.codecs = { ...metaAdditions.projectionTypes };
  }

  const paramDescriptors = metaAdditions.paramDescriptors;
  const params = compiledQuery.parameters.slice(0, paramDescriptors.length);

  return {
    ast,
    params,
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storageHash,
      ...ifDefined('profileHash', contract.profileHash),
      lane: options.lane ?? 'kysely',
      paramDescriptors,
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
    },
  };
}
