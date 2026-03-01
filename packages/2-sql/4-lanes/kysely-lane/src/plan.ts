import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CompiledQuery } from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './transform/errors';
import { runGuardrails } from './transform/guardrails';
import { isTransformableRootNode } from './transform/kysely-ast-types';
import { transformKyselyToPnAst } from './transform/transform';

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
  const kind =
    query && typeof query === 'object' && 'kind' in query
      ? String((query as { kind?: unknown }).kind ?? 'unknown')
      : 'unknown';
  if (!isTransformableRootNode(query)) {
    throw new KyselyTransformError(
      `Unsupported query kind: ${kind}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: kind },
    );
  }

  runGuardrails(contract, query);
  const { ast, metaAdditions } = transformKyselyToPnAst(contract, query, compiledQuery.parameters);

  const paramDescriptors = metaAdditions.paramDescriptors;
  if (compiledQuery.parameters.length < paramDescriptors.length) {
    throw new KyselyTransformError(
      `Kysely plan parameter mismatch: compiled parameters length (${compiledQuery.parameters.length}) must be at least paramDescriptors length (${paramDescriptors.length})`,
      KYSELY_TRANSFORM_ERROR_CODES.PARAMETER_MISMATCH,
      {
        compiledParamCount: compiledQuery.parameters.length,
        descriptorCount: paramDescriptors.length,
      },
    );
  }
  const params = compiledQuery.parameters.slice(0, paramDescriptors.length);

  const annotations: { sql?: string; codecs?: Record<string, string> } = {
    sql: REDACTED_SQL,
  };
  if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
    annotations.codecs = { ...metaAdditions.projectionTypes };
  }

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
      annotations,
    },
  };
}
