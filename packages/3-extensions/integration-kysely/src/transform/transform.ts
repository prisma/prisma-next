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
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import type { TransformResult } from './transform-context';
import { createContext } from './transform-context';
import { transformDelete, transformInsert, transformUpdate } from './transform-dml';
import { transformSelect } from './transform-select';

export type { TransformResult };

function extractRefsFromAst(ast: QueryAst): PlanRefs {
  const tables = new Set<string>();
  const columns: Array<{ table: string; column: string }> = [];

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
      tables.add(table);
      columns.push({ table, column });
      return;
    }
    for (const v of Object.values(n)) {
      visit(v);
    }
  }

  visit(ast);
  return {
    tables: [...tables],
    columns,
  };
}

export function transformKyselyToPnAst(
  contract: SqlContract<SqlStorage>,
  query: object,
  parameters: readonly unknown[],
): TransformResult {
  if (!query || typeof query !== 'object') {
    throw new KyselyTransformError(
      'Query must be a non-null object',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    );
  }

  const node = query as Record<string, unknown>;
  const kind = node['kind'];

  const ctx = createContext(contract, parameters);

  let ast: QueryAst;

  if (kind === 'SelectQueryNode') {
    ast = transformSelect(node, ctx);
  } else if (kind === 'InsertQueryNode') {
    ast = transformInsert(node, ctx);
  } else if (kind === 'UpdateQueryNode') {
    ast = transformUpdate(node, ctx);
  } else if (kind === 'DeleteQueryNode') {
    ast = transformDelete(node, ctx);
  } else {
    throw new KyselyTransformError(
      `Unsupported query kind: ${kind ?? 'unknown'}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: String(kind) },
    );
  }

  const refs = extractRefsFromAst(ast);

  const paramDescriptors = ctx.paramDescriptors.map((d, i) => ({
    ...d,
    index: i + 1,
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  if (ast.kind === 'select') {
    projection = Object.fromEntries(
      ast.project.map((p) => [p.alias, p.expr.kind === 'col' ? p.expr.column : p.alias]),
    );
    projectionTypes = {};
    for (const p of ast.project) {
      if (p.expr.kind === 'col') {
        const col = ctx.contract.storage.tables[p.expr.table]?.columns[p.expr.column];
        if (col) {
          projectionTypes[p.alias] = col.codecId;
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
