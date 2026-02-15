import type {
  Adapter,
  AdapterProfile,
  BinaryExpr,
  CodecParamsDescriptor,
  ColumnRef,
  DeleteAst,
  IncludeRef,
  InsertAst,
  JoinAst,
  JoinOnExpr,
  LiteralExpr,
  ListLiteralExpr,
  LowererContext,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  UpdateAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry, isOperationExpr } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from './codec-ids';
import { codecDefinitions } from './codecs';
import { escapeLiteral } from './sql-utils';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const VECTOR_CODEC_ID = 'pg/vector@1' as const;

function getCodecParamCast(codecId: string | undefined): string | undefined {
  if (codecId === VECTOR_CODEC_ID) {
    return 'vector';
  }
  if (codecId === PG_JSON_CODEC_ID) {
    return 'json';
  }
  if (codecId === PG_JSONB_CODEC_ID) {
    return 'jsonb';
  }
  return undefined;
}

function renderTypedParam(index: number, codecId: string | undefined): string {
  const cast = getCodecParamCast(codecId);
  return cast ? `$${index}::${cast}` : `$${index}`;
}

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
  },
  sql: {
    enums: true,
  },
});

type AdapterCodec = (typeof codecDefinitions)[keyof typeof codecDefinitions]['codec'];
type ParameterizedCodec = AdapterCodec & {
  readonly paramsSchema: NonNullable<AdapterCodec['paramsSchema']>;
};

const parameterizedCodecs: ReadonlyArray<CodecParamsDescriptor> = Object.values(codecDefinitions)
  .map((definition) => definition.codec)
  .filter((codec): codec is ParameterizedCodec => codec.paramsSchema !== undefined)
  .map((codec) =>
    Object.freeze({
      codecId: codec.id,
      paramsSchema: codec.paramsSchema,
      ...ifDefined('init', codec.init),
    }),
  );

class PostgresAdapterImpl implements Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {
  // These fields make the adapter instance structurally compatible with
  // RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

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

  parameterizedCodecs(): ReadonlyArray<CodecParamsDescriptor> {
    return parameterizedCodecs;
  }

  lower(ast: QueryAst, context: LowererContext<PostgresContract>) {
    let sql: string;
    const params = context.params ? [...context.params] : [];

    if (ast.kind === 'select') {
      sql = renderSelect(ast, context.contract);
    } else if (ast.kind === 'insert') {
      sql = renderInsert(ast, context.contract);
    } else if (ast.kind === 'update') {
      sql = renderUpdate(ast, context.contract);
    } else if (ast.kind === 'delete') {
      sql = renderDelete(ast, context.contract);
    } else {
      throw new Error(`Unsupported AST kind: ${(ast as { kind: string }).kind}`);
    }

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst, contract?: PostgresContract): string {
  const selectClause = `SELECT ${renderProjection(ast, contract)}`;
  const fromClause = `FROM ${quoteIdentifier(ast.from.name)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract)).join(' ')
    : '';
  const includesClause = ast.includes?.length
    ? ast.includes.map((include) => renderInclude(include, contract)).join(' ')
    : '';

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract)}` : '';
  const orderClause = ast.orderBy?.length
    ? ` ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr as ColumnRef | OperationExpr, contract);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? ` LIMIT ${ast.limit}` : '';

  const clauses = [joinsClause, includesClause].filter(Boolean).join(' ');
  return `${selectClause} ${fromClause}${clauses ? ` ${clauses}` : ''}${whereClause}${orderClause}${limitClause}`.trim();
}

function renderProjection(ast: SelectAst, contract?: PostgresContract): string {
  return ast.project
    .map((item) => {
      const expr = item.expr as ColumnRef | IncludeRef | OperationExpr | LiteralExpr;
      if (expr.kind === 'includeRef') {
        // For include references, select the column from the LATERAL join alias
        // The LATERAL subquery returns a single column (the JSON array) with the alias
        // The table is aliased as {alias}_lateral, and the column inside is aliased as the include alias
        // We select it using table_alias.column_alias
        const tableAlias = `${expr.alias}_lateral`;
        return `${quoteIdentifier(tableAlias)}.${quoteIdentifier(expr.alias)} AS ${quoteIdentifier(item.alias)}`;
      }
      if (expr.kind === 'operation') {
        const operation = renderOperation(expr, contract);
        const alias = quoteIdentifier(item.alias);
        return `${operation} AS ${alias}`;
      }
      if (expr.kind === 'literal') {
        const literal = renderLiteral(expr);
        const alias = quoteIdentifier(item.alias);
        return `${literal} AS ${alias}`;
      }
      const column = renderColumn(expr as ColumnRef);
      const alias = quoteIdentifier(item.alias);
      return `${column} AS ${alias}`;
    })
    .join(', ');
}

function renderWhere(expr: WhereExpr, contract?: PostgresContract): string {
  if (expr.kind === 'exists') {
    const notKeyword = expr.not ? 'NOT ' : '';
    const subquery = renderSelect(expr.subquery, contract);
    return `${notKeyword}EXISTS (${subquery})`;
  }
  if (expr.kind === 'nullCheck') {
    return renderNullCheck(expr, contract);
  }
  if (expr.kind === 'and') {
    if (expr.exprs.length === 0) {
      return 'TRUE';
    }
    return `(${expr.exprs.map((part) => renderWhere(part, contract)).join(' AND ')})`;
  }
  if (expr.kind === 'or') {
    if (expr.exprs.length === 0) {
      return 'FALSE';
    }
    return `(${expr.exprs.map((part) => renderWhere(part, contract)).join(' OR ')})`;
  }
  return renderBinary(expr, contract);
}

function renderNullCheck(expr: NullCheckExpr, contract?: PostgresContract): string {
  const rendered = renderExpr(expr.expr as ColumnRef | OperationExpr, contract);
  // Only wrap in parentheses if it's an operation expression
  const renderedExpr = isOperationExpr(expr.expr) ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, contract?: PostgresContract): string {
  const leftExpr = expr.left as ColumnRef | OperationExpr;
  const left = renderExpr(leftExpr, contract);
  const leftRendered = isOperationExpr(leftExpr) ? `(${left})` : left;
  const right = renderBinaryRight(expr.right, contract);
  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderBinaryRight(right: BinaryExpr['right'], contract?: PostgresContract): string {
  if (right.kind === 'col') {
    return renderColumn(right);
  }
  if (right.kind === 'param') {
    return renderParam(right, contract);
  }
  if (right.kind === 'literal') {
    return renderLiteral(right);
  }
  if (right.kind === 'operation') {
    return renderExpr(right, contract);
  }
  if (right.kind === 'listLiteral') {
    if (right.values.length === 0) {
      return '(NULL)';
    }
    const values = right.values.map((value) =>
      value.kind === 'param' ? renderParam(value, contract) : renderLiteral(value),
    );
    return `(${values.join(', ')})`;
  }

  throw new Error(`Unsupported binary right expression kind: ${(right as { kind: string }).kind}`);
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderExpr(expr: ColumnRef | OperationExpr, contract?: PostgresContract): string {
  if (isOperationExpr(expr)) {
    return renderOperation(expr, contract);
  }
  return renderColumn(expr);
}

function renderParam(
  ref: ParamRef,
  contract?: PostgresContract,
  tableName?: string,
  columnName?: string,
): string {
  if (contract && tableName && columnName) {
    const tableMeta = contract.storage.tables[tableName];
    const columnMeta = tableMeta?.columns[columnName];
    return renderTypedParam(ref.index, columnMeta?.codecId);
  }
  return `$${ref.index}`;
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${escapeLiteral(expr.value)}'`;
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

function renderOperation(expr: OperationExpr, contract?: PostgresContract): string {
  const self = renderExpr(expr.self, contract);
  // For vector operations, cast param arguments to vector type
  const isVectorOperation = expr.forTypeId === VECTOR_CODEC_ID;
  const args = expr.args.map((arg: ColumnRef | ParamRef | LiteralExpr | OperationExpr) => {
    if (arg.kind === 'col') {
      return renderColumn(arg);
    }
    if (arg.kind === 'param') {
      // Cast vector operation parameters to vector type
      return isVectorOperation ? `$${arg.index}::vector` : renderParam(arg, contract);
    }
    if (arg.kind === 'literal') {
      return renderLiteral(arg);
    }
    if (arg.kind === 'operation') {
      return renderOperation(arg, contract);
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

function renderJoin(join: JoinAst, contract?: PostgresContract): string {
  const joinType = join.joinType.toUpperCase();
  const table = quoteIdentifier(join.table.name);
  const onClause = renderJoinOn(join.on, contract);
  return `${joinType} JOIN ${table} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract?: PostgresContract): string {
  if (on.kind === 'eqCol') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, contract);
}

function renderInclude(
  include: NonNullable<SelectAst['includes']>[number],
  contract?: PostgresContract,
): string {
  const alias = include.alias;

  // Build the lateral subquery
  const childProjection = include.child.project
    .map((item: { alias: string; expr: ColumnRef | OperationExpr }) => {
      const expr = renderExpr(item.expr, contract);
      return `'${item.alias}', ${expr}`;
    })
    .join(', ');

  const jsonBuildObject = `json_build_object(${childProjection})`;

  // Build the ON condition from the include's ON clause - this goes in the WHERE clause
  const onCondition = renderJoinOn(include.child.on, contract);

  // Build WHERE clause: combine ON condition with any additional WHERE clauses
  let whereClause = ` WHERE ${onCondition}`;
  if (include.child.where) {
    whereClause += ` AND ${renderWhere(include.child.where, contract)}`;
  }

  // Add ORDER BY if present - it goes inside json_agg() call
  const childOrderBy = include.child.orderBy?.length
    ? ` ORDER BY ${include.child.orderBy
        .map(
          (order: { expr: ColumnRef | OperationExpr; dir: string }) =>
            `${renderExpr(order.expr, contract)} ${order.dir.toUpperCase()}`,
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
    // Only ColumnRef can be mapped (OperationExpr doesn't have table/column properties)
    const columnAliasMap = new Map<string, string>();
    for (const item of include.child.project) {
      if (item.expr.kind === 'col') {
        const columnKey = `${item.expr.table}.${item.expr.column}`;
        columnAliasMap.set(columnKey, item.alias);
      }
    }

    const innerColumns = include.child.project
      .map((item: { alias: string; expr: ColumnRef | OperationExpr }) => {
        const expr = renderExpr(item.expr, contract);
        return `${expr} AS ${quoteIdentifier(item.alias)}`;
      })
      .join(', ');

    // For ORDER BY, use column aliases if the column is in the SELECT list
    const childOrderByWithAliases = include.child.orderBy?.length
      ? ` ORDER BY ${include.child.orderBy
          .map((order: { expr: ColumnRef | OperationExpr; dir: string }) => {
            if (order.expr.kind === 'col') {
              const columnKey = `${order.expr.table}.${order.expr.column}`;
              const alias = columnAliasMap.get(columnKey);
              if (alias) {
                return `${quoteIdentifier(alias)} ${order.dir.toUpperCase()}`;
              }
            }
            return `${renderExpr(order.expr, contract)} ${order.dir.toUpperCase()}`;
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

function renderInsert(ast: InsertAst, contract: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const columns = Object.keys(ast.values).map((col) => quoteIdentifier(col));
  const tableMeta = contract.storage.tables[ast.table.name];
  const values = Object.entries(ast.values).map(([colName, val]) => {
    if (val.kind === 'param') {
      const columnMeta = tableMeta?.columns[colName];
      return renderTypedParam(val.index, columnMeta?.codecId);
    }
    if (val.kind === 'col') {
      return `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    }
    throw new Error(`Unsupported value kind in INSERT: ${(val as { kind: string }).kind}`);
  });

  const insertClause =
    columns.length === 0
      ? `INSERT INTO ${table} DEFAULT VALUES`
      : `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `${insertClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const tableMeta = contract.storage.tables[ast.table.name];
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    if (val.kind === 'param') {
      const columnMeta = tableMeta?.columns[col];
      value = renderTypedParam(val.index, columnMeta?.codecId);
    } else if (val.kind === 'col') {
      value = `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    } else {
      throw new Error(`Unsupported value kind in UPDATE: ${(val as { kind: string }).kind}`);
    }
    return `${column} = ${value}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract?: PostgresContract): string {
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning.map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`).join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
