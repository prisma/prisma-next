export interface FieldExpression {
  type: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in';
  field: string;
  value?: any;
  values?: any[];
}

export interface SelectClause {
  type: 'select';
  fields: Record<string, string>;
}

export interface WhereClause {
  type: 'where';
  condition: FieldExpression;
}

export interface OrderByClause {
  type: 'orderBy';
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface LimitClause {
  type: 'limit';
  count: number;
}

export interface QueryAST {
  type: 'select';
  from: string;
  select?: SelectClause;
  where?: WhereClause;
  orderBy?: OrderByClause[];
  limit?: LimitClause;
}

