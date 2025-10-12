import { QueryAST, Column, Expression } from './types';

export function compileToSQL(query: QueryAST): { sql: string; params: any[] } {
  const params: any[] = [];
  let paramIndex = 1;

  let sql = 'SELECT ';

  // Handle SELECT clause
  if (query.select && query.select.fields) {
    const fieldList = Object.entries(query.select.fields)
      .map(([alias, column]) => {
        if (isColumn(column)) {
          return `${column.name} AS ${alias}`;
        }
        return `${column} AS ${alias}`;
      })
      .join(', ');
    sql += fieldList;
  } else {
    sql += '*';
  }

  // Handle FROM clause
  sql += ` FROM ${query.from}`;

  // Handle WHERE clause
  if (query.where) {
    sql += ' WHERE ' + compileExpression(query.where.condition, params, paramIndex);
    paramIndex += getParamCount(query.where.condition);
  }

  // Handle ORDER BY clause
  if (query.orderBy && query.orderBy.length > 0) {
    const orderByClause = query.orderBy
      .map((order) => `${order.field} ${order.direction}`)
      .join(', ');
    sql += ` ORDER BY ${orderByClause}`;
  }

  // Handle LIMIT clause
  if (query.limit) {
    sql += ` LIMIT ${query.limit.count}`;
  }

  return { sql, params };
}

function compileExpression(expr: Expression<any>, params: any[], paramIndex: number): string {
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
  const field = expr.field;

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
  const field = expr.field;

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

function getParamCount(expr: Expression<any>): number {
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
