import type {
  AggregateFn,
  AggregateExpr,
  ColumnRef,
  DerivedTableSource,
  Expression,
  FromSource,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  OrderByItem,
  OperationExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from './types';
import { compact } from './util';

export function createTableSource(name: string, alias?: string): TableSource {
  return compact({
    kind: 'table',
    name,
    alias,
  }) as TableSource;
}

export function createTableRef(name: string, alias?: string): TableSource {
  return createTableSource(name, alias);
}

export function createDerivedTableSource(alias: string, query: SelectAst): DerivedTableSource {
  return {
    kind: 'derivedTable',
    alias,
    query,
  };
}

export function createColumnRef(table: string, column: string): ColumnRef {
  return {
    kind: 'col',
    table,
    column,
  };
}

export function createProjectionItem(
  alias: string,
  expr: Expression | LiteralExpr,
): ProjectionItem {
  return {
    alias,
    expr,
  };
}

export function createParamRef(index: number, name?: string): ParamRef {
  return compact({
    kind: 'param',
    index,
    name,
  }) as ParamRef;
}

export function createOperationExpr(operation: OperationExpr): OperationExpr {
  return operation;
}

export function createFunctionOperationExpr(options: {
  readonly method: string;
  readonly forTypeId: string;
  readonly self: Expression;
  readonly args?: ReadonlyArray<Expression | ParamRef | LiteralExpr>;
  readonly returns: OperationExpr['returns'];
  readonly template: string;
}): OperationExpr {
  return createOperationExpr({
    kind: 'operation',
    method: options.method,
    forTypeId: options.forTypeId,
    self: options.self,
    args: options.args ?? [],
    returns: options.returns,
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      template: options.template,
    },
  });
}

export function createAggregateExpr(fn: AggregateFn, expr?: Expression): AggregateExpr {
  return compact({
    kind: 'aggregate',
    fn,
    expr,
  }) as AggregateExpr;
}

export function createJsonObjectEntry(
  key: string,
  value: Expression | LiteralExpr,
): JsonObjectExpr['entries'][number] {
  return {
    key,
    value,
  };
}

export function createJsonObjectExpr(
  entries: ReadonlyArray<JsonObjectExpr['entries'][number]>,
): JsonObjectExpr {
  return {
    kind: 'jsonObject',
    entries: [...entries],
  };
}

export function createJsonArrayAggExpr(
  expr: Expression,
  onEmpty: JsonArrayAggExpr['onEmpty'] = 'null',
  orderBy?: ReadonlyArray<OrderByItem>,
): JsonArrayAggExpr {
  return compact({
    kind: 'jsonArrayAgg',
    expr,
    onEmpty,
    orderBy: orderBy && orderBy.length > 0 ? [...orderBy] : undefined,
  }) as JsonArrayAggExpr;
}

export function createSubqueryExpr(query: SelectAst): SubqueryExpr {
  return {
    kind: 'subquery',
    query,
  };
}

export function createLiteralExpr(value: unknown): LiteralExpr {
  return {
    kind: 'literal',
    value,
  };
}

export function isTableSource(source: FromSource): source is TableSource {
  return source.kind === 'table';
}
