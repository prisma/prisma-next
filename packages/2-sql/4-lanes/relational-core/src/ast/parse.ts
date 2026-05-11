import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { CodecDescriptorRegistry } from '../query-lane-context';
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

export function parseAnyQueryAst(json: unknown, registry: CodecDescriptorRegistry): AnyQueryAst {
  const obj = asObject(json, 'root');
  switch (obj['kind']) {
    case 'select':
      return parseSelect(obj, registry);
    case 'insert':
      return parseInsert(obj, registry);
    case 'update':
      return parseUpdate(obj, registry);
    case 'delete':
      return parseDelete(obj, registry);
    default:
      throw new Error(`Unknown query AST kind: ${String(obj['kind'])}`);
  }
}

function parseSelect(obj: JsonObject, registry: CodecDescriptorRegistry): SelectAst {
  return new SelectAst({
    from: parseFromSource(asObject(obj['from'], 'select.from'), registry),
    joins: obj['joins']
      ? (obj['joins'] as JsonValue[]).map((j) => parseJoin(asObject(j, 'join'), registry))
      : undefined,
    projection: (obj['projection'] as JsonValue[]).map((p) =>
      parseProjectionItem(asObject(p, 'projection'), registry),
    ),
    where: obj['where']
      ? parseExpression(asObject(obj['where'], 'select.where'), registry)
      : undefined,
    orderBy: obj['orderBy']
      ? (obj['orderBy'] as JsonValue[]).map((o) =>
          parseOrderByItem(asObject(o, 'orderBy'), registry),
        )
      : undefined,
    distinct: obj['distinct'] === true ? true : undefined,
    distinctOn: obj['distinctOn']
      ? (obj['distinctOn'] as JsonValue[]).map((e) =>
          parseExpression(asObject(e, 'distinctOn'), registry),
        )
      : undefined,
    groupBy: obj['groupBy']
      ? (obj['groupBy'] as JsonValue[]).map((e) =>
          parseExpression(asObject(e, 'groupBy'), registry),
        )
      : undefined,
    having: obj['having']
      ? parseExpression(asObject(obj['having'], 'select.having'), registry)
      : undefined,
    limit: obj['limit'] as number | undefined,
    offset: obj['offset'] as number | undefined,
    selectAllIntent: obj['selectAllIntent'] as { readonly table?: string } | undefined,
  });
}

function parseInsert(obj: JsonObject, registry: CodecDescriptorRegistry): InsertAst {
  const table = parseTableSource(asObject(obj['table'], 'insert.table'));
  const rows = (obj['rows'] as JsonValue[]).map((row) =>
    parseInsertRow(asObject(row, 'insert.row'), registry),
  );
  const onConflict = obj['onConflict']
    ? parseOnConflict(asObject(obj['onConflict'], 'insert.onConflict'), registry)
    : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) =>
        parseProjectionItem(asObject(p, 'returning'), registry),
      )
    : undefined;
  return new InsertAst(table, rows, onConflict, returning);
}

function parseUpdate(obj: JsonObject, registry: CodecDescriptorRegistry): UpdateAst {
  const table = parseTableSource(asObject(obj['table'], 'update.table'));
  const set = parseUpdateSet(asObject(obj['set'], 'update.set'), registry);
  const where = obj['where']
    ? parseExpression(asObject(obj['where'], 'update.where'), registry)
    : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) =>
        parseProjectionItem(asObject(p, 'returning'), registry),
      )
    : undefined;
  return new UpdateAst(table, set, where, returning);
}

function parseDelete(obj: JsonObject, registry: CodecDescriptorRegistry): DeleteAst {
  const table = parseTableSource(asObject(obj['table'], 'delete.table'));
  const where = obj['where']
    ? parseExpression(asObject(obj['where'], 'delete.where'), registry)
    : undefined;
  const returning = obj['returning']
    ? (obj['returning'] as JsonValue[]).map((p) =>
        parseProjectionItem(asObject(p, 'returning'), registry),
      )
    : undefined;
  return new DeleteAst(table, where, returning);
}

function parseFromSource(obj: JsonObject, registry: CodecDescriptorRegistry): AnyFromSource {
  switch (obj['kind']) {
    case 'table-source':
      return parseTableSource(obj);
    case 'derived-table-source':
      return new DerivedTableSource(
        obj['alias'] as string,
        parseSelect(asObject(obj['query'], 'derived-table.query'), registry),
      );
    default:
      throw new Error(`Unknown from-source kind: ${String(obj['kind'])}`);
  }
}

function parseTableSource(obj: JsonObject): TableSource {
  return new TableSource(obj['name'] as string, obj['alias'] as string | undefined);
}

function parseExpression(obj: JsonObject, registry: CodecDescriptorRegistry): AnyExpression {
  switch (obj['kind']) {
    case 'column-ref':
      return new ColumnRef(obj['table'] as string, obj['column'] as string);
    case 'identifier-ref':
      return new IdentifierRef(obj['name'] as string);
    case 'param-ref':
      return parseParamRef(obj, registry);
    case 'literal':
      return new LiteralExpr(obj['value']);
    case 'subquery':
      return new SubqueryExpr(parseSelect(asObject(obj['query'], 'subquery.query'), registry));
    case 'operation':
      return parseOperation(obj, registry);
    case 'aggregate':
      return parseAggregate(obj, registry);
    case 'json-object':
      return parseJsonObject(obj, registry);
    case 'json-array-agg':
      return parseJsonArrayAgg(obj, registry);
    case 'list':
      return new ListExpression(
        (obj['values'] as JsonValue[]).map((v) =>
          parseExpression(asObject(v, 'list.value'), registry),
        ),
      );
    case 'binary':
      return new BinaryExpr(
        obj['op'] as BinaryOp,
        parseExpression(asObject(obj['left'], 'binary.left'), registry),
        parseExpression(asObject(obj['right'], 'binary.right'), registry),
      );
    case 'and':
      return new AndExpr(
        (obj['exprs'] as JsonValue[]).map((e) =>
          parseExpression(asObject(e, 'and.expr'), registry),
        ),
      );
    case 'or':
      return new OrExpr(
        (obj['exprs'] as JsonValue[]).map((e) => parseExpression(asObject(e, 'or.expr'), registry)),
      );
    case 'exists':
      return new ExistsExpr(
        parseSelect(asObject(obj['subquery'], 'exists.subquery'), registry),
        obj['notExists'] as boolean,
      );
    case 'null-check':
      return new NullCheckExpr(
        parseExpression(asObject(obj['expr'], 'null-check.expr'), registry),
        obj['isNull'] as boolean,
      );
    case 'not':
      return new NotExpr(parseExpression(asObject(obj['expr'], 'not.expr'), registry));
    default:
      throw new Error(`Unknown expression kind: ${String(obj['kind'])}`);
  }
}

function parseParamRef(obj: JsonObject, registry: CodecDescriptorRegistry): ParamRef {
  const codec = obj['codec'] ? parseCodecRef(asObject(obj['codec'], 'paramRef.codec')) : undefined;
  if (codec) {
    validateTypeParams(codec, registry);
  }
  return ParamRef.of(obj['value'], {
    name: obj['name'] as string | undefined,
    codec,
  });
}

function parseCodecRef(obj: JsonObject): CodecRef {
  const codecId = obj['codecId'] as string;
  const typeParams = obj['typeParams'] as JsonValue | undefined;
  return typeParams !== undefined ? { codecId, typeParams } : { codecId };
}

function validateTypeParams(codec: CodecRef, registry: CodecDescriptorRegistry): void {
  const descriptor = registry.descriptorFor(codec.codecId);
  if (!descriptor) return;
  if (!descriptor.paramsSchema) return;
  const result = descriptor.paramsSchema['~standard'].validate(codec.typeParams);
  if ('issues' in result && result.issues) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for codec '${codec.codecId}': ${result.issues.map((i) => i.message).join('; ')}`,
      { codecId: codec.codecId, typeParams: codec.typeParams },
    );
  }
}

function parseOperation(obj: JsonObject, registry: CodecDescriptorRegistry): OperationExpr {
  const args = obj['args']
    ? (obj['args'] as JsonValue[]).map((a) =>
        parseExpression(asObject(a, 'operation.arg'), registry),
      )
    : undefined;
  return new OperationExpr({
    method: obj['method'] as string,
    self: parseExpression(asObject(obj['self'], 'operation.self'), registry),
    args,
    returns: obj['returns'] as { codecId: string; nullable: boolean },
    lowering: obj['lowering'] as { targetFamily: string; strategy: string; template: string },
  });
}

function parseAggregate(obj: JsonObject, registry: CodecDescriptorRegistry): AggregateExpr {
  const expr = obj['expr']
    ? parseExpression(asObject(obj['expr'], 'aggregate.expr'), registry)
    : undefined;
  return new AggregateExpr(obj['fn'] as AggregateFn, expr);
}

function parseJsonObject(obj: JsonObject, registry: CodecDescriptorRegistry): JsonObjectExpr {
  const entries = (obj['entries'] as JsonValue[]).map((entry) => {
    const e = asObject(entry, 'json-object.entry');
    return {
      key: e['key'] as string,
      value: parseExpression(asObject(e['value'], 'json-object.value'), registry),
    };
  });
  return new JsonObjectExpr(entries);
}

function parseJsonArrayAgg(obj: JsonObject, registry: CodecDescriptorRegistry): JsonArrayAggExpr {
  const expr = parseExpression(asObject(obj['expr'], 'json-array-agg.expr'), registry);
  const orderBy = obj['orderBy']
    ? (obj['orderBy'] as JsonValue[]).map((o) =>
        parseOrderByItem(asObject(o, 'json-array-agg.orderBy'), registry),
      )
    : undefined;
  return new JsonArrayAggExpr(expr, obj['onEmpty'] as 'null' | 'emptyArray', orderBy);
}

function parseOrderByItem(obj: JsonObject, registry: CodecDescriptorRegistry): OrderByItem {
  return new OrderByItem(
    parseExpression(asObject(obj['expr'], 'orderBy.expr'), registry),
    obj['dir'] as 'asc' | 'desc',
  );
}

function parseProjectionItem(obj: JsonObject, registry: CodecDescriptorRegistry): ProjectionItem {
  const codec = obj['codec']
    ? parseCodecRef(asObject(obj['codec'], 'projection.codec'))
    : undefined;
  return new ProjectionItem(
    obj['alias'] as string,
    parseExpression(asObject(obj['expr'], 'projection.expr'), registry),
    codec,
  );
}

function parseInsertRow(
  obj: JsonObject,
  registry: CodecDescriptorRegistry,
): Record<string, InsertValue> {
  const row: Record<string, InsertValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    row[key] = parseInsertValue(asObject(value, `insert.row.${key}`), registry);
  }
  return row;
}

function parseInsertValue(obj: JsonObject, registry: CodecDescriptorRegistry): InsertValue {
  switch (obj['kind']) {
    case 'param-ref':
      return parseParamRef(obj, registry);
    case 'column-ref':
      return new ColumnRef(obj['table'] as string, obj['column'] as string);
    case 'default-value':
      return new DefaultValueExpr();
    default:
      throw new Error(`Unknown insert value kind: ${String(obj['kind'])}`);
  }
}

function parseUpdateSet(
  obj: JsonObject,
  registry: CodecDescriptorRegistry,
): Record<string, ColumnRef | ParamRef> {
  const set: Record<string, ColumnRef | ParamRef> = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = asObject(value, `update.set.${key}`);
    if (v['kind'] === 'column-ref') {
      set[key] = new ColumnRef(v['table'] as string, v['column'] as string);
    } else if (v['kind'] === 'param-ref') {
      set[key] = parseParamRef(v, registry);
    } else {
      throw new Error(`Unknown update set value kind: ${String(v['kind'])}`);
    }
  }
  return set;
}

function parseOnConflict(obj: JsonObject, registry: CodecDescriptorRegistry): InsertOnConflict {
  const columns = (obj['columns'] as JsonValue[]).map((c) => {
    const col = asObject(c, 'onConflict.column');
    return new ColumnRef(col['table'] as string, col['column'] as string);
  });
  const action = parseOnConflictAction(asObject(obj['action'], 'onConflict.action'), registry);
  return new InsertOnConflict(columns, action);
}

function parseOnConflictAction(
  obj: JsonObject,
  registry: CodecDescriptorRegistry,
): AnyInsertOnConflictAction {
  switch (obj['kind']) {
    case 'do-nothing':
      return new DoNothingConflictAction();
    case 'do-update-set':
      return new DoUpdateSetConflictAction(
        parseUpdateSet(asObject(obj['set'], 'doUpdateSet.set'), registry),
      );
    default:
      throw new Error(`Unknown on-conflict action kind: ${String(obj['kind'])}`);
  }
}

function parseJoin(obj: JsonObject, registry: CodecDescriptorRegistry): JoinAst {
  const source = parseFromSource(asObject(obj['source'], 'join.source'), registry);
  const on = parseJoinOn(obj['on'], registry);
  return new JoinAst(
    obj['joinType'] as 'inner' | 'left' | 'right' | 'full',
    source,
    on,
    obj['lateral'] as boolean,
  );
}

function parseJoinOn(json: unknown, registry: CodecDescriptorRegistry): JoinOnExpr {
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
  return parseExpression(obj, registry);
}
