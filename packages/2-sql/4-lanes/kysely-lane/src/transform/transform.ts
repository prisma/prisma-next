/**
 * Transforms Kysely compiled query AST into Prisma Next SQL QueryAst.
 *
 * Defensive behavior: If ambiguity slips through (e.g. guardrails bypassed or invoked directly),
 * the transformer throws rather than emitting best-effort refs. Specifically:
 * - Unqualified column refs in multi-table scope → UNQUALIFIED_REF_IN_MULTI_TABLE
 * - Ambiguous selectAll in multi-table scope → AMBIGUOUS_SELECT_ALL
 * - Unsupported node kinds → UNSUPPORTED_NODE
 */
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { DeleteQueryNode, InsertQueryNode, SelectQueryNode, UpdateQueryNode } from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { isTransformableRootNode } from './kysely-ast-types';
import type { TransformResult } from './transform-context';
import { createContext } from './transform-context';
import { transformDelete, transformInsert, transformUpdate } from './transform-dml';
import { transformSelect } from './transform-select';

export type { TransformResult };

export interface TransformResultWithParams extends TransformResult {}

export function transformKyselyToPnAst(
  contract: SqlContract<SqlStorage>,
  query: unknown,
  parameters: readonly unknown[],
): TransformResult {
  if (!isTransformableRootNode(query)) {
    const nodeKind =
      query && typeof query === 'object' && 'kind' in query
        ? String((query as { kind?: unknown }).kind ?? 'unknown')
        : 'unknown';

    throw new KyselyTransformError(
      `Unsupported query kind: ${nodeKind}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind },
    );
  }

  const ctx = createContext(contract, parameters);

  let ast: AnyQueryAst;
  if (SelectQueryNode.is(query)) {
    ast = transformSelect(query, ctx);
  } else if (InsertQueryNode.is(query)) {
    ast = transformInsert(query, ctx);
  } else if (UpdateQueryNode.is(query)) {
    ast = transformUpdate(query, ctx);
  } else if (DeleteQueryNode.is(query)) {
    ast = transformDelete(query, ctx);
  } else {
    const exhaustiveCheck: never = query;
    void exhaustiveCheck;
    throw new KyselyTransformError(
      'Unsupported query kind',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: 'unknown' },
    );
  }

  const refs = ast.collectRefs();

  const collectedParams = ast.collectParamRefs();
  const paramDescriptors = collectedParams.map((p, index) => ({
    ...(p.name !== undefined && { name: p.name }),
    source: 'lane' as const,
    index: index + 1,
    ...(p.codecId ? { codecId: p.codecId } : {}),
    ...(p.nativeType ? { nativeType: p.nativeType } : {}),
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  const select = ast.kind === 'select' ? ast : undefined;
  if (select) {
    projection = Object.fromEntries(
      select.projection.map((projected) => {
        const col = projected.expr.kind === 'column-ref' ? projected.expr : undefined;
        return [projected.alias, col?.column ?? projected.alias];
      }),
    );

    projectionTypes = {};
    for (const projected of select.projection) {
      const col = projected.expr.kind === 'column-ref' ? projected.expr : undefined;
      if (col) {
        const column = ctx.contract.storage.tables[col.table]?.columns[col.column];
        if (column) {
          projectionTypes[projected.alias] = column.codecId;
        }
      }
    }
  }

  const metaAdditions = {
    refs,
    paramDescriptors,
    ...ifDefined('projection', projection),
    ...ifDefined(
      'projectionTypes',
      projectionTypes && Object.keys(projectionTypes).length > 0 ? projectionTypes : undefined,
    ),
    ...ifDefined('selectAllIntent', select?.selectAllIntent),
    ...ifDefined('limit', select?.limit),
  };

  return { ast, metaAdditions };
}

export function transformKyselyToPnAstCollectingParams(
  contract: SqlContract<SqlStorage>,
  query: unknown,
): TransformResult {
  if (!isTransformableRootNode(query)) {
    const nodeKind =
      query && typeof query === 'object' && 'kind' in query
        ? String((query as { kind?: unknown }).kind ?? 'unknown')
        : 'unknown';

    throw new KyselyTransformError(
      `Unsupported query kind: ${nodeKind}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind },
    );
  }

  const ctx = createContext(contract);

  let ast: AnyQueryAst;
  if (SelectQueryNode.is(query)) {
    ast = transformSelect(query, ctx);
  } else if (InsertQueryNode.is(query)) {
    ast = transformInsert(query, ctx);
  } else if (UpdateQueryNode.is(query)) {
    ast = transformUpdate(query, ctx);
  } else if (DeleteQueryNode.is(query)) {
    ast = transformDelete(query, ctx);
  } else {
    const exhaustiveCheck: never = query;
    void exhaustiveCheck;
    throw new KyselyTransformError(
      'Unsupported query kind',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: 'unknown' },
    );
  }

  const refs = ast.collectRefs();

  const collectedParams = ast.collectParamRefs();
  const paramDescriptors = collectedParams.map((p, index) => ({
    ...(p.name !== undefined && { name: p.name }),
    source: 'lane' as const,
    index: index + 1,
    ...(p.codecId ? { codecId: p.codecId } : {}),
    ...(p.nativeType ? { nativeType: p.nativeType } : {}),
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  const select = ast.kind === 'select' ? ast : undefined;
  if (select) {
    projection = Object.fromEntries(
      select.projection.map((projected) => {
        const col = projected.expr.kind === 'column-ref' ? projected.expr : undefined;
        return [projected.alias, col?.column ?? projected.alias];
      }),
    );

    projectionTypes = {};
    for (const projected of select.projection) {
      const col = projected.expr.kind === 'column-ref' ? projected.expr : undefined;
      if (col) {
        const column = ctx.contract.storage.tables[col.table]?.columns[col.column];
        if (column) {
          projectionTypes[projected.alias] = column.codecId;
        }
      }
    }
  }

  const metaAdditions = {
    refs,
    paramDescriptors,
    ...ifDefined('projection', projection),
    ...ifDefined(
      'projectionTypes',
      projectionTypes && Object.keys(projectionTypes).length > 0 ? projectionTypes : undefined,
    ),
    ...ifDefined('selectAllIntent', select?.selectAllIntent),
    ...ifDefined('limit', select?.limit),
  };

  return { ast, metaAdditions };
}
