import type { Adapter, AdapterProfile, LowererContext } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import type {
  BinaryExpr,
  ColumnRef,
  JoinAst,
  ParamRef,
  PostgresAdapterOptions,
  PostgresContract,
  PostgresLoweredStatement,
  SelectAst,
} from './types';
import { codecDefinitions } from './codecs';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
  },
});

class PostgresAdapterImpl
  implements Adapter<SelectAst, PostgresContract, PostgresLoweredStatement>
{
  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();

  constructor(options?: PostgresAdapterOptions) {
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
    });
  }

  lower(ast: SelectAst, context: LowererContext<PostgresContract>) {
    const sql = renderSelect(ast);
    const params = context.params ? [...context.params] : [];

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst): string {
  const selectClause = `SELECT ${renderProjection(ast)}`;
  const fromClause = `FROM ${quoteIdentifier(ast.from.name)}`;

  const joinsClause = ast.joins?.length ? ast.joins.map((join) => renderJoin(join)).join(' ') : '';
  const includesClause = ast.includes?.length ? ast.includes.map((include) => renderInclude(include)).join(' ') : '';

  const whereClause = ast.where ? ` WHERE ${renderBinary(ast.where)}` : '';
  const orderClause = ast.orderBy?.length
    ? ` ORDER BY ${ast.orderBy
        .map((order) => `${renderColumn(order.expr)} ${order.dir.toUpperCase()}`)
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? ` LIMIT ${ast.limit}` : '';

  const clauses = [joinsClause, includesClause].filter(Boolean).join(' ');
  return `${selectClause} ${fromClause}${clauses ? ` ${clauses}` : ''}${whereClause}${orderClause}${limitClause}`.trim();
}

function renderProjection(ast: SelectAst): string {
  return ast.project
    .map((item) => {
      if (item.expr.kind === 'includeRef') {
        // For include references, select the column from the LATERAL join alias
        // The LATERAL subquery returns a single column (the JSON array)
        // Since the subquery returns a single unnamed column, we need to select it using the alias
        // PostgreSQL allows selecting from a table alias directly when there's only one column
        // We use the alias directly since the subquery returns a single column
        // The subquery result is available as a column, so we select it using the alias
        // We need to select the column from the subquery result, which is the first (and only) column
        // The subquery result is available as a column, so we select it using the alias directly
        return `${quoteIdentifier(item.expr.alias)} AS ${quoteIdentifier(item.alias)}`;
      }
      const column = renderColumn(item.expr);
      const alias = quoteIdentifier(item.alias);
      return `${column} AS ${alias}`;
    })
    .join(', ');
}

function renderBinary(expr: BinaryExpr): string {
  const left = renderColumn(expr.left);
  const right = renderParam(expr.right);
  return `${left} = ${right}`;
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderParam(ref: ParamRef): string {
  return `$${ref.index}`;
}

function renderJoin(join: JoinAst): string {
  const joinType = join.joinType.toUpperCase();
  const table = quoteIdentifier(join.table.name);
  const onClause = renderJoinOn(join.on);
  return `${joinType} JOIN ${table} ON ${onClause}`;
}

function renderJoinOn(on: JoinAst['on']): string {
  if (on.kind === 'eqCol') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  throw new Error(`Unsupported join ON expression kind: ${on.kind}`);
}

function renderInclude(include: NonNullable<SelectAst['includes']>[number]): string {
  const alias = quoteIdentifier(include.alias);

  // Build the lateral subquery
  const childProjection = include.child.project
    .map((item: { alias: string; expr: ColumnRef }) => {
      const column = renderColumn(item.expr);
      return `'${item.alias}', ${column}`;
    })
    .join(', ');

  const jsonBuildObject = `json_build_object(${childProjection})`;

  // Build the ON condition from the include's ON clause - this goes in the WHERE clause
  const onCondition = renderJoinOn(include.child.on);

  // Build WHERE clause: combine ON condition with any additional WHERE clauses
  let whereClause = ` WHERE ${onCondition}`;
  if (include.child.where) {
    whereClause += ` AND ${renderBinary(include.child.where)}`;
  }

  // Add ORDER BY if present - it goes inside json_agg() call
  const childOrderBy = include.child.orderBy?.length
    ? ` ORDER BY ${include.child.orderBy
        .map((order: { expr: ColumnRef; dir: string }) => `${renderColumn(order.expr)} ${order.dir.toUpperCase()}`)
        .join(', ')}`
    : '';

  // Add LIMIT if present
  const childLimit = typeof include.child.limit === 'number' ? ` LIMIT ${include.child.limit}` : '';

  // Build the lateral subquery
  // When ORDER BY is present without LIMIT, it goes inside json_agg() call: json_agg(expr ORDER BY ...)
  // When LIMIT is present (with or without ORDER BY), we need to wrap in a subquery
  const childTable = quoteIdentifier(include.child.table.name);
  let subquery: string;
  if (typeof include.child.limit === 'number') {
    // With LIMIT, we need to wrap in a subquery
    // Select individual columns in inner query, then aggregate
    // Create a map of column references to their aliases for ORDER BY
    const columnAliasMap = new Map<string, string>();
    include.child.project.forEach((item: { alias: string; expr: ColumnRef }) => {
      const columnKey = `${item.expr.table}.${item.expr.column}`;
      columnAliasMap.set(columnKey, item.alias);
    });

    const innerColumns = include.child.project
      .map((item: { alias: string; expr: ColumnRef }) => {
        const column = renderColumn(item.expr);
        return `${column} AS ${quoteIdentifier(item.alias)}`;
      })
      .join(', ');

    // For ORDER BY, use column aliases if the column is in the SELECT list
    const childOrderByWithAliases = include.child.orderBy?.length
      ? ` ORDER BY ${include.child.orderBy
          .map((order: { expr: ColumnRef; dir: string }) => {
            const columnKey = `${order.expr.table}.${order.expr.column}`;
            const alias = columnAliasMap.get(columnKey);
            if (alias) {
              return `${quoteIdentifier(alias)} ${order.dir.toUpperCase()}`;
            }
            return `${renderColumn(order.expr)} ${order.dir.toUpperCase()}`;
          })
          .join(', ')}`
      : '';

    const innerSelect = `SELECT ${innerColumns} FROM ${childTable}${whereClause}${childOrderByWithAliases}${childLimit}`;
    subquery = `(SELECT json_agg(row_to_json(sub.*)) FROM (${innerSelect}) sub)`;
  } else if (childOrderBy) {
    // With ORDER BY but no LIMIT, ORDER BY goes inside json_agg()
    subquery = `(SELECT json_agg(${jsonBuildObject}${childOrderBy}) FROM ${childTable}${whereClause})`;
  } else {
    // No ORDER BY or LIMIT
    subquery = `(SELECT json_agg(${jsonBuildObject}) FROM ${childTable}${whereClause})`;
  }

  // Return the LATERAL join with ON true (the condition is in the WHERE clause)
  // The subquery returns a single column (the JSON array)
  // We alias the subquery result as the include alias so we can select it in the projection
  return `LEFT JOIN LATERAL ${subquery} AS ${quoteIdentifier(alias)} ON true`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
