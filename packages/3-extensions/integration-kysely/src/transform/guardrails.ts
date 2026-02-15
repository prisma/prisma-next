import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors.js';
import { getColumnName, getTableName, hasKind } from './kysely-ast-types.js';

function isMultiTableSelect(node: Record<string, unknown>): boolean {
  const joins = node['joins'];
  return Array.isArray(joins) && joins.length > 0;
}

function hasExplicitTableRef(node: unknown): boolean {
  return getTableName(node) !== undefined;
}

function isColumnRef(node: unknown): boolean {
  return getColumnName(node) !== undefined;
}

function checkUnqualifiedColumnRef(node: unknown, multiTable: boolean, path: string): void {
  if (!multiTable) return;
  if (typeof node !== 'object' || node === null) return;

  const n = node as Record<string, unknown>;

  if (hasKind(node, 'ReferenceNode')) {
    const colNode = n['column'] ?? n;
    if (isColumnRef(colNode) && !hasExplicitTableRef(colNode)) {
      throw new KyselyTransformError(
        'Unqualified column reference in multi-table scope; use table.column (e.g. user.id)',
        KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        { path },
      );
    }
  }

  if (hasKind(node, 'ColumnNode')) {
    if (isColumnRef(node) && !hasExplicitTableRef(node)) {
      throw new KyselyTransformError(
        'Unqualified column reference in multi-table scope; use table.column (e.g. user.id)',
        KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        { path },
      );
    }
  }
}

function walkForColumnRefs(node: unknown, multiTable: boolean, path: string): void {
  if (!node) return;
  if (typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkForColumnRefs(node[i], multiTable, `${path}[${i}]`);
    }
    return;
  }

  checkUnqualifiedColumnRef(node, multiTable, path);

  const n = node as Record<string, unknown>;

  const childPaths: Array<{ key: string; value: unknown }> = [];
  if (n['left']) childPaths.push({ key: 'left', value: n['left'] });
  if (n['right']) childPaths.push({ key: 'right', value: n['right'] });
  if (n['column']) childPaths.push({ key: 'column', value: n['column'] });
  if (n['selection']) childPaths.push({ key: 'selection', value: n['selection'] });
  if (n['orderBy']) childPaths.push({ key: 'orderBy', value: n['orderBy'] });
  if (n['exprs']) {
    const arr = n['exprs'] as unknown[];
    for (let i = 0; i < arr.length; i++) {
      childPaths.push({ key: `exprs[${i}]`, value: arr[i] });
    }
  }
  if (n['items']) {
    const arr = n['items'] as unknown[];
    for (let i = 0; i < arr.length; i++) {
      childPaths.push({ key: `items[${i}]`, value: arr[i] });
    }
  }
  if (n['node']) childPaths.push({ key: 'node', value: n['node'] });

  for (const { key, value } of childPaths) {
    walkForColumnRefs(value, multiTable, `${path}.${key}`);
  }
}

function checkSelectAllAmbiguity(
  selections: unknown,
  multiTable: boolean,
  _contract: SqlContract<SqlStorage>,
): void {
  if (!multiTable) return;
  const arr = Array.isArray(selections) ? selections : [];
  for (const sel of arr) {
    if (typeof sel !== 'object' || sel === null) continue;
    if (!hasKind(sel, 'SelectAllNode')) continue;
    const s = sel as Record<string, unknown>;
    const tableRef = s['reference'] ?? s['table'];
    const table = tableRef ? getTableName(tableRef) : undefined;
    if (!table) {
      throw new KyselyTransformError(
        `Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll('user'))`,
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }
  }
}

export function runGuardrails(contract: SqlContract<SqlStorage>, query: unknown): void {
  if (!query || typeof query !== 'object') return;

  const node = query as Record<string, unknown>;
  const kind = node['kind'];

  if (kind !== 'SelectQueryNode') return;

  const multiTable = isMultiTableSelect(node);

  walkForColumnRefs(node['selections'], multiTable, 'selections');
  walkForColumnRefs(
    (node['where'] as Record<string, unknown> | null)?.['node'] ?? node['where'],
    multiTable,
    'where',
  );
  walkForColumnRefs(node['orderBy'], multiTable, 'orderBy');
  const joins = (node['joins'] ?? []) as unknown[];
  for (let i = 0; i < joins.length; i++) {
    const j = joins[i] as Record<string, unknown>;
    walkForColumnRefs(
      (j['on'] as Record<string, unknown> | null)?.['node'] ?? j['on'],
      multiTable,
      `joins[${i}].on`,
    );
  }

  checkSelectAllAmbiguity(node['selections'], multiTable, contract);
}
