import type {
  Adapter,
  AdapterProfile,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  IncludeAst,
  IncludeRef,
  InsertAst,
  JoinAst,
  LiteralExpr,
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
import { codecDefinitions } from './codecs';
import type { SqliteAdapterOptions, SqliteContract, SqliteLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  sqlite: {
    orderBy: true,
    limit: true,
    // Used today to gate includeMany(). SQLite implements includeMany via correlated subqueries.
    lateral: true,
    jsonAgg: true,
    returning: true,
    json1: true,
  },
  sql: {
    enums: false,
  },
});

class SqliteAdapterImpl implements Adapter<QueryAst, SqliteContract, SqliteLoweredStatement> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  readonly profile: AdapterProfile<'sqlite'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();

  constructor(options?: SqliteAdapterOptions) {
    this.profile = Object.freeze({
      id: options?.profileId ?? 'sqlite/default@1',
      target: 'sqlite',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
    });
  }

  lower(ast: QueryAst, context: LowererContext<SqliteContract>) {
    let sql: string;
    const params = context.params ? [...context.params] : [];

    if (ast.kind === 'select') {
      sql = renderSelect(ast, context.contract);
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

  /**
   * Adapter-owned marker reader statement (ADR 021).
   *
   * The SQL family runtime should prefer this over hardcoded Postgres marker SQL.
   */
  markerReaderStatement(): { readonly sql: string; readonly params: readonly unknown[] } {
    return {
      sql: `select
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta
      from prisma_contract_marker
      where id = ?1`,
      params: [1],
    };
  }
}

function renderSelect(ast: SelectAst, contract?: SqliteContract): string {
  const selectClause = `SELECT ${renderProjection(ast, contract)}`;
  const fromClause = `FROM ${quoteIdentifier(ast.from.name)}`;

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract)).join(' ')
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

  const clauses = [joinsClause].filter(Boolean).join(' ');
  return `${selectClause} ${fromClause}${clauses ? ` ${clauses}` : ''}${whereClause}${orderClause}${limitClause}`.trim();
}

function renderProjection(ast: SelectAst, contract?: SqliteContract): string {
  const includesByAlias = new Map<string, IncludeAst>();
  for (const include of ast.includes ?? []) {
    includesByAlias.set(include.alias, include);
  }

  return ast.project
    .map((item) => {
      const expr = item.expr as ColumnRef | IncludeRef | OperationExpr | LiteralExpr;

      if (expr.kind === 'includeRef') {
        const include = includesByAlias.get(expr.alias);
        if (!include) {
          throw new Error(`Missing include definition for alias '${expr.alias}'`);
        }

        const includeExpr = renderIncludeProjection(include, contract);
        return `${includeExpr} AS ${quoteIdentifier(item.alias)}`;
      }

      if (expr.kind === 'operation') {
        const operation = renderOperation(expr, contract);
        return `${operation} AS ${quoteIdentifier(item.alias)}`;
      }

      if (expr.kind === 'literal') {
        const literal = renderLiteral(expr);
        return `${literal} AS ${quoteIdentifier(item.alias)}`;
      }

      const column = renderColumn(expr as ColumnRef);
      return `${column} AS ${quoteIdentifier(item.alias)}`;
    })
    .join(', ');
}

function renderIncludeProjection(include: IncludeAst, contract?: SqliteContract): string {
  const child = include.child;
  const childTable = quoteIdentifier(child.table.name);

  // Build WHERE: ON predicate + optional child where
  const onCondition = renderJoinOn(child.on);
  let whereClause = ` WHERE ${onCondition}`;
  if (child.where) {
    whereClause += ` AND ${renderWhere(child.where, contract)}`;
  }

  const innerColumns = child.project
    .map(
      (item) =>
        `${renderExpr(item.expr as ColumnRef | OperationExpr, contract)} AS ${quoteIdentifier(item.alias)}`,
    )
    .join(', ');

  const innerOrderBy = child.orderBy?.length
    ? ` ORDER BY ${child.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr as ColumnRef | OperationExpr, contract);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';

  const innerLimit = typeof child.limit === 'number' ? ` LIMIT ${child.limit}` : '';

  const innerSelect = `SELECT ${innerColumns} FROM ${childTable}${whereClause}${innerOrderBy}${innerLimit}`;

  const jsonObjectArgs = child.project
    .map((item) => `'${item.alias}', sub.${quoteIdentifier(item.alias)}`)
    .join(', ');

  // Always wrap to make ORDER BY/LIMIT deterministic for aggregation.
  const aggregate = `SELECT json_group_array(json_object(${jsonObjectArgs})) FROM (${innerSelect}) sub`;

  // Ensure decodeRow() sees a JSON array even when there are no children.
  return `coalesce((${aggregate}), '[]')`;
}

function renderWhere(expr: WhereExpr, contract?: SqliteContract): string {
  if (expr.kind === 'exists') {
    const notKeyword = expr.not ? 'NOT ' : '';
    const subquery = renderSelect(expr.subquery, contract);
    return `${notKeyword}EXISTS (${subquery})`;
  }
  if (expr.kind === 'nullCheck') {
    return renderNullCheck(expr, contract);
  }
  return renderBinary(expr, contract);
}

function renderNullCheck(expr: NullCheckExpr, contract?: SqliteContract): string {
  const rendered = renderExpr(expr.expr as ColumnRef | OperationExpr, contract);
  const renderedExpr = isOperationExpr(expr.expr) ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, contract?: SqliteContract): string {
  const leftExpr = expr.left as ColumnRef | OperationExpr;
  const left = renderExpr(leftExpr, contract);
  const rightExpr = expr.right as ParamRef | ColumnRef;
  const right =
    rightExpr.kind === 'col' ? renderColumn(rightExpr) : renderParam(rightExpr as ParamRef);
  const leftRendered = isOperationExpr(leftExpr) ? `(${left})` : left;

  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderExpr(expr: ColumnRef | OperationExpr, contract?: SqliteContract): string {
  if (isOperationExpr(expr)) {
    return renderOperation(expr, contract);
  }
  return renderColumn(expr);
}

function renderParam(ref: ParamRef): string {
  // Use numeric placeholders for stable ordering: ?1, ?2, ...
  return `?${ref.index}`;
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
    // SQLite doesn't have ARRAY literal; fall back to JSON.
    return `'${JSON.stringify(expr.value).replace(/'/g, "''")}'`;
  }
  return `'${JSON.stringify(expr.value).replace(/'/g, "''")}'`;
}

function renderOperation(expr: OperationExpr, contract?: SqliteContract): string {
  void contract;
  const self = renderExpr(expr.self as ColumnRef | OperationExpr, contract);
  const args = expr.args.map((arg) => {
    if (arg.kind === 'col') {
      return renderColumn(arg);
    }
    if (arg.kind === 'param') {
      return renderParam(arg);
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
  // Support both runtime `${self}` templates and manifest-safe `{{self}}` templates.
  result = result.replace(/\$\{self\}|\{\{self\}\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$\\{arg${i}\\}|\\{\\{arg${i}\\}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderJoin(join: JoinAst, contract?: SqliteContract): string {
  void contract;
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

function renderInsert(ast: InsertAst): string {
  const table = quoteIdentifier(ast.table.name);
  const columns = Object.keys(ast.values).map((col) => quoteIdentifier(col));
  const values = Object.values(ast.values).map((val) => {
    if (val.kind === 'param') {
      return renderParam(val);
    }
    if (val.kind === 'col') {
      return `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    }
    throw new Error(`Unsupported value kind in INSERT: ${(val as { kind: string }).kind}`);
  });

  const insertClause = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning
        .map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`)
        .join(', ')}`
    : '';

  return `${insertClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst): string {
  const table = quoteIdentifier(ast.table.name);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    const column = quoteIdentifier(col);
    let value: string;
    if (val.kind === 'param') {
      value = renderParam(val);
    } else if (val.kind === 'col') {
      value = `${quoteIdentifier(val.table)}.${quoteIdentifier(val.column)}`;
    } else {
      throw new Error(`Unsupported value kind in UPDATE: ${(val as { kind: string }).kind}`);
    }
    return `${column} = ${value}`;
  });

  const whereClause = ` WHERE ${renderWhere(ast.where, undefined)}`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning
        .map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`)
        .join(', ')}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract?: SqliteContract): string {
  void contract;
  const table = quoteIdentifier(ast.table.name);
  const whereClause = ` WHERE ${renderWhere(ast.where, contract)}`;
  const returningClause = ast.returning?.length
    ? ` RETURNING ${ast.returning
        .map((col) => `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`)
        .join(', ')}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function createSqliteAdapter(options?: SqliteAdapterOptions) {
  return Object.freeze(new SqliteAdapterImpl(options));
}
