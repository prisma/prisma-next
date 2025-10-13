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
          const result = compileExpr(item.expr, params, paramIndex);
          paramIndex = result.paramIndex;
          return `${result.sql} AS ${quoteIdentifier(item.alias)}`;
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
          const result = compileExpr(join.on, params, paramIndex);
          paramIndex = result.paramIndex;
          sql += ` ON ${result.sql}`;
        }
      } else if (join.type === 'join') {
        sql += ` JOIN ${quoteIdentifier(join.table)}`;
        if (join.alias) sql += ` ${quoteIdentifier(join.alias)}`;
        if (join.on) {
          const result = compileExpr(join.on, params, paramIndex);
          paramIndex = result.paramIndex;
          sql += ` ON ${result.sql}`;
        }
      }
    }
  }

  // Handle WHERE clause
  if (query.where) {
    const result = compileExpr(query.where.condition, params, paramIndex);
    paramIndex = result.paramIndex;
    sql += ' WHERE ' + result.sql;
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
    paramIndex++;
  }

  return { sql, params };
}

function isColumn(obj: any): obj is Column<any, any, any> {
  return obj && typeof obj === 'object' && 'table' in obj && 'name' in obj;
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
function compileExpr(
  expr: Expr,
  params: any[],
  paramIndex: number,
): { sql: string; paramIndex: number } {
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    console.error('Invalid expression:', expr);
    throw new Error(`Invalid expression: ${JSON.stringify(expr)}`);
  }

  switch (expr.kind) {
    case 'column':
      const tablePrefix = expr.table ? `${quoteIdentifier(expr.table)}.` : '';
      return { sql: `${tablePrefix}${quoteIdentifier(expr.name)}`, paramIndex };

    case 'call':
      let callParamIndex = paramIndex;
      const args = expr.args
        .map((arg) => {
          const result = compileExpr(arg, params, callParamIndex);
          callParamIndex = result.paramIndex;
          return result.sql;
        })
        .join(', ');
      return { sql: `${expr.fn}(${args})`, paramIndex: callParamIndex };

    case 'literal':
      params.push(expr.value);
      return { sql: `$${paramIndex}`, paramIndex: paramIndex + 1 };

    case 'subquery':
      const { sql: subSql, params: subParams } = compileToSQL(expr.query);
      // Renumber subquery parameters to continue from current paramIndex
      const renumberedSubSql = subSql.replace(/\$(\d+)/g, (match, num) => {
        const newIndex = paramIndex + parseInt(num) - 1;
        return `$${newIndex}`;
      });
      params.push(...subParams);
      return { sql: `(${renumberedSubSql})`, paramIndex: paramIndex + subParams.length };

    case 'jsonObject':
      let jsonParamIndex = paramIndex;
      const fields = Object.entries(expr.fields)
        .map(([key, value]) => {
          const result = compileExpr(value, params, jsonParamIndex);
          jsonParamIndex = result.paramIndex;
          return `'${key}', ${result.sql}`;
        })
        .join(', ');
      return { sql: `json_build_object(${fields})`, paramIndex: jsonParamIndex };

    case 'raw':
      return compileExprRaw(expr, params, paramIndex);

    case 'eq':
      const eqLeft = compileExpr(expr.left, params, paramIndex);
      const eqRight = compileExpr(expr.right, params, eqLeft.paramIndex);
      return { sql: `${eqLeft.sql} = ${eqRight.sql}`, paramIndex: eqRight.paramIndex };
    case 'ne':
      const neLeft = compileExpr(expr.left, params, paramIndex);
      const neRight = compileExpr(expr.right, params, neLeft.paramIndex);
      return { sql: `${neLeft.sql} != ${neRight.sql}`, paramIndex: neRight.paramIndex };
    case 'gt':
      const gtLeft = compileExpr(expr.left, params, paramIndex);
      const gtRight = compileExpr(expr.right, params, gtLeft.paramIndex);
      return { sql: `${gtLeft.sql} > ${gtRight.sql}`, paramIndex: gtRight.paramIndex };
    case 'lt':
      const ltLeft = compileExpr(expr.left, params, paramIndex);
      const ltRight = compileExpr(expr.right, params, ltLeft.paramIndex);
      return { sql: `${ltLeft.sql} < ${ltRight.sql}`, paramIndex: ltRight.paramIndex };
    case 'gte':
      const gteLeft = compileExpr(expr.left, params, paramIndex);
      const gteRight = compileExpr(expr.right, params, gteLeft.paramIndex);
      return { sql: `${gteLeft.sql} >= ${gteRight.sql}`, paramIndex: gteRight.paramIndex };
    case 'lte':
      const lteLeft = compileExpr(expr.left, params, paramIndex);
      const lteRight = compileExpr(expr.right, params, lteLeft.paramIndex);
      return { sql: `${lteLeft.sql} <= ${lteRight.sql}`, paramIndex: lteRight.paramIndex };
    case 'in':
      const inLeft = compileExpr(expr.left, params, paramIndex);
      let inParamIndex = inLeft.paramIndex;
      const rightSql = expr.right
        .map((e) => {
          const result = compileExpr(e, params, inParamIndex);
          inParamIndex = result.paramIndex;
          return result.sql;
        })
        .join(', ');
      return { sql: `${inLeft.sql} IN (${rightSql})`, paramIndex: inParamIndex };
    case 'and':
      const andLeft = compileExpr(expr.left, params, paramIndex);
      const andRight = compileExpr(expr.right, params, andLeft.paramIndex);
      return { sql: `(${andLeft.sql} AND ${andRight.sql})`, paramIndex: andRight.paramIndex };
    case 'or':
      const orLeft = compileExpr(expr.left, params, paramIndex);
      const orRight = compileExpr(expr.right, params, orLeft.paramIndex);
      return { sql: `(${orLeft.sql} OR ${orRight.sql})`, paramIndex: orRight.paramIndex };

    default:
      throw new Error(`Unknown expression kind: ${(expr as any).kind}`);
  }
}

function getExprParamCount(expr: Expr): number {
  switch (expr.kind) {
    case 'column':
      return 0;

    case 'literal':
      return 1;

    case 'call':
      return expr.args.reduce((sum, arg) => sum + getExprParamCount(arg), 0);

    case 'subquery':
      // Subquery params are handled separately
      return 0;

    case 'jsonObject':
      return Object.values(expr.fields).reduce((sum, field) => sum + getExprParamCount(field), 0);

    case 'raw':
      return getRawParamCount(expr.template);

    case 'eq':
    case 'ne':
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
    case 'and':
    case 'or':
      return getExprParamCount(expr.left) + getExprParamCount(expr.right);

    case 'in':
      return (
        getExprParamCount(expr.left) + expr.right.reduce((sum, e) => sum + getExprParamCount(e), 0)
      );

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

function compileExprRaw(
  expr: ExprRaw,
  params: any[],
  paramIndex: number,
): { sql: string; paramIndex: number } {
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

  return { sql: parts.join(''), paramIndex: currentParamIndex };
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
