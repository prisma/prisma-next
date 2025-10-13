import { QueryAST, Column, FieldExpression, ProjectionItem, Expr, SelectClause } from './types';

export function compileToSQL(query: QueryAST): { sql: string; params: any[] } {
  const params: any[] = [];
  let paramIndex = 1;

  let sql = 'SELECT ';

  // Handle SELECT clause - support both old and new formats
  if (query.select) {
    if (Array.isArray(query.select)) {
      // New ProjectionItem[] format
      const fieldList = query.select
        .map((item) => {
          const expr = compileExpr(item.expr, params, paramIndex);
          paramIndex += getExprParamCount(item.expr);
          return `${expr} AS ${quoteIdentifier(item.alias)}`;
        })
        .join(', ');
      sql += fieldList;
    } else if (query.select.fields && Object.keys(query.select.fields).length > 0) {
      // Old SelectClause format
      const fieldList = Object.entries(query.select.fields)
        .map(([alias, column]) => {
          if (isColumn(column)) {
            const quotedName = quoteIdentifier(column.name);
            const quotedAlias = quoteIdentifier(alias);
            return `${quotedName} AS ${quotedAlias}`;
          }
          return `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`;
        })
        .join(', ');
      sql += fieldList;
    } else {
      sql += '*';
    }
  } else {
    sql += '*';
  }

  // Handle FROM clause
  sql += ` FROM ${quoteIdentifier(query.from)}`;

  // Handle JOINs
  if (query.joins) {
    for (const join of query.joins) {
      if (join.type === 'leftJoin') {
        sql += ` LEFT JOIN ${quoteIdentifier(join.table)}`;
        if (join.alias) sql += ` ${quoteIdentifier(join.alias)}`;
        if (join.on) {
          if (join.on.type === 'literal') {
            sql += ` ON ${join.on.value}`;
          } else {
            sql += ` ON ${compileExpression(join.on, params, paramIndex)}`;
            paramIndex += getParamCount(join.on);
          }
        }
      } else if (join.type === 'join') {
        sql += ` JOIN ${quoteIdentifier(join.table)}`;
        if (join.alias) sql += ` ${quoteIdentifier(join.alias)}`;
        if (join.on) {
          if (join.on.type === 'literal') {
            sql += ` ON ${join.on.value}`;
          } else {
            sql += ` ON ${compileExpression(join.on, params, paramIndex)}`;
            paramIndex += getParamCount(join.on);
          }
        }
      }
    }
  }

  // Handle WHERE clause
  if (query.where) {
    sql += ' WHERE ' + compileExpression(query.where.condition, params, paramIndex);
    paramIndex += getParamCount(query.where.condition);
  }

  // Handle ORDER BY clause
  if (query.orderBy && query.orderBy.length > 0) {
    const orderByClause = query.orderBy
      .map((order) => `${quoteIdentifier(order.field)} ${order.direction}`)
      .join(', ');
    sql += ` ORDER BY ${orderByClause}`;
  }

  // Handle LIMIT clause
  if (query.limit) {
    params.push(query.limit.count);
    sql += ` LIMIT $${paramIndex}`;
  }

  return { sql, params };
}

function compileExpression(expr: FieldExpression, params: any[], paramIndex: number): string {
  // Handle Column expressions (from t.user.id.eq(value))
  if (isColumnExpression(expr)) {
    return compileColumnExpression(expr, params, paramIndex);
  }

  // Handle legacy FieldExpression
  if (isFieldExpression(expr)) {
    return compileFieldExpression(expr, params, paramIndex);
  }

  throw new Error(`Unknown expression type: ${JSON.stringify(expr)}`);
}

function compileColumnExpression(expr: any, params: any[], paramIndex: number): string {
  const field = quoteIdentifier(expr.field);

  switch (expr.type) {
    case 'eq':
      params.push(expr.value);
      return `${field} = $${paramIndex}`;
    case 'ne':
      params.push(expr.value);
      return `${field} != $${paramIndex}`;
    case 'gt':
      params.push(expr.value);
      return `${field} > $${paramIndex}`;
    case 'lt':
      params.push(expr.value);
      return `${field} < $${paramIndex}`;
    case 'gte':
      params.push(expr.value);
      return `${field} >= $${paramIndex}`;
    case 'lte':
      params.push(expr.value);
      return `${field} <= $${paramIndex}`;
    case 'in':
      const placeholders = expr.values!.map((_: any, i: number) => `$${paramIndex + i}`).join(', ');
      params.push(...expr.values!);
      return `${field} IN (${placeholders})`;
    default:
      throw new Error(`Unknown condition type: ${expr.type}`);
  }
}

function compileFieldExpression(expr: any, params: any[], paramIndex: number): string {
  const field = quoteIdentifier(expr.field);

  switch (expr.type) {
    case 'eq':
      params.push(expr.value);
      return `${field} = $${paramIndex}`;
    case 'ne':
      params.push(expr.value);
      return `${field} != $${paramIndex}`;
    case 'gt':
      params.push(expr.value);
      return `${field} > $${paramIndex}`;
    case 'lt':
      params.push(expr.value);
      return `${field} < $${paramIndex}`;
    case 'gte':
      params.push(expr.value);
      return `${field} >= $${paramIndex}`;
    case 'lte':
      params.push(expr.value);
      return `${field} <= $${paramIndex}`;
    case 'in':
      const placeholders = expr.values!.map((_: any, i: number) => `$${paramIndex + i}`).join(', ');
      params.push(...expr.values!);
      return `${field} IN (${placeholders})`;
    default:
      throw new Error(`Unknown condition type: ${expr.type}`);
  }
}

function getParamCount(expr: FieldExpression): number {
  if (isFieldExpression(expr)) {
    switch ((expr as any).type) {
      case 'in':
        return (expr as any).values!.length;
      default:
        return 1;
    }
  }

  if (isColumnExpression(expr)) {
    switch ((expr as any).type) {
      case 'in':
        return (expr as any).values!.length;
      default:
        return 1;
    }
  }

  return 1;
}

function isColumn(obj: any): obj is Column<any> {
  return obj && typeof obj === 'object' && 'table' in obj && 'name' in obj;
}

function isColumnExpression(obj: any): boolean {
  return obj && typeof obj === 'object' && 'type' in obj && 'field' in obj && 'value' in obj;
}

function isFieldExpression(obj: any): boolean {
  return obj && typeof obj === 'object' && 'type' in obj && 'field' in obj;
}

function quoteIdentifier(identifier: string): string {
  // PostgreSQL reserved words that should always be quoted
  const reservedWords = new Set([
    'id',
    'email',
    'active',
    'createdAt',
    'user',
    'post',
    'title',
    'published',
    'userId',
    'order',
    'group',
    'select',
    'from',
    'where',
    'having',
    'limit',
    'offset',
    'table',
    'column',
    'index',
    'constraint',
    'primary',
    'foreign',
    'key',
    'unique',
    'check',
    'default',
    'null',
    'not',
    'and',
    'or',
    'in',
    'exists',
    'between',
    'like',
    'ilike',
    'similar',
    'to',
    'is',
    'as',
    'asc',
    'desc',
    'case',
    'when',
    'then',
    'else',
    'end',
    'cast',
    'extract',
    'current_date',
    'current_time',
    'current_timestamp',
    'now',
    'true',
    'false',
    'unknown',
  ]);

  // Quote identifiers that contain mixed case, special characters, or are reserved words
  if (
    identifier !== identifier.toLowerCase() ||
    /[^a-zA-Z0-9_]/.test(identifier) ||
    reservedWords.has(identifier.toLowerCase())
  ) {
    return `"${identifier}"`;
  }
  return identifier;
}

// New expression compilation functions
function compileExpr(expr: Expr, params: any[], paramIndex: number): string {
  switch (expr.kind) {
    case 'column':
      const tablePrefix = expr.table ? `${quoteIdentifier(expr.table)}.` : '';
      return `${tablePrefix}${quoteIdentifier(expr.name)}`;

    case 'call':
      const args = expr.args.map((arg) => compileExpr(arg, params, paramIndex)).join(', ');
      return `${expr.fn}(${args})`;

    case 'literal':
      if (expr.value === null) return 'NULL';
      if (typeof expr.value === 'string') return `'${expr.value.replace(/'/g, "''")}'`;
      return String(expr.value);

    case 'subquery':
      const { sql: subSql, params: subParams } = compileToSQL(expr.query);
      params.push(...subParams);
      return `(${subSql})`;

    case 'jsonObject':
      const fields = Object.entries(expr.fields)
        .map(([key, value]) => `'${key}', ${compileExpr(value, params, paramIndex)}`)
        .join(', ');
      return `json_build_object(${fields})`;

    default:
      throw new Error(`Unknown expression kind: ${(expr as any).kind}`);
  }
}

function getExprParamCount(expr: Expr): number {
  switch (expr.kind) {
    case 'column':
    case 'literal':
      return 0;

    case 'call':
      return expr.args.reduce((sum, arg) => sum + getExprParamCount(arg), 0);

    case 'subquery':
      // Subquery params are handled separately
      return 0;

    case 'jsonObject':
      return Object.values(expr.fields).reduce((sum, field) => sum + getExprParamCount(field), 0);

    default:
      return 0;
  }
}
