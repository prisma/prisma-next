import { QueryAST, Column, FieldExpression, InferSelectResult, InferTableShape, Table } from './types';
import { compileToSQL } from './compiler';

export class QueryBuilder<TTable extends Table<any>> {
  private ast: QueryAST;

  constructor(from: string) {
    this.ast = {
      type: 'select',
      from,
    };
  }

  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect
  ): QueryBuilder<TTable> & { build(): { sql: string; params: unknown[]; rowType: InferSelectResult<TSelect> } } {
    this.ast.select = { type: 'select', fields };
    return this as any;
  }

  where(condition: FieldExpression): QueryBuilder<TTable> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<TTable> {
    if (!this.ast.orderBy) {
      this.ast.orderBy = [];
    }
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): QueryBuilder<TTable> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  build(): { sql: string; params: unknown[]; rowType: InferSelectResult<any> } {
    const { sql, params } = compileToSQL(this.ast);
    return { sql, params, rowType: {} as any };
  }
}

export interface FromBuilder<TTable extends Table<any>> {
  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect
  ): QueryBuilder<TTable> & { build(): { sql: string; params: unknown[]; rowType: InferSelectResult<TSelect> } };
  where(condition: FieldExpression): FromBuilder<TTable>;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): FromBuilder<TTable>;
  limit(count: number): FromBuilder<TTable>;
}

export function createFromBuilder<TTable extends Table<any>>(tableName: string): FromBuilder<TTable> {
  const builder = new QueryBuilder<TTable>(tableName);

  return {
    select: builder.select.bind(builder),
    where: builder.where.bind(builder),
    orderBy: builder.orderBy.bind(builder),
    limit: builder.limit.bind(builder),
  };
}
