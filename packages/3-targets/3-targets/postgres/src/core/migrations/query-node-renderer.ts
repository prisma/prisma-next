/**
 * Renders SerializedQueryNode ASTs to SQL strings.
 *
 * For v1, only supports `raw_sql` nodes (passthrough).
 * When the query builder serialization pipeline lands, this is where
 * proper AST → SQL rendering would be implemented. The raw_sql node
 * type remains as the escape hatch.
 */

import type { SerializedQueryNode } from '@prisma-next/core-control-plane/types';

export function renderQueryNodeToSql(node: SerializedQueryNode): string {
  if (node.kind === 'raw_sql') {
    const sql = node['sql'];
    if (typeof sql !== 'string') {
      throw new Error('raw_sql node must have a string "sql" field');
    }
    return sql;
  }
  throw new Error(
    `Cannot render SerializedQueryNode of kind "${node.kind}" to SQL. Only "raw_sql" is supported.`,
  );
}
