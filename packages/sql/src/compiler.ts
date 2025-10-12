import { QueryAST, FieldExpression } from './types';

export function compileToSQL(query: QueryAST): { sql: string; params: any[] } {
  const params: any[] = [];
  let paramIndex = 1;

  let sql = 'SELECT ';

  // Handle SELECT clause
  if (query.select && query.select.fields) {
    const fieldList = Object.entries(query.select.fields)
      .map(([alias, field]) => `${field} AS ${alias}`)
      .join(', ');
    sql += fieldList;
  } else {
    sql += '*';
  }

  // Handle FROM clause
  sql += ` FROM ${query.from}`;

  // Handle WHERE clause
  if (query.where) {
    sql += ' WHERE ' + compileCondition(query.where.condition, params, paramIndex);
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

function compileCondition(condition: FieldExpression, params: any[], paramIndex: number): string {
  const field = condition.field;

  switch (condition.type) {
    case 'eq':
      params.push(condition.value);
      return `${field} = $${paramIndex}`;
    case 'ne':
      params.push(condition.value);
      return `${field} != $${paramIndex}`;
    case 'gt':
      params.push(condition.value);
      return `${field} > $${paramIndex}`;
    case 'lt':
      params.push(condition.value);
      return `${field} < $${paramIndex}`;
    case 'gte':
      params.push(condition.value);
      return `${field} >= $${paramIndex}`;
    case 'lte':
      params.push(condition.value);
      return `${field} <= $${paramIndex}`;
    case 'in':
      const placeholders = condition.values!.map((_, i) => `$${paramIndex + i}`).join(', ');
      params.push(...condition.values!);
      return `${field} IN (${placeholders})`;
    default:
      throw new Error(`Unknown condition type: ${(condition as any).type}`);
  }
}

function getParamCount(condition: FieldExpression): number {
  switch (condition.type) {
    case 'in':
      return condition.values!.length;
    default:
      return 1;
  }
}
