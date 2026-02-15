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
  const table = n['table'] ?? n['reference'] ?? n['into'];
  if (typeof table === 'string') return table;
  if (typeof table === 'object' && table !== null) {
    const t = table as Record<string, unknown>;
    if ('name' in t && typeof (t as { name: string }).name === 'string') {
      return (t as { name: string }).name;
    }
    const identifier = t['identifier'];
    if (typeof identifier === 'object' && identifier !== null) {
      const id = identifier as Record<string, unknown>;
      if ('name' in id && typeof (id as { name: string }).name === 'string') {
        return String((id as { name: string }).name);
      }
    }
    const innerTable = t['table'];
    if (typeof innerTable === 'object' && innerTable !== null) {
      const inner = innerTable as Record<string, unknown>;
      if ('name' in inner && typeof (inner as { name: string }).name === 'string') {
        return String((inner as { name: string }).name);
      }
      const innerId = inner['identifier'];
      if (typeof innerId === 'object' && innerId !== null && 'name' in innerId) {
        return String((innerId as { name: string }).name);
      }
    }
  }
  if ('name' in n && typeof (n as { name: string }).name === 'string') {
    return (n as { name: string }).name;
  }
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
  if (typeof col === 'object' && col !== null) {
    const c = col as Record<string, unknown>;
    const identifier = c['identifier'];
    if (typeof identifier === 'object' && identifier !== null && 'name' in identifier) {
      return String((identifier as { name: string }).name);
    }
  }
  if (typeof col === 'string') return col;
  const name = n['name'];
  if (typeof name === 'string') return name;
  if (typeof n['identifier'] === 'object' && n['identifier'] !== null) {
    const id = n['identifier'] as Record<string, unknown>;
    if ('name' in id && typeof (id as { name: string }).name === 'string') {
      return String((id as { name: string }).name);
    }
  }
  return undefined;
}
