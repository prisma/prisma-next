/**
 * Minimal Kysely AST node type definitions for the transformer.
 * Kysely does not export its internal AST types; these interfaces describe
 * the shapes we expect based on compiled query structure.
 */
export interface KyselyOperationNode {
  readonly kind: string;
  [key: string]: unknown;
}

export function hasKind(node: unknown, kind: string): node is KyselyOperationNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'kind' in node &&
    (node as KyselyOperationNode).kind === kind
  );
}

export function getTableName(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  const table = n['table'] ?? n['reference'];
  if (typeof table === 'object' && table !== null && 'name' in table) {
    return String((table as { name: string }).name);
  }
  if (typeof table === 'string') return table;
  const froms = n['froms'];
  if (Array.isArray(froms) && froms.length > 0) {
    return getTableName(froms[0]);
  }
  return undefined;
}

export function getColumnName(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  const col = n['column'] ?? n['reference'];
  if (typeof col === 'object' && col !== null && 'column' in col) {
    return getColumnName((col as { column: unknown }).column);
  }
  if (typeof col === 'object' && col !== null && 'name' in col) {
    return String((col as { name: string }).name);
  }
  if (typeof col === 'string') return col;
  const name = n['name'];
  if (typeof name === 'string') return name;
  return undefined;
}
