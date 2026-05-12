import type { CodecRef } from './codec-types';
import {
  AggregateExpr,
  type AggregateFn,
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyInsertOnConflictAction,
  type AnyQueryAst,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  DoNothingConflictAction,
  DoUpdateSetConflictAction,
  EqColJoinOn,
  ExistsExpr,
  IdentifierRef,
  InsertAst,
  InsertOnConflict,
  type InsertValue,
  JoinAst,
  type JoinOnExpr,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from './types';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

function asObject(json: unknown, context: string): JsonObject {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`Expected object at ${context}, got ${typeof json}`);
  }
  return json as JsonObject;
}

export function parseAnyQueryAst(json: unknown): AnyQueryAst {
  const obj = asObject(json, 'root');
  switch (obj['kind']) {
    case 'select':
      return parseSelect(obj);
    case 'insert':
      return parseInsert(obj);
    case 'update':
      return parseUpdate(obj);
    case 'delete':
      return parseDelete(obj);
    default:
      throw new Error(`Unknown query AST kind: ${String(obj['kind'])}`);
  }
}

function parseSelect(obj: JsonObject): SelectAst {
  return new SelectAst({
    from: parseFromSource(asObject(obj['from'], 'select.from')),
    joins: obj['joins']
      ? (obj['joins'] as JsonValue[]).map((j) => parseJoin(asObject(j, 'join')))
      : undefined,
    projection: (obj['projection'] as JsonValue[]).map((p) =>
      parseProjectionItem(asObject(p, 'projection')),
    ),
    where: obj['where'] ? parseExpression(asObject(obj['where'], 'select.where')) : undefined,
    orderBy: obj['orderBy']
      ? (obj['orderBy'] as JsonValue[]).map((o) => parseOrderByItem(asObject(o, 'orderBy')))
      : undefined,
    distinct: obj['distinct'] === true ? true : undefined,
    distinctOn: obj['distinctOn']
      ? (obj['distinctOn'] as JsonValue[]).map((e) => parseExpression(asObject(e, 'distinctOn')))
      : undefined,
    groupBy: obj['groupBy']
      ? (obj['groupBy'] as JsonValue[]).map((e) => parseExpression(asObject(e, 'groupBy')))
      : undefined,
    having: obj['having'] ? parseExpression(asObject(obj['having'], 'select.having')) : undefined,
    limit: obj['limit'] as number | undefined,
    offset: obj['offset'] as number | undefined,
    selectAllIntent: obj['selectAllIntent'] as { readonly table?: string } | undefined,
  });
}

function parseInsert(obj: JsonObject): InsertAst {
  const table = parseTableSource(asObject(obj['table'], 'insert.table'));
  const rows = (obj['rows'] as JsonValue[]).map((row) =>
    parseInsertRow(asObject(row, 'insert.row')),
  );
  const onConflict = obj['onConflict']
    ? parseOnConflict(asObject(obj['onConflict'], 'insert.onConflict'))
    : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) => parseProjectionItem(asObject(p, 'returning')))
    : undefined;
  return new InsertAst(table, rows, onConflict, returning);
}

function parseUpdate(obj: JsonObject): UpdateAst {
  const table = parseTableSource(asObject(obj['table'], 'update.table'));
  const set = parseUpdateSet(asObject(obj['set'], 'update.set'));
  const where = obj['where'] ? parseExpression(asObject(obj['where'], 'update.where')) : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) => parseProjectionItem(asObject(p, 'returning')))
    : undefined;
  return new UpdateAst(table, set, where, returning);
}

function parseDelete(obj: JsonObject): DeleteAst {
  const table = parseTableSource(asObject(obj['table'], 'delete.table'));
  const where = obj['where'] ? parseExpression(asObject(obj['where'], 'delete.where')) : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) => parseProjectionItem(asObject(p, 'returning')))
    : undefined;
  return new DeleteAst(table, where, returning);
}

function parseFromSource(obj: JsonObject): AnyFromSource {
  switch (obj['kind']) {
    case 'table-source':
      return parseTableSource(obj);
    case 'derived-table-source':
      return new DerivedTableSource(
        obj['alias'] as string,
        parseSelect(asObject(obj['query'], 'derived-table.query')),
      );
    default:
      throw new Error(`Unknown from-source kind: ${String(obj['kind'])}`);
  }
}

function parseTableSource(obj: JsonObject): TableSource {
  return new TableSource(obj['name'] as string, obj['alias'] as string | undefined);
}

function parseExpression(obj: JsonObject): AnyExpression {
  switch (obj['kind']) {
    case 'column-ref':
      return new ColumnRef(obj['table'] as string, obj['column'] as string);
    case 'identifier-ref':
      return new IdentifierRef(obj['name'] as string);
    case 'param-ref':
      return parseParamRef(obj);
    case 'literal':
      return new LiteralExpr(obj['value']);
    case 'subquery':
      return new SubqueryExpr(parseSelect(asObject(obj['query'], 'subquery.query')));
    case 'operation':
      return parseOperation(obj);
    case 'aggregate':
      return parseAggregate(obj);
    case 'json-object':
      return parseJsonObject(obj);
    case 'json-array-agg':
      return parseJsonArrayAgg(obj);
    case 'list':
      return new ListExpression(
        (obj['values'] as JsonValue[]).map((v) => parseExpression(asObject(v, 'list.value'))),
      );
    case 'binary':
      return new BinaryExpr(
        obj['op'] as BinaryOp,
        parseExpression(asObject(obj['left'], 'binary.left')),
        parseExpression(asObject(obj['right'], 'binary.right')),
      );
    case 'and':
      return new AndExpr(
        (obj['exprs'] as JsonValue[]).map((e) => parseExpression(asObject(e, 'and.expr'))),
      );
    case 'or':
      return new OrExpr(
        (obj['exprs'] as JsonValue[]).map((e) => parseExpression(asObject(e, 'or.expr'))),
      );
    case 'exists':
      return new ExistsExpr(
        parseSelect(asObject(obj['subquery'], 'exists.subquery')),
        obj['notExists'] as boolean,
      );
    case 'null-check':
      return new NullCheckExpr(
        parseExpression(asObject(obj['expr'], 'null-check.expr')),
        obj['isNull'] as boolean,
      );
    case 'not':
      return new NotExpr(parseExpression(asObject(obj['expr'], 'not.expr')));
    default:
      throw new Error(`Unknown expression kind: ${String(obj['kind'])}`);
  }
}

function parseParamRef(obj: JsonObject): ParamRef {
  const codec = obj['codec'] ? parseCodecRef(asObject(obj['codec'], 'paramRef.codec')) : undefined;
  const name = obj['name'] as string | undefined;
  return ParamRef.of(obj['value'], {
    ...(name !== undefined ? { name } : {}),
    ...(codec !== undefined ? { codec } : {}),
  });
}

function parseCodecRef(obj: JsonObject): CodecRef {
  const codecId = obj['codecId'] as string;
  const typeParams = obj['typeParams'] as JsonValue | undefined;
  return typeParams !== undefined ? { codecId, typeParams } : { codecId };
}

function parseOperation(obj: JsonObject): OperationExpr {
  const args = obj['args']
    ? (obj['args'] as JsonValue[]).map((a) => parseExpression(asObject(a, 'operation.arg')))
    : undefined;
  const returnsObj = asObject(obj['returns'], 'operation.returns');
  const loweringObj = asObject(obj['lowering'], 'operation.lowering');
  return new OperationExpr({
    method: obj['method'] as string,
    self: parseExpression(asObject(obj['self'], 'operation.self')),
    args,
    returns: {
      codecId: returnsObj['codecId'] as string,
      nullable: returnsObj['nullable'] as boolean,
    },
    lowering: {
      targetFamily: loweringObj['targetFamily'] as 'sql',
      strategy: loweringObj['strategy'] as 'infix' | 'function',
      template: loweringObj['template'] as string,
    },
  });
}

function parseAggregate(obj: JsonObject): AggregateExpr {
  const expr = obj['expr'] ? parseExpression(asObject(obj['expr'], 'aggregate.expr')) : undefined;
  return new AggregateExpr(obj['fn'] as AggregateFn, expr);
}

function parseJsonObject(obj: JsonObject): JsonObjectExpr {
  const entries = (obj['entries'] as JsonValue[]).map((entry) => {
    const e = asObject(entry, 'json-object.entry');
    return {
      key: e['key'] as string,
      value: parseExpression(asObject(e['value'], 'json-object.value')),
    };
  });
  return new JsonObjectExpr(entries);
}

function parseJsonArrayAgg(obj: JsonObject): JsonArrayAggExpr {
  const expr = parseExpression(asObject(obj['expr'], 'json-array-agg.expr'));
  const orderBy = obj['orderBy']
    ? (obj['orderBy'] as JsonValue[]).map((o) =>
        parseOrderByItem(asObject(o, 'json-array-agg.orderBy')),
      )
    : undefined;
  return new JsonArrayAggExpr(expr, obj['onEmpty'] as 'null' | 'emptyArray', orderBy);
}

function parseOrderByItem(obj: JsonObject): OrderByItem {
  return new OrderByItem(
    parseExpression(asObject(obj['expr'], 'orderBy.expr')),
    obj['dir'] as 'asc' | 'desc',
  );
}

function parseProjectionItem(obj: JsonObject): ProjectionItem {
  const codec = obj['codec']
    ? parseCodecRef(asObject(obj['codec'], 'projection.codec'))
    : undefined;
  return new ProjectionItem(
    obj['alias'] as string,
    parseExpression(asObject(obj['expr'], 'projection.expr')),
    codec,
  );
}

function parseInsertRow(obj: JsonObject): Record<string, InsertValue> {
  const row: Record<string, InsertValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    row[key] = parseInsertValue(asObject(value, `insert.row.${key}`));
  }
  return row;
}

function parseInsertValue(obj: JsonObject): InsertValue {
  switch (obj['kind']) {
    case 'param-ref':
      return parseParamRef(obj);
    case 'column-ref':
      return new ColumnRef(obj['table'] as string, obj['column'] as string);
    case 'default-value':
      return new DefaultValueExpr();
    default:
      throw new Error(`Unknown insert value kind: ${String(obj['kind'])}`);
  }
}

function parseUpdateSet(obj: JsonObject): Record<string, ColumnRef | ParamRef> {
  const set: Record<string, ColumnRef | ParamRef> = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = asObject(value, `update.set.${key}`);
    if (v['kind'] === 'column-ref') {
      set[key] = new ColumnRef(v['table'] as string, v['column'] as string);
    } else if (v['kind'] === 'param-ref') {
      set[key] = parseParamRef(v);
    } else {
      throw new Error(`Unknown update set value kind: ${String(v['kind'])}`);
    }
  }
  return set;
}

function parseOnConflict(obj: JsonObject): InsertOnConflict {
  const columns = (obj['columns'] as JsonValue[]).map((c) => {
    const col = asObject(c, 'onConflict.column');
    return new ColumnRef(col['table'] as string, col['column'] as string);
  });
  const action = parseOnConflictAction(asObject(obj['action'], 'onConflict.action'));
  return new InsertOnConflict(columns, action);
}

function parseOnConflictAction(obj: JsonObject): AnyInsertOnConflictAction {
  switch (obj['kind']) {
    case 'do-nothing':
      return new DoNothingConflictAction();
    case 'do-update-set':
      return new DoUpdateSetConflictAction(parseUpdateSet(asObject(obj['set'], 'doUpdateSet.set')));
    default:
      throw new Error(`Unknown on-conflict action kind: ${String(obj['kind'])}`);
  }
}

function parseJoin(obj: JsonObject): JoinAst {
  const source = parseFromSource(asObject(obj['source'], 'join.source'));
  const on = parseJoinOn(obj['on']);
  return new JoinAst(
    obj['joinType'] as 'inner' | 'left' | 'right' | 'full',
    source,
    on,
    obj['lateral'] as boolean,
  );
}

function parseJoinOn(json: unknown): JoinOnExpr {
  const obj = asObject(json, 'join.on');
  if (obj['kind'] === 'eq-col-join-on') {
    return new EqColJoinOn(
      new ColumnRef(
        asObject(obj['left'], 'joinOn.left')['table'] as string,
        asObject(obj['left'], 'joinOn.left')['column'] as string,
      ),
      new ColumnRef(
        asObject(obj['right'], 'joinOn.right')['table'] as string,
        asObject(obj['right'], 'joinOn.right')['column'] as string,
      ),
    );
  }
  return parseExpression(obj);
}
