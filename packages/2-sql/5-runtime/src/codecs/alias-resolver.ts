import type { AnyFromSource, AnyQueryAst } from '@prisma-next/sql-relational-core/ast';

/**
 * Build a map from query-local table aliases to their underlying source table names.
 *
 * Self-joins like `db.sql.post.as('p1').innerJoin(db.sql.post.as('p2'), …)` produce `ColumnRef`s whose `table` is the alias (`p1`, `p2`) — the SQL renderer needs the alias for `SELECT p1.id, …`. Codec dispatch keys `byColumn` by the underlying source table, so aliases must be resolved back to the source name for `forColumn(...)` to hit. Tables that already use their canonical name (no alias) are also entered so a single
 * lookup works for both shapes.
 */
function buildAliasMap(ast: AnyQueryAst): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const recordSource = (source: AnyFromSource): void => {
    if (source.kind === 'table-source') {
      const key = source.alias ?? source.name;
      aliases.set(key, source.name);
    } else {
      aliases.set(source.alias, source.alias);
    }
  };
  if (ast.kind === 'select') {
    recordSource(ast.from);
    for (const join of ast.joins ?? []) {
      recordSource(join.source);
    }
  } else if (ast.kind === 'raw-sql') {
    // Raw-SQL ASTs do not bind a single primary table — alias resolution
    // is driven by inline `IdentifierRef`s the caller embedded directly.
  } else {
    recordSource(ast.table);
  }
  return aliases;
}

export function makeAliasResolver(ast: AnyQueryAst | undefined): (alias: string) => string {
  if (!ast) return (alias) => alias;
  const map = buildAliasMap(ast);
  return (alias) => map.get(alias) ?? alias;
}
