import { Op } from '../lowering/postgres';
import { OpSetWithVersion } from '../program';
import { hashOpSet } from '../program';

/**
 * Canonicalize operation set with stable ordering
 */
export function canonicalizeOpSet(operations: Op[]): OpSetWithVersion {
  // Sort operations by canonical ordering rules
  const sortedOps = [...operations].sort(canonicalOpComparator);

  return {
    version: 1,
    operations: sortedOps,
  };
}

/**
 * Compare operations for canonical ordering
 */
function canonicalOpComparator(a: Op, b: Op): number {
  // 1. Group by operation kind
  const kindOrder = {
    addTable: 1,
    addColumn: 2,
    addUnique: 3,
    addIndex: 4,
    addForeignKey: 5,
  };

  const kindDiff = kindOrder[a.kind] - kindOrder[b.kind];
  if (kindDiff !== 0) return kindDiff;

  // 2. Within each kind, sort by table name
  const tableA = (a as any).table || (a as any).name || '';
  const tableB = (b as any).table || (b as any).name || '';
  const tableDiff = tableA.localeCompare(tableB);
  if (tableDiff !== 0) return tableDiff;

  // 3. For operations with columns, sort by columns
  if ('columns' in a && 'columns' in b) {
    const aCols = Array.isArray(a.columns) ? a.columns.join(',') : '';
    const bCols = Array.isArray(b.columns) ? b.columns.join(',') : '';
    const colDiff = aCols.localeCompare(bCols);
    if (colDiff !== 0) return colDiff;
  }

  // 4. For foreign keys, sort by referenced table
  if (a.kind === 'addForeignKey' && b.kind === 'addForeignKey') {
    const refDiff = a.ref.table.localeCompare(b.ref.table);
    if (refDiff !== 0) return refDiff;
  }

  // 5. For columns, sort by column name
  if (a.kind === 'addColumn' && b.kind === 'addColumn') {
    return a.column.name.localeCompare(b.column.name);
  }

  return 0;
}

/**
 * Canonicalize JSON object with sorted keys
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJSON).join(',') + ']';
  }

  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: any = {};

  for (const key of sortedKeys) {
    sortedObj[key] = obj[key];
  }

  return JSON.stringify(sortedObj, null, 0);
}

/**
 * Compute hash of canonicalized operation set
 */
export async function computeOpSetHash(opset: OpSetWithVersion): Promise<`sha256:${string}`> {
  return await hashOpSet(opset);
}
