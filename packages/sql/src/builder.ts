import { QueryAST, FieldExpression, SelectClause, WhereClause, OrderByClause, LimitClause } from './types';

export class QueryBuilder {
  private ast: QueryAST;

  constructor(from: string) {
    this.ast = {
      type: 'select',
      from,
    };
  }

  select(fields: Record<string, string>): QueryBuilder {
    this.ast.select = { type: 'select', fields };
    return this;
  }

  where(condition: FieldExpression): QueryBuilder {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    if (!this.ast.orderBy) {
      this.ast.orderBy = [];
    }
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): QueryBuilder {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  build(): QueryAST {
    return this.ast;
  }
}
