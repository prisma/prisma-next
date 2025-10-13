import {
  QueryAST,
  Column,
  FieldExpression,
  ProjectionItem,
  Expr,
  SelectClause,
  RawQueryAST,
  ExprRaw,
  Dialect,
  TemplatePiece,
} from './types';

export function compileToSQL(query: QueryAST | RawQueryAST): { sql: string; params: any[] } {
  if (query.type === 'raw') {
    return compileRaw(query);
  }

  return compileSelect(query);
}

function compileSelect(query: QueryAST): { sql: string; params: any[] } {
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
    'users',
    'post',
    'posts',
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
    'public',
    'tenant',
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

    case 'raw':
      return compileExprRaw(expr, params, paramIndex);

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

    case 'raw':
      return getRawParamCount(expr.template);

    default:
      return 0;
  }
}

// Raw SQL compilation functions
function compileRaw(ast: RawQueryAST): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  for (const piece of ast.template) {
    switch (piece.kind) {
      case 'text':
        parts.push(piece.value);
        break;
      case 'ident':
        parts.push(quoteIdentifier(piece.name));
        break;
      case 'table':
        parts.push(quoteIdentifier(piece.name));
        break;
      case 'column':
        const tablePrefix = piece.table ? `${quoteIdentifier(piece.table)}.` : '';
        parts.push(`${tablePrefix}${quoteIdentifier(piece.name)}`);
        break;
      case 'qualified':
        parts.push(piece.parts.map((part) => quoteIdentifier(part)).join('.'));
        break;
      case 'value':
        parts.push(renderPlaceholder(paramIndex, ast.dialect || 'postgres'));
        params.push(piece.v);
        paramIndex++;
        break;
      case 'rawUnsafe':
        parts.push(piece.sql);
        break;
      default:
        throw new Error(`Unknown raw piece: ${(piece as any).kind}`);
    }
  }

  const sql = parts.join('');

  return { sql, params };
}

function compileExprRaw(expr: ExprRaw, params: any[], paramIndex: number): string {
  const parts: string[] = [];
  let currentParamIndex = paramIndex;

  for (const piece of expr.template) {
    switch (piece.kind) {
      case 'text':
        parts.push(piece.value);
        break;
      case 'ident':
        parts.push(quoteIdentifier(piece.name));
        break;
      case 'table':
        parts.push(quoteIdentifier(piece.name));
        break;
      case 'column':
        const tablePrefix = piece.table ? `${quoteIdentifier(piece.table)}.` : '';
        parts.push(`${tablePrefix}${quoteIdentifier(piece.name)}`);
        break;
      case 'qualified':
        parts.push(piece.parts.map((part) => quoteIdentifier(part)).join('.'));
        break;
      case 'value':
        parts.push(renderPlaceholder(currentParamIndex, expr.dialect || 'postgres'));
        params.push(piece.v);
        currentParamIndex++;
        break;
      case 'rawUnsafe':
        parts.push(piece.sql);
        break;
      default:
        throw new Error(`Unknown raw piece: ${(piece as any).kind}`);
    }
  }

  return parts.join('');
}

function renderPlaceholder(paramIndex: number, dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return `$${paramIndex}`;
    case 'mysql':
    case 'sqlite':
      return '?';
    case '*':
      return `$${paramIndex}`; // Default to postgres style
    default:
      return `$${paramIndex}`;
  }
}

function getRawParamCount(template: TemplatePiece[]): number {
  return template.filter((piece) => piece.kind === 'value').length;
}
