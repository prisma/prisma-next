/**
 * Transforms Kysely compiled query AST into Prisma Next SQL QueryAst.
 *
 * Defensive behavior: If ambiguity slips through (e.g. guardrails bypassed or invoked directly),
 * the transformer throws rather than emitting best-effort refs. Specifically:
 * - Unqualified column refs in multi-table scope → UNQUALIFIED_REF_IN_MULTI_TABLE
 * - Ambiguous selectAll in multi-table scope → AMBIGUOUS_SELECT_ALL
 * - Unsupported node kinds → UNSUPPORTED_NODE
 */
import type { PlanRefs } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryAst } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { DeleteQueryNode, InsertQueryNode, SelectQueryNode, UpdateQueryNode } from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { isTransformableRootNode } from './kysely-ast-types';
import type { TransformResult } from './transform-context';
import { createContext } from './transform-context';
import { transformDelete, transformInsert, transformUpdate } from './transform-dml';
import { transformSelect } from './transform-select';

export type { TransformResult };

function extractRefsFromAst(ast: QueryAst): PlanRefs {
  const tables = new Set<string>();
  const columns: Array<{ table: string; column: string }> = [];
  const columnKeys = new Set<string>();

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, unknown>;
    const kind = n['kind'];
    const name = n['name'];
    const table = n['table'];
    const column = n['column'];
    if (kind === 'table' && typeof name === 'string') {
      tables.add(name);
      return;
    }
    if (kind === 'col' && typeof table === 'string' && typeof column === 'string') {
      if (table === 'excluded') {
        return;
      }
      tables.add(table);
      const key = `${table}.${column}`;
      if (!columnKeys.has(key)) {
        columnKeys.add(key);
        columns.push({ table, column });
      }
      return;
    }
    for (const value of Object.values(n)) {
      visit(value);
    }
  }

  visit(ast);
  const sortedTables = [...tables].sort((a, b) => a.localeCompare(b));
  const sortedColumns = [...columns].sort((a, b) => {
    const tableCompare = a.table.localeCompare(b.table);
    if (tableCompare !== 0) {
      return tableCompare;
    }
    return a.column.localeCompare(b.column);
  });
  return {
    tables: sortedTables,
    columns: sortedColumns,
  };
}

export interface TransformResultWithParams extends TransformResult {
  readonly params: readonly unknown[];
}

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

  let ast: QueryAst;
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

  const refs = extractRefsFromAst(ast);

  const paramDescriptors = ctx.paramDescriptors.map((descriptor, index) => ({
    ...descriptor,
    index: index + 1,
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  if (ast.kind === 'select') {
    projection = Object.fromEntries(
      ast.project.map((projected) => [
        projected.alias,
        projected.expr.kind === 'col' ? projected.expr.column : projected.alias,
      ]),
    );

    projectionTypes = {};
    for (const projected of ast.project) {
      if (projected.expr.kind === 'col') {
        const column =
          ctx.contract.storage.tables[projected.expr.table]?.columns[projected.expr.column];
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
    ...ifDefined('selectAllIntent', ast.kind === 'select' ? ast.selectAllIntent : undefined),
  };

  return { ast, metaAdditions };
}

export function transformKyselyToPnAstCollectingParams(
  contract: SqlContract<SqlStorage>,
  query: unknown,
): TransformResultWithParams {
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

  let ast: QueryAst;
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

  const refs = extractRefsFromAst(ast);

  const paramDescriptors = ctx.paramDescriptors.map((descriptor, index) => ({
    ...descriptor,
    index: index + 1,
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  if (ast.kind === 'select') {
    projection = Object.fromEntries(
      ast.project.map((projected) => [
        projected.alias,
        projected.expr.kind === 'col' ? projected.expr.column : projected.alias,
      ]),
    );

    projectionTypes = {};
    for (const projected of ast.project) {
      if (projected.expr.kind === 'col') {
        const column =
          ctx.contract.storage.tables[projected.expr.table]?.columns[projected.expr.column];
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
    ...ifDefined('selectAllIntent', ast.kind === 'select' ? ast.selectAllIntent : undefined),
  };

  return { ast, params: ctx.params, metaAdditions };
}
