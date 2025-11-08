import type {
  Adapter,
  AdapterProfile,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  ExistsExpr,
  IncludeRef,
  InsertAst,
  JoinAst,
  LiteralExpr,
  LowererContext,
  OperationExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { codecDefinitions } from './codecs';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    returning: true,
  },
});

class PostgresAdapterImpl implements Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {
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

  lower(ast: QueryAst, context: LowererContext<PostgresContract>) {
    let sql: string;
    const params = context.params ? [...context.params] : [];

    if (ast.kind === 'select') {
      sql = renderSelect(ast);
    } else if (ast.kind === 'insert') {
      sql = renderInsert(ast);
    } else if (ast.kind === 'update') {
      sql = renderUpdate(ast);
    } else if (ast.kind === 'delete') {
      sql = renderDelete(ast);
    } else {
      throw new Error(`Unsupported AST kind: ${(ast as { kind: string }).kind}`);
    }

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
  const includesClause = ast.includes?.length
    ? ast.includes.map((include) => renderInclude(include)).join(' ')
    : '';

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where)}` : '';
  const orderClause = ast.orderBy?.length
    ? ` ORDER BY ${ast.orderBy
        .map((order) => {
          const expr =
            (order.expr as ColumnRef | OperationExpr).kind === 'operation'
              ? renderOperation(order.expr as unknown as OperationExpr)
              : renderColumn(order.expr as ColumnRef);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? ` LIMIT ${ast.limit}` : '';

  const clauses = [joinsClause, includesClause].filter(Boolean).join(' ');
  return `${selectClause} ${fromClause}${clauses ? ` ${clauses}` : ''}${whereClause}${orderClause}${limitClause}`.trim();
}

function renderProjection(ast: SelectAst): string {
  return ast.project
    .map((item) => {
      const expr = item.expr as ColumnRef | IncludeRef | OperationExpr;
      if (expr.kind === 'includeRef') {
        // For include references, select the column from the LATERAL join alias
        // The LATERAL subquery returns a single column (the JSON array) with the alias
        // The table is aliased as {alias}_lateral, and the column inside is aliased as the include alias
        // We select it using table_alias.column_alias
        const tableAlias = `${expr.alias}_lateral`;
        return `${quoteIdentifier(tableAlias)}.${quoteIdentifier(expr.alias)} AS ${quoteIdentifier(item.alias)}`;
      }
      if (expr.kind === 'operation') {
        const operation = renderOperation(expr);
        const alias = quoteIdentifier(item.alias);
        return `${operation} AS ${alias}`;
      }
      const column = renderColumn(expr as ColumnRef);
      const alias = quoteIdentifier(item.alias);
      return `${column} AS ${alias}`;
    })
    .join(', ');
}

function renderWhere(expr: BinaryExpr | ExistsExpr): string {
  if (expr.kind === 'exists') {
    const notKeyword = expr.not ? 'NOT ' : '';
    const subquery = renderSelect(expr.subquery);
    return `${notKeyword}EXISTS (${subquery})`;
  }
  return renderBinary(expr);
}

function renderBinary(expr: BinaryExpr): string {
  const left =
    (expr.left as ColumnRef | OperationExpr).kind === 'operation'
      ? renderOperation(expr.left as unknown as OperationExpr)
      : renderColumn(expr.left as ColumnRef);
  const right = renderParam(expr.right);
  return `(${left}) = ${right}`;
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderParam(ref: ParamRef): string {
  return `$${ref.index}`;
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${expr.value.replace(/'/g, "''")}'`;
  }
  if (typeof expr.value === 'number' || typeof expr.value === 'boolean') {
    return String(expr.value);
  }
  if (expr.value === null) {
    return 'NULL';
  }
  if (Array.isArray(expr.value)) {
    return `ARRAY[${expr.value.map((v: unknown) => renderLiteral({ kind: 'literal', value: v })).join(', ')}]`;
  }
  return JSON.stringify(expr.value);
}

function renderOperation(expr: OperationExpr): string {
  const self = renderColumn(expr.self);
  const args = expr.args.map((arg: ColumnRef | ParamRef | LiteralExpr) => {
    if (arg.kind === 'col') {
      return renderColumn(arg);
    }
    if (arg.kind === 'param') {
      return renderParam(arg);
    }
    if (arg.kind === 'literal') {
      return renderLiteral(arg);
    }
    const _exhaustive: never = arg;
    throw new Error(`Unsupported argument kind: ${(_exhaustive as { kind: string }).kind}`);
  });

  let result = expr.lowering.template;
  result = result.replace(/\$\{self\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$\\{arg${i}\\}`, 'g'), args[i] ?? '');
  }

  if (expr.lowering.strategy === 'function') {
    return result;
  }

  return result;
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
  const alias = include.alias;

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
    whereClause += ` AND ${renderWhere(include.child.where)}`;
  }

  // Add ORDER BY if present - it goes inside json_agg() call
  const childOrderBy = include.child.orderBy?.length
    ? ` ORDER BY ${include.child.orderBy
        .map(
          (order: { expr: ColumnRef; dir: string }) =>
            `${renderColumn(order.expr)} ${order.dir.toUpperCase()}`,
        )
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
    for (const item of include.child.project) {
      const columnKey = `${item.expr.table}.${item.expr.column}`;
      columnAliasMap.set(columnKey, item.alias);
    }

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
    subquery = `(SELECT json_agg(row_to_json(sub.*)) AS ${quoteIdentifier(alias)} FROM (${innerSelect}) sub)`;
  } else if (childOrderBy) {
    // With ORDER BY but no LIMIT, ORDER BY goes inside json_agg()
    subquery = `(SELECT json_agg(${jsonBuildObject}${childOrderBy}) AS ${quoteIdentifier(alias)} FROM ${childTable}${whereClause})`;
  } else {
    // No ORDER BY or LIMIT
    subquery = `(SELECT json_agg(${jsonBuildObject}) AS ${quoteIdentifier(alias)} FROM ${childTable}${whereClause})`;
  }

  // Return the LATERAL join with ON true (the condition is in the WHERE clause)
  // The subquery returns a single column (the JSON array) with the alias
  // We use a different alias for the table to avoid ambiguity when selecting the column
  const tableAlias = `${alias}_lateral`;
  return `LEFT JOIN LATERAL ${subquery} AS ${quoteIdentifier(tableAlias)} ON true`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function renderInsert(ast: InsertAst): string {
  const table = quoteIdentifier(ast.table.name);
  const columns = Object.keys(ast.values).map((col) => quoteIdentifier(col));
  const values = Object.values(ast.values).map((val) => {
    if (val.kind === 'param') {
      return `$${val.index}`;
    }
    if (val.kind === 'col') {
      return `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    }
    throw new Error(`Unsupported value kind in INSERT: ${(val as { kind: string }).kind}`);
  });

  const insertClause = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `${insertClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst): string {
  const table = quoteIdentifier(ast.table.name);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    if (val.kind === 'param') {
      value = `$${val.index}`;
    } else if (val.kind === 'col') {
      value = `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    } else {
      throw new Error(`Unsupported value kind in UPDATE: ${(val as { kind: string }).kind}`);
    }
    return `${column} = ${value}`;
  });

  const whereClause = ` WHERE ${renderBinary(ast.where)}`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ` WHERE ${renderBinary(ast.where)}`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
