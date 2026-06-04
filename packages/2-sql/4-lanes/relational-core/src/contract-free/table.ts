import { blindCast } from '@prisma-next/utils/casts';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  type InsertValue,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  type TableSource,
  UpdateAst,
} from '../ast/types';

export interface ColumnDescriptor {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type ColumnSchema = Record<string, ColumnDescriptor>;

/**
 * A composable WHERE / ON expression. Wraps an `AnyExpression` and exposes
 * fluent boolean combinators, mirroring the spirit of `sql-builder`'s
 * `Expression` interface without the contract-bound type machinery.
 */
export class CfExpr {
  constructor(readonly ast: AnyExpression) {}

  and(other: CfExpr): CfExpr {
    return new CfExpr(AndExpr.of([this.ast, other.ast]));
  }

  or(other: CfExpr): CfExpr {
    return new CfExpr(OrExpr.of([this.ast, other.ast]));
  }

  not(): CfExpr {
    return new CfExpr(this.ast.not());
  }
}

/**
 * Per-column authoring handle exposed as a keyed property on a {@link TableHandle}.
 * Carries codec metadata baked at declaration time so no codec ID, table name, or
 * column name needs to be repeated at the call site.
 */
export interface ColumnProxy {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly columnName: string;
  readonly tableName: string;
  eq(value: unknown): CfExpr;
  neq(value: unknown): CfExpr;
  isNull(): CfExpr;
  isNotNull(): CfExpr;
  toRef(): ColumnRef;
  toProjectionItem(alias?: string): ProjectionItem;
}

/**
 * Object passed to the {@link CfConflictClause.doUpdate} callback. Each key
 * resolves to a `ColumnRef` for the corresponding `excluded.<column>`, so the
 * upsert conflict-update branch can copy proposed values without re-binding
 * parameters.
 */
export type ExcludedProxy<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]: ColumnRef;
};

export type TableInsertRow<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]: unknown;
};

export type TableSetValues<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]?: unknown;
};

/**
 * Fluent authoring handle for a fixed control-plane table. Column proxies are
 * exposed as keyed properties so `handle.columnName.eq(value)` composes without
 * threading codec IDs, table names, or column refs at the call site.
 */
export type TableHandle<Schema extends ColumnSchema> = {
  readonly source: TableSource;
  insert(row: TableInsertRow<Schema>): CfInsertQuery<Schema>;
  upsert(row: TableInsertRow<Schema>): CfUpsertBuilder<Schema>;
  update(): CfUpdateQuery<Schema>;
  select(...columns: ReadonlyArray<ColumnProxy>): CfSelectQuery;
} & {
  readonly [K in keyof Schema]: ColumnProxy;
};

export class CfInsertQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly returningItems: ReadonlyArray<ProjectionItem> | undefined = undefined,
  ) {}

  returning(...columns: ReadonlyArray<ColumnProxy>): CfInsertQuery<Schema> {
    return new CfInsertQuery(
      this.src,
      this.schema,
      this.rowValues,
      columns.map((col) => col.toProjectionItem()),
    );
  }

  build(): InsertAst {
    const row = buildInsertRow(this.schema, this.rowValues);
    const ast = InsertAst.into(this.src).withRows([row]);
    return this.returningItems ? ast.withReturning(this.returningItems) : ast;
  }
}

export class CfUpsertBuilder<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
  ) {}

  onConflict(...columns: ReadonlyArray<ColumnProxy>): CfConflictClause<Schema> {
    return new CfConflictClause(this.src, this.schema, this.rowValues, [...columns]);
  }
}

export class CfConflictClause<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly conflictCols: ReadonlyArray<ColumnProxy>,
  ) {}

  doUpdate(
    setOrCallback:
      | TableSetValues<Schema>
      | ((excluded: ExcludedProxy<Schema>) => TableSetValues<Schema>),
  ): CfUpsertQuery<Schema> {
    const set =
      typeof setOrCallback === 'function'
        ? setOrCallback(buildExcludedProxy(this.schema))
        : setOrCallback;
    return new CfUpsertQuery(this.src, this.schema, this.rowValues, this.conflictCols, set);
  }

  doNothing(): CfUpsertQuery<Schema> {
    return new CfUpsertQuery(this.src, this.schema, this.rowValues, this.conflictCols, undefined);
  }
}

export class CfUpsertQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly conflictCols: ReadonlyArray<ColumnProxy>,
    private readonly updateSet: TableSetValues<Schema> | undefined,
  ) {}

  build(): InsertAst {
    const row = buildInsertRow(this.schema, this.rowValues);
    const conflictRefs = this.conflictCols.map((col) => col.toRef());
    const onConflict =
      this.updateSet === undefined
        ? InsertOnConflict.on(conflictRefs).doNothing()
        : InsertOnConflict.on(conflictRefs).doUpdateSet(buildSetMap(this.schema, this.updateSet));
    return InsertAst.into(this.src).withRows([row]).withOnConflict(onConflict);
  }
}

export class CfUpdateQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly setValues: TableSetValues<Schema> | undefined = undefined,
    private readonly whereExpr: CfExpr | undefined = undefined,
    private readonly returningItems: ReadonlyArray<ProjectionItem> | undefined = undefined,
  ) {}

  set(values: TableSetValues<Schema>): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(this.src, this.schema, values, this.whereExpr, this.returningItems);
  }

  where(expr: CfExpr): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(this.src, this.schema, this.setValues, expr, this.returningItems);
  }

  returning(...columns: ReadonlyArray<ColumnProxy>): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(
      this.src,
      this.schema,
      this.setValues,
      this.whereExpr,
      columns.map((col) => col.toProjectionItem()),
    );
  }

  build(): UpdateAst {
    const set = buildSetMap(this.schema, this.setValues);
    const base = UpdateAst.table(this.src).withSet(set);
    const withWhere = this.whereExpr ? base.withWhere(this.whereExpr.ast) : base;
    return this.returningItems ? withWhere.withReturning(this.returningItems) : withWhere;
  }
}

export class CfSelectQuery {
  constructor(
    private readonly src: TableSource,
    private readonly projectionItems: ReadonlyArray<ProjectionItem>,
    private readonly whereExpr: CfExpr | undefined = undefined,
    private readonly orderByItems: ReadonlyArray<OrderByItem> = [],
  ) {}

  where(expr: CfExpr): CfSelectQuery {
    return new CfSelectQuery(this.src, this.projectionItems, expr, this.orderByItems);
  }

  orderBy(column: ColumnProxy, dir: 'asc' | 'desc' = 'asc'): CfSelectQuery {
    const item = dir === 'asc' ? OrderByItem.asc(column.toRef()) : OrderByItem.desc(column.toRef());
    return new CfSelectQuery(this.src, this.projectionItems, this.whereExpr, [
      ...this.orderByItems,
      item,
    ]);
  }

  build(): SelectAst {
    const base = SelectAst.from(this.src).withProjection(this.projectionItems);
    const withWhere = this.whereExpr ? base.withWhere(this.whereExpr.ast) : base;
    return this.orderByItems.length > 0 ? withWhere.withOrderBy(this.orderByItems) : withWhere;
  }
}

/**
 * Declare a control-plane table once, binding column codecs at declaration time.
 * Returns a `TableHandle` whose column properties compose expressions directly
 * without per-call-site codec or column-name threading.
 *
 * ```ts
 * const marker = pgTable({ name: 'marker', schema: 'prisma_contract' }, {
 *   space:      text(),
 *   core_hash:  text(),
 *   updated_at: timestamptz(),
 * });
 *
 * const query = marker.update()
 *   .set({ core_hash: newHash, updated_at: NOW })
 *   .where(marker.space.eq(space).and(marker.core_hash.eq(expectedFrom)))
 *   .returning(marker.space)
 *   .build();
 * ```
 */
export function table<Schema extends ColumnSchema>(
  source: TableSource,
  schema: Schema,
): TableHandle<Schema> {
  const proxies: Record<string, ColumnProxy> = {};
  for (const [col, desc] of Object.entries(schema)) {
    proxies[col] = makeColumnProxy(source.alias ?? source.name, col, desc);
  }

  const handle = {
    ...proxies,
    source,
    insert: (row: TableInsertRow<Schema>) => new CfInsertQuery(source, schema, row),
    upsert: (row: TableInsertRow<Schema>) => new CfUpsertBuilder(source, schema, row),
    update: () => new CfUpdateQuery(source, schema),
    select: (...cols: ReadonlyArray<ColumnProxy>) =>
      new CfSelectQuery(
        source,
        cols.map((col) => col.toProjectionItem()),
      ),
  };

  return blindCast<
    TableHandle<Schema>,
    'Column proxies are dynamically built from Schema keys — TypeScript cannot verify the per-key ColumnProxy constraint at the spread call site. Construction is correct by construction: every key maps to makeColumnProxy(source.name, key, schema[key]).'
  >(handle);
}

function makeColumnProxy(
  tableName: string,
  columnName: string,
  desc: ColumnDescriptor,
): ColumnProxy {
  const ref = ColumnRef.of(tableName, columnName);
  return {
    codecId: desc.codecId,
    nullable: desc.nullable,
    columnName,
    tableName,
    eq: (value) =>
      value === null
        ? new CfExpr(NullCheckExpr.isNull(ref))
        : new CfExpr(BinaryExpr.eq(ref, toSetExpression(value, desc))),
    neq: (value) =>
      value === null
        ? new CfExpr(NullCheckExpr.isNotNull(ref))
        : new CfExpr(BinaryExpr.neq(ref, toSetExpression(value, desc))),
    isNull: () => new CfExpr(NullCheckExpr.isNull(ref)),
    isNotNull: () => new CfExpr(NullCheckExpr.isNotNull(ref)),
    toRef: () => ref,
    toProjectionItem: (alias = columnName) =>
      ProjectionItem.of(alias, ref, { codecId: desc.codecId }),
  };
}

function buildExcludedProxy<Schema extends ColumnSchema>(schema: Schema): ExcludedProxy<Schema> {
  return blindCast<
    ExcludedProxy<Schema>,
    'Object.fromEntries cannot preserve per-key ColumnRef types — correct by construction: every key maps to ColumnRef.of("excluded", key).'
  >(Object.fromEntries(Object.keys(schema).map((col) => [col, ColumnRef.of('excluded', col)])));
}

function isExpressionSource(value: unknown): value is { toExpr(): AnyExpression } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toExpr' in value &&
    typeof value.toExpr === 'function'
  );
}

function toInsertValue(value: unknown, desc: ColumnDescriptor): InsertValue {
  if (isExpressionSource(value)) {
    const expr = value.toExpr();
    if (
      expr.kind === 'column-ref' ||
      expr.kind === 'param-ref' ||
      expr.kind === 'prepared-param-ref' ||
      expr.kind === 'raw-expr'
    ) {
      return expr;
    }
  }
  return ParamRef.of(value, { codec: { codecId: desc.codecId } });
}

function toSetExpression(value: unknown, desc: ColumnDescriptor): AnyExpression {
  if (isExpressionSource(value)) {
    return value.toExpr();
  }
  return ParamRef.of(value, { codec: { codecId: desc.codecId } });
}

function buildInsertRow<Schema extends ColumnSchema>(
  schema: Schema,
  values: TableInsertRow<Schema>,
): Record<string, InsertValue> {
  const row: Record<string, InsertValue> = {};
  const rawValues = blindCast<
    Record<string, unknown>,
    'TableInsertRow<Schema> maps Schema keys to unknown; indexing by the same string keys is correct by construction'
  >(values);
  for (const [col, desc] of Object.entries(schema)) {
    row[col] = toInsertValue(rawValues[col], desc);
  }
  return row;
}

function buildSetMap<Schema extends ColumnSchema>(
  schema: Schema,
  values: TableSetValues<Schema> | undefined,
): Record<string, AnyExpression> {
  if (values === undefined) return {};
  const set: Record<string, AnyExpression> = {};
  const rawSchema = blindCast<
    Record<string, ColumnDescriptor>,
    'Schema extends ColumnSchema = Record<string, ColumnDescriptor>; runtime key access is correct by construction'
  >(schema);
  const rawValues = blindCast<
    Record<string, unknown>,
    'TableSetValues<Schema> maps Schema keys to unknown; iterating with Object.entries is correct by construction'
  >(values);
  for (const [col, value] of Object.entries(rawValues)) {
    const desc = rawSchema[col];
    if (desc !== undefined) {
      set[col] = toSetExpression(value, desc);
    }
  }
  return set;
}
