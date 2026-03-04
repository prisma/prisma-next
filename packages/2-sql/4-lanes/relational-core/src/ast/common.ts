import type {
  AggregateCountExpr,
  AggregateCountFn,
  AggregateExpr,
  AggregateFn,
  AggregateOpExpr,
  AggregateOpFn,
  ColumnRef,
  DefaultValueExpr,
  DerivedTableSource,
  Expression,
  FromSource,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from './types';

export function createTableSource(name: string, alias?: string): TableSource {
  return alias === undefined ? { kind: 'table', name } : { kind: 'table', name, alias };
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
  return name === undefined ? { kind: 'param', index } : { kind: 'param', index, name };
}

export function createDefaultValueExpr(): DefaultValueExpr {
  return {
    kind: 'default',
  };
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

export function createAggregateExpr(fn: AggregateCountFn, expr?: Expression): AggregateCountExpr;
export function createAggregateExpr(fn: AggregateOpFn, expr: Expression): AggregateOpExpr;
export function createAggregateExpr(fn: AggregateFn, expr?: Expression): AggregateExpr {
  if (fn === 'count') {
    return expr === undefined ? { kind: 'aggregate', fn } : { kind: 'aggregate', fn, expr };
  }

  if (expr === undefined) {
    throw new Error(`Aggregate function "${fn}" requires an expression`);
  }

  return {
    kind: 'aggregate',
    fn,
    expr,
  };
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
  return orderBy && orderBy.length > 0
    ? {
        kind: 'jsonArrayAgg',
        expr,
        onEmpty,
        orderBy: [...orderBy],
      }
    : {
        kind: 'jsonArrayAgg',
        expr,
        onEmpty,
      };
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

export function createJsonBuildObjectExpr(
  rowAlias: string,
  projectItems: ReadonlyArray<ProjectionItem>,
): JsonObjectExpr {
  if (projectItems.length === 0) {
    throw new Error('include child projection must contain at least one field');
  }

  return createJsonObjectExpr(
    projectItems.map((item) =>
      createJsonObjectEntry(item.alias, createColumnRef(rowAlias, item.alias)),
    ),
  );
}

export function createJsonAggExpr(
  inputExpr: Expression,
  orderBy?: ReadonlyArray<OrderByItem>,
): JsonArrayAggExpr {
  return createJsonArrayAggExpr(inputExpr, 'emptyArray', orderBy);
}

export function isTableSource(source: FromSource): source is TableSource {
  return source.kind === 'table';
}
